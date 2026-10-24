// A map and its code: a map made before the code is bound to its tree from that commit, so a box marked "구현 전"
// turns "코드 1" as soon as its file is written (no reload), and the review lists the file. The map's code can be
// changed from the review and saved (another kind of comparison, a worktree beside the workspace), and a map from
// before maps knew their code is asked once and bound to the repo its files are in, from the commit it was made on.
// One turn of a conversation narrows the review within the map's code, and the canvas marks what that turn touched.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_SCRATCH=<folder> node e2e/map-code.mjs
//   (makes a repo and a worktree beside it under DUET_SCRATCH, and leaves them there; one Haiku conversation.)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_SHOTS: shots } = process.env
const model = process.env.DUET_MODEL ?? 'claude-haiku-5-5'
if (!T) { console.error('DUET_TOKEN is required'); process.exit(2) }
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const until = async (what, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await what(); if (v) return v; await sleep(250) } return v }

const base = realpathSync(mkdtempSync(join(process.env.DUET_SCRATCH ?? tmpdir(), 'map-code-')))
const ws = join(base, 'ws'), wt = join(base, 'ws-wt')
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@duet', '-c', 'user.name=t', ...a], { cwd }).toString().trim()
mkdirSync(join(ws, 'src'), { recursive: true })
git(ws, 'init', '-q', '-b', 'main')
writeFileSync(join(ws, 'src/Old.kt'), 'class Old\n')
git(ws, 'add', '.'); git(ws, 'commit', '-q', '-m', 'first')
const first = git(ws, 'rev-parse', 'HEAD')
git(ws, 'worktree', 'add', '-q', wt, '-b', 'side')
await call('POST', '/api/workspaces', { path: ws })
const q = `?ws=${encodeURIComponent(ws)}`

// 1. Design first: the map is bound to the tree from this commit; one box is planned, its file not written yet.
const name = 'plan'
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '설계 지도' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'plan', patch: { elements: [
  { id: 'New', change: 'add', files: ['src/New.kt'] },
  { id: 'Old', change: 'keep', files: ['src/Old.kt'] },
], relations: [{ from: 'New', to: 'Old' }] } })
const made = (await call('GET', `/api/canvas/${name}${q}`)).body
check('a map made before the code is bound to its tree from that commit', made.code?.root === ws && made.code.source.kind === 'branch' && made.code.source.base === first && made.code.source.compare === 'WORKTREE', JSON.stringify(made.code))

const { browser, page, errors } = await open({ port, token: T, ws })
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem('duet.sideOpen', '0') }, [ws, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="New"]', { timeout: 15000 }).catch(() => {})
const badge = id => page.$eval(`.stage-inner > svg .cv-node[data-target="${id}"] > .cv-code`, b => b.getAttribute('data-text')).catch(() => '')
check('the planned box reads 구현 전 before its file exists', (await until(async () => (await badge('New')) === '구현 전')) === true, await badge('New'))
check('a box planned to stay, with nothing changed, has no mark', (await badge('Old')) === '')

// The code is written (as an agent or a terminal would): the canvas follows without a reload.
writeFileSync(join(ws, 'src/New.kt'), 'class New\n')
check('once its file is written the box reads 코드 1, no reload', (await until(async () => (await badge('New')) === '코드 1')) === true, await badge('New'))
const chip = await page.$eval('.canvas-bar .code-chip', c => c.textContent.trim()).catch(() => '')
check('the canvas bar counts the changed file', chip === '바뀐 파일 1', chip)
if (shots) await page.screenshot({ path: `${shots}/map-code-built.png` })
await page.click('.canvas-bar .code-chip'); await sleep(800)
const listed = await page.$$eval('.review-nav .tree-row.file', rs => [...new Set(rs.map(r => r.title))].join(' '))
check('the chip opens the review on the same file', listed === 'src/New.kt', listed)

// 2. The map's code changed from the review: another comparison, saved.
await page.click('.source-bar button:has-text("코드 기준 바꾸기")'); await sleep(300)
await page.click('.source-bar.editing .kinds button:has-text("Commits")'); await sleep(600)
await page.click('.source-bar button:has-text("이 기준으로 저장")'); await sleep(1200)
const saved = (await call('GET', `/api/canvas/${name}${q}`)).body.code
check('saving keeps that comparison as the map\'s code', saved?.source.kind === 'commits' && saved.root === ws, JSON.stringify(saved))
check('and the review holds on it again', Boolean(await page.$('.source-bar.bound')) && (await page.$eval('.source-bar', b => b.textContent)).includes('커밋'))

