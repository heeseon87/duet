// The code pane: `c` opens the picked part's code beside the map, on its declaration or the lines its reference names,
// with the lines the map's code changed marked. It follows the picks (a package's files, a line's two ends), keeps what
// it shows on an empty click, shows the latest of quick picks, stands in for the info card while open (the map gliding
// to the middle of what is left as it opens and closes, the picked box kept in view), is resized by its edge (pushing
// the map along) and remembered, zooms its code on its own, reads like an editor (the clicked word lit wherever it stands,
// the file's structure, resized and closed by its edge), and the menu, the info card and the pane itself lead to the code and on to the review.
// The review's Viewed is set from the canvas too: the pane's checkbox for its file, the menu for a part's files at once.
// Left to its defaults the canvas opens in explore mode with the code on: the pane shows up with the first pick, and
// stays out of the way with no part to show (another map, a part removed).
//   DUET_PORT=7981 DUET_TOKEN=... [DUET_SCRATCH=<folder>] DUET_SHOTS=/dir node e2e/code-pane.mjs
//   (makes a repo under DUET_SCRATCH, else the temp folder, opens it as a workspace and leaves it there.)
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_SHOTS: shots } = process.env
if (!T) { console.error('DUET_TOKEN is required'); process.exit(2) }
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const until = async (what, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await what(); if (v) return v; await sleep(150) } return v }

const ws = join(realpathSync(mkdtempSync(join(process.env.DUET_SCRATCH ?? tmpdir(), 'code-pane-'))), 'ws')
const git = (...a) => execFileSync('git', ['-c', 'user.email=t@duet', '-c', 'user.name=t', ...a], { cwd: ws }).toString().trim()
mkdirSync(join(ws, 'src/store'), { recursive: true }); mkdirSync(join(ws, 'src/api'), { recursive: true })
const filler = n => Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n')
writeFileSync(join(ws, 'src/store/Store.kt'), `package demo.store\n\nimport demo.Db\n${filler(40)}\nclass Store(\n    private val db: Db,\n) {\n    fun save(x: String) = db.put(x)\n}\n`)
writeFileSync(join(ws, 'src/api/Api.kt'), `package demo.api\n\n${filler(9)}\nfun handle() {\n    val a = 1\n    val b = 2\n}\n${filler(20)}\n`)
writeFileSync(join(ws, 'src/api/ApiClient.kt'), 'package demo.api\n\nclass ApiClient\n')
git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'first')
await call('POST', '/api/workspaces', { path: ws })
const storeDecl = 44 // `class Store(`: 3 header lines, 40 filler lines, then the declaration

// The map is bound to this commit and the tree on disk; Store.kt then changes, so its new line is the map's code.
const name = 'code-pane'
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '코드 칸 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'm', patch: {
  elements: [
    { id: 'storepkg', kind: 'group', label: 'store' }, { id: 'Store', parent: 'storepkg', files: ['src/store/Store.kt'] },
    { id: 'apipkg', kind: 'group', label: 'api' }, { id: 'Api', parent: 'apipkg', files: ['src/api/Api.kt:12-14', 'src/api/ApiClient.kt'] },
    { id: 'NoFile', parent: 'apipkg' },
  ],
  relations: [{ from: 'Api', to: 'Store', label: 'saves' }],
} })
appendFileSync(join(ws, 'src/store/Store.kt'), 'fun added() = 1\n')
const addedLine = storeDecl + 5

