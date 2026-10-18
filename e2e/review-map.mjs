// The review laid out like the map (packages › boxes › files, the rest "outside the map"), and the
// canvas's "이 부분의 변경 보기" narrowing it to one package or box, in the repo that holds its code.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> node e2e/review-map.mjs
//   The workspace holds two repos the map points at: worktrees/feat (src/A.kt modified; B, C, D.kt new)
//   and worktrees/side (S.kt new, no conversation wrote there).
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const feat = `${ws}/worktrees/feat`, side = `${ws}/worktrees/side`
const name = `code-map-${Date.now().toString(36)}`

// 1. A map whose boxes point at code in the two repos.
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '코드 지도' })
const made = await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'setup', patch: { elements: [
  { id: 'core', kind: 'group', label: 'core' },
  { id: 'A', parent: 'core', change: 'modify', files: ['worktrees/feat/src/A.kt'] },
  { id: 'extra', kind: 'group', label: 'extra' },
  { id: 'B', parent: 'extra', change: 'add', files: ['worktrees/feat/src/B.kt:1'] },
  { id: 'C', parent: 'extra', change: 'add', files: ['worktrees/feat/src/C.kt'] },
  { id: 'Shared', files: ['worktrees/feat/src/A.kt'] },
  { id: 'Side', files: ['worktrees/side/S.kt'] },
], relations: [{ from: 'B', to: 'A' }, { from: 'C', to: 'A' }, { from: 'Shared', to: 'Side' }] } })
check('the map is set up', made.body?.ok, JSON.stringify(made.body).slice(0, 200))
const repos = (await call('GET', `/api/review/repos?ws=${encodeURIComponent(ws)}`)).body
const sideRepo = repos.find(r => r.path === side)
check('a repo only the map points at is offered too', sideRepo?.maps.includes(name) && sideRepo.sessions.length === 0, JSON.stringify(sideRepo))

const { browser, page, errors } = await open({ port, token: T, ws })
await page.evaluate(([w, f, m]) => {
  localStorage.setItem('duet.tab', 'review'); localStorage.setItem(`duet.review.root:${w}`, f); localStorage.setItem('duet.review.group', 'map')
  localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem(`duet.review.source:${f}`, JSON.stringify({ kind: 'working' })); localStorage.setItem('duet.sideOpen', '0')
}, [ws, feat, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tree-row.map-pkg', { timeout: 15000 }).catch(() => {})
await sleep(800)
const rows = () => page.$$eval('.review-nav .tree .tree-row', rs => rs.map(r => (r.classList.contains('map-pkg') ? 'P:' : r.classList.contains('map-box') ? 'B:' : 'F:') + (r.querySelector('.ellipsis')?.childNodes[0]?.textContent ?? r.textContent).trim() + (r.querySelector('.row-count') ? `(${r.querySelector('.row-count').textContent})` : '')))
const laid = await rows()
check('packages, boxes and files in map order; a shared file under both boxes; the rest outside', laid.join(' ') === 'P:core(1) B:A F:A.kt P:extra(2) B:B F:B.kt B:C F:C.kt B:Shared F:A.kt P:지도 밖(1) F:D.kt', laid.join(' '))
if (shots) await page.screenshot({ path: `${shots}/review-map.png` })
// j walks the files in that order, each once.
await page.click('.tree-row.file >> nth=0'); await sleep(200)
const walk = []
for (let i = 0; i < 4; i++) { walk.push(await page.$eval('.tree-row.file.on', e => e.title)); await page.keyboard.press('j'); await sleep(150) }
check('j goes through the files as laid out, each once', walk.join(' ') === 'src/A.kt src/B.kt src/C.kt src/D.kt', walk.join(' '))
// v marks a file viewed: a package all of whose files are viewed gets a check, a partly viewed one says how many.
await page.click('.tree-row.file >> nth=0'); await sleep(150)
await page.keyboard.press('v'); await sleep(150); await page.keyboard.press('v'); await sleep(300)
const marks = await page.$$eval('.review-nav .tree-row.map-pkg', rs => rs.map(r => `${r.querySelector('.ellipsis')?.textContent}:${r.querySelector('.viewed-mark') ? '✓' : r.querySelector('.row-count')?.textContent}`))
check('a fully viewed package shows a check, a partly viewed one "1/2"', marks.join(' ') === 'core:✓ extra:1/2 지도 밖:1', marks.join(' '))
const adds = await page.$$eval('.review-nav .map-chg.add', cs => cs.map(c => c.textContent))
check('a box changed by the design is labelled New', adds.length > 0 && adds.every(t => t === 'New'), adds.join(' '))
for (let i = 0; i < 2; i++) { await page.click(`.tree-row.file >> nth=${i}`); await sleep(100); await page.keyboard.press('v'); await sleep(150) }
await page.click('.nav-layout button:has-text("폴더")'); await sleep(300)
check('the folder layout is one click away', (await rows()).some(r => r.startsWith('F:') ) && !(await page.$('.tree-row.map-pkg')))
await page.click('.nav-layout button:has-text("지도")'); await sleep(300)

// 2. From the canvas: one package's changes only.
await page.keyboard.press('Meta+1'); await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 15000 }); await sleep(1000)
await page.keyboard.press('f'); await sleep(600)
const at = id => page.$eval(`.stage-inner > svg [data-target="${id}"]:is(.cv-cluster, .cv-node)`, n => { const r = (n.querySelector('rect') ?? n).getBoundingClientRect(); return { x: r.left + 14, y: r.top + 8 } })
const fromCanvas = async id => {
  await page.keyboard.press('Meta+1'); await sleep(700)
  const p = await at(id)
  await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(250)
  const has = await page.$('.ctx-menu .menu-item:has-text("이 부분의 변경 보기")')
  await has?.click(); await sleep(1500)
  return Boolean(has)
}
const listed = () => page.$$eval('.review-nav .tree-row.file', rs => [...new Set(rs.map(r => r.title))].sort().join(' '))
const offered = await fromCanvas('extra')
const chip = await page.$eval('.scope-chip', e => e.textContent).catch(() => '')
check('a package: the review shows only its files, and says so', offered && chip.includes('extra') && (await listed()) === 'src/B.kt src/C.kt' && (await page.evaluate(() => localStorage.getItem('duet.tab'))) === 'review', `${chip} · ${await listed()}`)
if (shots) await page.screenshot({ path: `${shots}/review-scope.png` })
await page.click('.scope-chip .iconbtn'); await sleep(300)
check('clearing it shows every change again', (await listed()) === 'src/A.kt src/B.kt src/C.kt src/D.kt', await listed())
await fromCanvas('A')
check('a box: only its file', (await listed()) === 'src/A.kt', await listed())
// 3. A box whose code is in a repo no conversation wrote in: the review moves there.
await fromCanvas('Side')
const there = await page.evaluate(() => document.querySelector('.ref-pick.other-root')?.textContent ?? '')
check('a box in another repo opens that repo, narrowed to its file', there.includes('worktrees/side') && (await listed()) === 'S.kt', `${there} · ${await listed()}`)
check('the hint names only repos a conversation wrote in', !(await page.$$eval('.repo-hint', hs => hs.map(h => h.textContent).join(''))).includes('side'))

// Leave the workspace as it was: the review back on feat, the folders layout.
await page.evaluate(([w, f]) => { localStorage.setItem(`duet.review.root:${w}`, f); localStorage.setItem('duet.review.group', 'folders') }, [ws, feat])
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