// A worktree beside the workspace, picked and saved as the map's code.
await page.click('.source-bar button:has-text("코드 기준 바꾸기")'); await sleep(300)
await page.click('.source-bar.editing .ref-pick'); await sleep(300)
await page.click(`.menu-item:has-text("ws-wt")`); await sleep(1200)
await page.click('.source-bar button:has-text("이 기준으로 저장")'); await sleep(1200)
const moved = (await call('GET', `/api/canvas/${name}${q}`)).body.code
const toasts = await page.$$eval('.toast.error', ts => ts.map(t => t.textContent).join(' '))
check('a worktree beside the workspace can be the map\'s code', moved?.root === wt && !toasts, `${JSON.stringify(moved)} ${toasts}`)

// 3. A map from before maps knew their code: asked once, bound to where its files are, from when it was made.
const unbound = await call('POST', `/api/canvas/${name}/code`, { ws, source: null })
check('a map can be unbound', unbound.status === 200 && !unbound.body.code)
await page.keyboard.press('Meta+1'); await sleep(1200)
const asked = await until(() => page.$('.code-prompt'))
check('an unbound map asks which code it is about', Boolean(asked))
await page.click('.code-prompt button:has-text("지도가 가리키는 코드에 연결")'); await sleep(1500)
const guessed = (await call('GET', `/api/canvas/${name}${q}`)).body.code
check('it is bound to the repo of its files, from the commit it was made on', guessed?.root === ws && guessed.source.kind === 'branch' && guessed.source.base === first, JSON.stringify(guessed))
check('the prompt goes away once bound', !(await page.$('.code-prompt')))

// 4. A conversation builds one more box in one turn: that turn narrows the review within the map's code.
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'turned', patch: { elements: [{ id: 'Turned', change: 'add', files: ['src/Turned.kt'] }] } })
const s = (await call('POST', '/api/sessions', { ws, model, permissionMode: 'bypassPermissions' })).body
await call('POST', `/api/sessions/${s.id}/messages`, { text: `Use the Write tool to create ${ws}/src/Turned.kt containing exactly: class Turned\nRun no other tools. Reply with one word: done.` })
const t0 = Date.now()
for (;;) {
  await sleep(1500)
  const i = (await call('GET', `/api/sessions${q}`)).body.find(x => x.id === s.id)
  if (i.status === 'idle' && i.turns >= 1) break
  if (i.status === 'waiting' || Date.now() - t0 > 180_000) { console.log('FAIL the turn did not finish', i.status); process.exit(1) }
}
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500)
await page.keyboard.press('Meta+2'); await sleep(800)
const turnButton = await until(() => page.$('.source-bar.bound button:has-text("턴만 보기")'))
check('the bound review offers one turn of the map\'s code', Boolean(turnButton))
await turnButton?.click(); await sleep(1500)
const one = await page.$$eval('.review-nav .tree-row.file', rs => [...new Set(rs.map(r => r.title))].join(' '))
const narrowed = await page.$eval('.source-bar', b => ({ bound: b.classList.contains('bound'), text: b.querySelector('.narrow-turn')?.textContent ?? '' })).catch(() => ({}))
check('it lists only what that turn changed, still on the map\'s code', one === 'src/Turned.kt' && narrowed.bound && narrowed.text.includes('턴 1'), `${one} · ${JSON.stringify(narrowed)}`)
check('nothing was refused', !(await page.$$eval('.toast', ts => ts.map(t => t.textContent).join(''))).includes('보는 중'))
await page.keyboard.press('Meta+1'); await sleep(1200)
const turnChip = await page.$eval('.canvas-bar .code-chip', c => c.textContent.trim()).catch(() => '')
check('the canvas marks the box that turn built, and calls no other box unbuilt', (await badge('Turned')) === '코드 1' && (await badge('New')) === '' && turnChip.startsWith('한 턴만'), `${await badge('Turned')}|${await badge('New')}|${turnChip}`)
if (shots) await page.screenshot({ path: `${shots}/map-code-turn.png` })
await page.keyboard.press('Meta+2'); await sleep(600)
await page.click('.narrow-turn .iconbtn'); await sleep(1500)
const whole = await page.$$eval('.review-nav .tree-row.file', rs => [...new Set(rs.map(r => r.title))].sort().join(' '))
check('closing the turn shows the whole of the map\'s code again', whole === 'src/New.kt src/Turned.kt' && !(await page.$('.narrow-turn')), whole)

if (errors.length) { failed++; console.log('page errors', errors) }
console.log('left behind:', base)
await browser.close()
process.exit(failed ? 1 : 0)