// Nothing remembered yet: explore mode and the code on, no info card, and the pane waits for a pick.
{
  const first = await open({ port, token: T, ws, width: 1500, height: 940, appDefaults: true })
  await first.page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m) }, [ws, name])
  await first.page.reload({ waitUntil: 'domcontentloaded' })
  await first.page.waitForSelector('.stage-inner > svg .cv-node[data-target="Store"]', { timeout: 20000 }); await sleep(800)
  const d = await first.page.evaluate(() => ({ pane: Boolean(document.querySelector('.code-pane')), card: Boolean(document.querySelector('.inspector')), explore: document.querySelector('.canvas-bar button[title^="탐색 모드"]')?.getAttribute('aria-pressed'), code: document.querySelector('.canvas-bar button[title^="코드 칸"]')?.getAttribute('aria-pressed') }))
  check('left to its defaults the canvas opens exploring with the code on, no pane before a pick', !d.pane && !d.card && d.explore === 'true' && d.code === 'true', JSON.stringify(d))
  const b = await first.page.$eval('.stage-inner > svg .cv-node[data-target="Store"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await first.page.mouse.click(b.x, b.y)
  const path = await first.page.waitForSelector('.code-pane .code-pane-path .file-path', { timeout: 5000 }).then(e => e.getAttribute('title')).catch(() => '')
  check('the first pick brings the pane, on that box\'s file', path === 'src/store/Store.kt', path)
  await first.browser.close()
}

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
await page.evaluate(([w, m]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem('duet.sideOpen', '0')
  localStorage.removeItem('duet.canvas.code'); localStorage.removeItem('duet.canvas.codeWidth'); localStorage.setItem('duet.canvas.explore', '0'); localStorage.removeItem('duet.canvas.wideInspector')
}, [ws, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="Store"]', { timeout: 20000 }); await sleep(1200)
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/code-pane-${n}.png` }) }
/** Where the drawing stands, the open area of the stage (less the info card) and the picked box, in screen pixels. */
const where = id => page.evaluate(id => {
  const st = document.querySelector('.stage-canvas').getBoundingClientRect(), card = document.querySelector('.inspector')?.getBoundingClientRect()
  const b = document.querySelector(`.stage-inner > svg .cv-node[data-target="${id}"]`).getBoundingClientRect()
  return { x: document.querySelector('.stage-inner > svg').getBoundingClientRect().left, left: st.left, right: card ? Math.min(st.right, card.left) : st.right, box: { left: b.left, right: b.right }, gliding: document.querySelector('.stage-canvas').classList.contains('gliding') }
}, id)
/** The box sits inside the open area. */
const shown = w => w.box.left >= w.left && w.box.right <= w.right
const center = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
const pickBox = async id => { const p = await center(`.stage-inner > svg .cv-node[data-target="${id}"]`); await page.mouse.click(p.x, p.y) }
const shownPath = () => page.$eval('.code-pane .code-pane-path .file-path', e => e.getAttribute('title')).catch(() => '')
const rows = cls => page.$$eval(`.code-pane tr.${cls}`, trs => trs.map(t => Number(t.getAttribute('data-line'))))
const tabs = () => page.$$eval('.code-tabs button', bs => bs.map(b => b.textContent))
const card = () => page.$('.inspector')
const paneText = () => page.$eval('.code-pane', e => e.textContent).catch(() => '')
/** The row is inside the pane's scrolled view (give or take a pixel's rounding). */
const inView = no => page.evaluate(no => {
  const body = document.querySelector('.code-pane-body').getBoundingClientRect(), r = document.querySelector(`.code-pane tr[data-line="${no}"]`)?.getBoundingClientRect()
  return Boolean(r && r.top >= body.top - 1 && r.bottom <= body.bottom + 1)
}, no)

// 1. Closed by default: a pick opens the info card as before. `c` opens the pane on the picked box and puts the card away.
check('the pane starts closed', !(await page.$('.code-pane')))
await pickBox('Store'); await sleep(400)
check('closed, a pick opens the info card', Boolean(await card()))
const w0 = await where('Store')
await page.keyboard.press('c')
await until(() => page.$('.code-pane tr[data-line]'))
await sleep(400)
// The open area's middle stays where the drawing was: it moves by half of what the area lost (the card's 364 back, the pane's width taken).
const w1 = await where('Store'), pane0 = await page.$eval('.code-pane', e => e.getBoundingClientRect().width)
check('opening, the map glides to the middle of what is left', Math.abs(w1.x - w0.x - (364 - pane0) / 2) < 2 || Math.abs(w1.box.right - (w1.right - 24)) < 2, JSON.stringify({ moved: w1.x - w0.x, want: (364 - pane0) / 2 }))
check('and the picked box stays in view', shown(w1), JSON.stringify(w1))
check('c opens the pane on the picked box\'s file', await shownPath() === 'src/store/Store.kt', await shownPath())
check('and puts the info card away', !(await card()))
check('the class declaration is marked', JSON.stringify(await rows('target')) === `[${storeDecl}]`, JSON.stringify(await rows('target')))
check('and scrolled into view', await inView(storeDecl))
const changed = await until(async () => { const r = await rows('changed'); return r.length ? r : undefined })
check('the line the map\'s code added is marked', JSON.stringify(changed) === `[${addedLine}]`, JSON.stringify(changed))
await shot('store')

// 2. It follows the picks; the card stays away while it is open.
await pickBox('Api')
await until(async () => (await shownPath()) === 'src/api/Api.kt')
check('a box with two files gets a tab for each', JSON.stringify(await tabs()) === '["Api.kt","ApiClient.kt"]', JSON.stringify(await tabs()))
check('its reference\'s lines are marked', JSON.stringify(await until(async () => { const r = await rows('target'); return r.length ? r : undefined })) === '[12,13,14]', JSON.stringify(await rows('target')))
check('a pick does not bring the card back', !(await card()))
await page.click('.code-tabs button:has-text("ApiClient.kt")')
check('a tab shows its file', await until(async () => (await shownPath()) === 'src/api/ApiClient.kt'), await shownPath())
await pickBox('NoFile'); await sleep(400)
check('a box without files says so', (await paneText()).includes('연결된 파일이 없어'), await paneText())
const empty = await page.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.left + 10, y: r.bottom - 30 } })
await page.mouse.click(empty.x, empty.y); await sleep(400)
check('an empty click keeps what the pane shows', (await paneText()).includes('연결된 파일이 없어'))
const label = await center('.stage-inner > svg .cv-label')
await page.mouse.click(label.x, label.y)
check('a line shows both of its ends\' files', await until(async () => JSON.stringify(await tabs()) === '["Api.kt","ApiClient.kt","Store.kt"]'), JSON.stringify(await tabs()))
const pkg = await page.$eval('.stage-inner > svg .cv-cluster[data-target="apipkg"] rect', r => { const b = r.getBoundingClientRect(); return { x: b.left + 12, y: b.top + 8 } })
await page.mouse.click(pkg.x, pkg.y)
check('a package shows the files inside it', await until(async () => JSON.stringify(await tabs()) === '["Api.kt","ApiClient.kt"]'), JSON.stringify(await tabs()))
// Quick picks: whichever answer comes back last, the pane shows the last pick.
await pickBox('Store'); await pickBox('Api'); await pickBox('Store'); await pickBox('Api')
await sleep(1200)
check('after quick picks it shows the last one', await shownPath() === 'src/api/Api.kt', await shownPath())

// 3. Its edge resizes it; open and width are remembered.
const before = await page.$eval('.code-pane', e => e.getBoundingClientRect().width)
const edge = await page.$eval('.code-split', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 } })
const d0 = await where('Store')
await page.mouse.move(edge.x, edge.y); await page.mouse.down(); await page.mouse.move(edge.x - 120, edge.y, { steps: 6 })
// Measured as the next frame paints: the stage follows a resize just before painting.
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const d1 = await where('Store'), mid = await page.$eval('.code-pane', e => e.getBoundingClientRect().width)
await page.mouse.up(); await sleep(200)
const wider = await page.$eval('.code-pane', e => e.getBoundingClientRect().width)
check('dragging its edge widens it', Math.abs(wider - before - 120) < 4, `${before} → ${wider}`)
check('and pushes the map along at once', !d1.gliding && mid > before && Math.abs(d1.x - d0.x + (mid - before) / 2) < 1, JSON.stringify({ moved: d1.x - d0.x, widened: mid - before, gliding: d1.gliding }))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="Store"]', { timeout: 20000 }); await sleep(800)
check('reloaded, the code stays on and the pane waits for a pick', !(await page.$('.code-pane')) && await page.$eval('.canvas-bar button[title^="코드 칸"]', b => b.getAttribute('aria-pressed')) === 'true')
await pickBox('Store')
await page.waitForSelector('.code-pane', { timeout: 5000 }); await sleep(800)
check('open and width are remembered', Math.abs((await page.$eval('.code-pane', e => e.getBoundingClientRect().width)) - wider) < 2)
check('opening with the pane, the info card stays away', !(await card()))
await shot('wide')

// 3b. The code zooms on its own: buttons, ⌘ + wheel over the pane; the line at the top stays; remembered.
await pickBox('Store')
await until(() => page.$('.code-pane tr[data-line]'))
const fontSize = () => page.$eval('.code-pane table.diff', t => getComputedStyle(t).fontSize)
const percent = () => page.$eval('.code-zoom button:nth-child(2)', b => b.textContent)
const mapZoom = await page.$eval('.zoom-readout', e => e.textContent)
const topLine = () => page.evaluate(() => {
  const b = document.querySelector('.code-pane-body').getBoundingClientRect()
  return Number(document.elementFromPoint(b.left + 8, b.top + 1)?.closest('tr[data-line]')?.getAttribute('data-line'))
})
await page.$eval('.code-pane-body', b => { b.scrollTop = 200 }); await sleep(100)
const top = await topLine()
await page.click('.code-zoom button[title^="코드 확대"]'); await page.click('.code-zoom button[title^="코드 확대"]'); await sleep(200)
check('+ twice: the code at 120%', await percent() === '120%' && await fontSize() === '14.4px', `${await percent()} ${await fontSize()}`)
check('the line at the top stays at the top', await topLine() === top, `${top} → ${await topLine()}`)
check('the map\'s zoom is untouched', await page.$eval('.zoom-readout', e => e.textContent) === mapZoom)
const paneBox = await center('.code-pane-body')
await page.mouse.move(paneBox.x, paneBox.y)
await page.keyboard.down('Meta'); await page.mouse.wheel(0, 100); await page.keyboard.up('Meta'); await sleep(200)
check('⌘ + wheel over the pane zooms the code out', Number((await percent()).replace('%', '')) < 120, await percent())
check('and not the map', await page.$eval('.zoom-readout', e => e.textContent) === mapZoom)
await page.click('.code-zoom button[title^="코드 확대"]'); await sleep(100)
const kept = await percent()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="Store"]', { timeout: 20000 }); await sleep(800)
await pickBox('Store')
await page.waitForSelector('.code-zoom', { timeout: 5000 }); await sleep(500)
check('the zoom is remembered', await percent() === kept, `${kept} → ${await percent()}`)
await page.click('.code-zoom button[title="100%로"]'); await sleep(100)
check('the percent resets it to 100%', await percent() === '100%')

// 3c. Read like an editor: the word under a click (or a selection) lights up wherever it stands; the structure lists the
// file's declarations, marks the one holding the clicked line and leads to one (floating over the code when narrow).
await pickBox('Store')
await until(() => page.$('.code-pane tr[data-line]'))
const words = () => page.evaluate(() => CSS.highlights.get('duet-word')?.size ?? 0)
/** The middle of the first character of `text` on a line of the pane. */
const at = (no, text) => page.evaluate(([no, text]) => {
  const cell = document.querySelector(`.code-pane tr[data-line="${no}"] td.code`)
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const nodes = []
  let all = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, all.length]); all += n.data }
  const i = all.indexOf(text), [node, off] = nodes.findLast(([, o]) => o <= i)
  const r = document.createRange(); r.setStart(node, i - off); r.setEnd(node, i - off + 1)
  const b = r.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}, [no, text])
let p = await at(storeDecl + 1, 'db')
await page.mouse.dblclick(p.x, p.y)
check('a double-clicked word lights up wherever it stands, whole and case-sensitive', await until(async () => (await words()) === 2), String(await words()))
check('the path line counts it', (await page.$eval('.code-pane-path', e => e.textContent)).includes('db 2곳'))
p = await at(storeDecl + 3, 'save')
await page.mouse.click(p.x, p.y)
check('a click inside a word lights that word', await until(async () => (await words()) === 1), String(await words()))
check('and marks its line', JSON.stringify(await rows('cursor-line')) === `[${storeDecl + 3}]`, JSON.stringify(await rows('cursor-line')))
await page.evaluate(no => {
  const cell = document.querySelector(`.code-pane tr[data-line="${no}"] td.code`), r = document.createRange()
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  let all = ''
  const nodes = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, all.length]); all += n.data }
  const pos = i => { const [n, o] = nodes.findLast(([, o]) => o <= i); return [n, i - o] }
  const i = all.indexOf('db.put')
  r.setStart(...pos(i)); r.setEnd(...pos(i + 'db.put'.length))
  getSelection().removeAllRanges(); getSelection().addRange(r)
}, storeDecl + 3)
check('a selection on one line lights up the same text', await until(async () => (await page.$eval('.code-pane-path', e => e.textContent)).includes('db.put 1곳')), await page.$eval('.code-pane-path', e => e.textContent))
p = await at(storeDecl + 2, '{')
await page.mouse.click(p.x, p.y)
check('a click off any word clears the marks', await until(async () => (await words()) === 0), String(await words()))

const outline = () => page.$$eval('.code-outline button', bs => bs.map(b => `${b.querySelector('.ol-kind').textContent} ${b.querySelector('.ellipsis').textContent}:${(parseInt(b.style.paddingLeft) - 8) / 12}`))
const current = () => page.$eval('.code-outline button[aria-current="true"] .ellipsis', e => e.textContent).catch(() => '')
await page.click('.code-pane-head button[title^="구조"]')
await until(() => page.$('.code-outline button'))
check('the structure lists the file\'s declarations, nested, the constructor\'s apart from the fields', JSON.stringify(await outline()) === '["C Store:0","c db:1","m save:1","f added:0"]', JSON.stringify(await outline()))
check('beside the code when the pane is wide', !(await page.$('.code-outline.floating')))
// Its edge resizes it (remembered); dragged to the left end it closes on release, and opens again at its width.
const olWidth = () => page.$eval('.code-outline', e => e.getBoundingClientRect().width).catch(() => 0)
const olEdge = () => page.$eval('.code-outline-split', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 100 } })
const ol0 = await olWidth()
let oe = await olEdge()
await page.mouse.move(oe.x, oe.y); await page.mouse.down(); await page.mouse.move(oe.x + 50, oe.y, { steps: 5 }); await page.mouse.up(); await sleep(150)
const ol1 = await olWidth(), olKept = Number(await page.evaluate(() => localStorage.getItem('duet.canvas.codeOutlineWidth')))
check('dragging the structure\'s edge widens it, and the width is remembered', Math.abs(ol1 - ol0 - 50) < 3 && Math.abs(olKept - ol1) <= 1, JSON.stringify({ ol0, ol1, olKept }))
oe = await olEdge()
await page.mouse.move(oe.x, oe.y); await page.mouse.down(); await page.mouse.move(oe.x - ol1, oe.y, { steps: 8 })
const goneWhileDragging = !(await page.$('.code-outline'))
await page.mouse.up(); await sleep(150)
check('dragged to the left end, it closes on release', goneWhileDragging && !(await page.$('.code-outline')) && await page.evaluate(() => localStorage.getItem('duet.canvas.codeOutline')) === '0')
await page.click('.code-pane-head button[title^="구조"]')
await until(() => page.$('.code-outline button'))
check('and opens again at the width it had', Math.abs((await olWidth()) - ol1) < 2, `${ol1} → ${await olWidth()}`)
check('the declaration holding the clicked line is current', await current() === 'Store', await current())
await page.click('.code-outline button:has-text("save")')
check('a pick goes to the declaration and marks its name', await until(async () => (await words()) === 1 && JSON.stringify(await rows('cursor-line')) === `[${storeDecl + 3}]`) && await inView(storeDecl + 3))
check('and it is current', await current() === 'save', await current())
p = await at(storeDecl + 1, 'db')
await page.mouse.click(p.x, p.y)
check('a click in the code makes the declaration holding it current', await until(async () => (await current()) === 'db'), await current())
check('the structure is remembered open', await page.evaluate(() => localStorage.getItem('duet.canvas.codeOutline')) === '1')
await shot('structure')
const edge2 = await page.$eval('.code-split', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 } })
await page.mouse.move(edge2.x, edge2.y); await page.mouse.down(); await page.mouse.move(edge2.x + 200, edge2.y, { steps: 6 }); await page.mouse.up(); await sleep(200)
check('a narrow pane floats the structure over the code', Boolean(await page.$('.code-outline.floating')))
await page.click('.code-outline button:has-text("added")')
check('and a pick there puts it away, on the declaration', await until(async () => !(await page.$('.code-outline'))) && await inView(storeDecl + 5))
await pickBox('Api')
await until(async () => (await shownPath()) === 'src/api/Api.kt')
check('another file starts without marks', await until(async () => (await words()) === 0), String(await words()))

// 4. The menu and the info card open code in the pane; the pane leads on to the review.
await page.keyboard.press('f'); await sleep(500)
const s = await center('.stage-inner > svg .cv-node[data-target="Store"]')
await page.mouse.click(s.x, s.y, { button: 'right' }); await sleep(250)
await page.click('.ctx-menu .menu-item:has-text("코드 열기")')
check('the menu\'s "코드 열기" opens the file in the pane', await until(async () => (await shownPath()) === 'src/store/Store.kt') && await page.evaluate(() => localStorage.getItem('duet.tab')) === 'canvas')

// The review's Viewed, from the canvas: the pane's checkbox for its file, the menu for a part's files at once.
const paneViewed = () => page.$eval('.code-pane .code-pane-path .toggle input', i => i.checked).catch(() => null)
const badgeViewed = id => page.$eval(`.stage-inner > svg .cv-node[data-target="${id}"] > .cv-code`, b => b.classList.contains('viewed')).catch(() => false)
const menuOn = async (sel, at = c => c) => { const r = await page.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }); const p = at(r); await page.mouse.click(p.x ?? r.x + r.w / 2, p.y ?? r.y + r.h / 2, { button: 'right' }); await sleep(250) }
check('a changed file offers Viewed in the pane, not viewed yet', (await paneViewed()) === false, String(await paneViewed()))
await page.click('.code-pane .code-pane-path .toggle input'); await sleep(300)
check('checking it marks the file viewed, and the box\'s badge carries the check', (await paneViewed()) === true && await until(() => badgeViewed('Store')))
const cardBefore = Boolean(await card())
await page.keyboard.press('i'); await sleep(300)
check('the checkbox keeps the canvas keys', Boolean(await card()) !== cardBefore)
await page.keyboard.press('i'); await sleep(300)
await menuOn('.stage-inner > svg .cv-node[data-target="Store"]', () => ({}))
check('the box\'s menu offers to take it back', Boolean(await page.$('.ctx-menu .menu-item:has-text("Viewed 해제")')))
await shot('viewed')
await page.click('.ctx-menu .menu-item:has-text("Viewed 해제")'); await sleep(300)
check('and the pane and the badge follow', (await paneViewed()) === false && !(await badgeViewed('Store')))
await menuOn('.stage-inner > svg .cv-cluster[data-target="storepkg"]', r => ({ x: r.x + 12, y: r.y + 12 }))
await page.click('.ctx-menu .menu-item:has-text("Viewed로 표시")'); await sleep(300)
check('a package\'s menu marks all the files in it viewed', (await paneViewed()) === true, String(await paneViewed()))
await pickBox('Api'); await sleep(300)
await page.keyboard.press('i'); await sleep(300)
await page.click('.inspector .file-link:has-text("ApiClient.kt")')
check('the info card\'s file opens in the pane', await until(async () => (await shownPath()) === 'src/api/ApiClient.kt'), await shownPath())
check('a file the map\'s code did not change has no Viewed', (await paneViewed()) === null)
await page.click('.code-pane-head button[title="리뷰에서 보기"]'); await sleep(800)
check('the pane leads to the file in the review', await page.evaluate(() => localStorage.getItem('duet.tab')) === 'review')
await page.keyboard.press('Meta+1'); await sleep(800)

// 5. `c` closes it, and a pick opens the card again.
const c0 = await where('Store'), pane1 = await page.$eval('.code-pane', e => e.getBoundingClientRect().width)
await page.keyboard.press('c'); await sleep(400)
check('c closes the pane', !(await page.$('.code-pane')))
const c1 = await where('Store')
check('closing, the map glides back to the middle', Math.abs(c1.x - c0.x - pane1 / 2) < 2, JSON.stringify({ moved: c1.x - c0.x, want: pane1 / 2 }))
await page.keyboard.press('Escape'); await sleep(200)
await pickBox('Store'); await sleep(400)
check('closed again, a pick opens the info card', Boolean(await card()))

// 6. Nothing stale: another map, or a part the agent removed, puts the pane away until the next pick.
const gone = () => page.$('.code-pane').then(p => !p)
await page.keyboard.press('c')
check('opened again, it shows the picked box', await until(async () => (await shownPath()) === 'src/store/Store.kt'), await shownPath())
await call('POST', '/api/canvas', { ws, name: 'code-pane-b', diagram: 'class', title: '다른 지도' })
await call('POST', '/api/canvas/code-pane-b/patch', { ws, note: 'b', patch: { elements: [{ id: 'Store' }] } })
await page.click('.map-pick'); await page.click('.popover .menu-item:has-text("다른 지도")')
check('another map, even with a box of the same id, starts with no pane', await until(gone), await paneText())
await page.click('.map-pick'); await page.click('.popover .menu-item:has-text("코드 칸 시험")')
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="Store"]', { timeout: 15000 }); await sleep(800)
await pickBox('Store')
await until(async () => (await shownPath()) === 'src/store/Store.kt')
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'rm', patch: { remove: { elements: ['Store'] } } })
check('a part the agent removed puts the pane away', await until(gone), await paneText())
await page.keyboard.press('c')

await call('DELETE', `/api/canvas/${name}?ws=${encodeURIComponent(ws)}`)
await call('DELETE', `/api/canvas/code-pane-b?ws=${encodeURIComponent(ws)}`)
console.log('workspace left at', ws)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
