// Code links: a name in the code pane that the map draws (a box, a member, a message's call) is a link. Under the
// pointer it is underlined and the path line says where it leads; with ⌘ held it is a solid link and its part lights on
// the map; ⌘-click selects the part (unfolding its package), centers it, and opens its declaring code at the name. A
// receiver named in a relation's via picks that relation's end; an unknown one offers a menu. A plain click still marks
// the word. ⌘[ ⌘], the head's ‹ › and the mouse's back and forward buttons retrace the way, back to the line read.
// A relation or a message shows its two ends stacked: `from` at its via's evidence (or the call), `to` at its declaration;
// a relation whose label names a call opens at that call and its declaration. The pair's toggle puts them side by side.
// A box drawn without files opens the file named after its type.
// ⌥ with a ⌘-click (or a map click) pins the file read beside the live column; a word lights in every column; the
// room hides the oldest pin, never taking the map below 360px. `]` `[` and the head's +n step through changed lines.
//   DUET_PORT=7981 DUET_TOKEN=... [DUET_SCRATCH=<folder>] DUET_SHOTS=/dir node e2e/code-links.mjs
//   (makes a repo under DUET_SCRATCH, else the temp folder, opens it as a workspace and leaves it there.)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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

const ws = join(realpathSync(mkdtempSync(join(process.env.DUET_SCRATCH ?? tmpdir(), 'code-links-'))), 'ws')
const git = (...a) => execFileSync('git', ['-c', 'user.email=t@duet', '-c', 'user.name=t', ...a], { cwd: ws }).toString().trim()
for (const d of ['order', 'repo', 'client']) mkdirSync(join(ws, 'src', d), { recursive: true })
const filler = (n, pad = '') => Array.from({ length: n }, (_, i) => `${pad}// line ${i + 1}`).join('\n')
const service = [
  'package demo.order', '', 'import demo.repo.OrderRepository', 'import demo.repo.UserRepository', '',
  'class OrderService(', '    private val orderRepository: OrderRepository,', '    private val userRepository: UserRepository,', ') {',
  filler(40, '    '),
  '    fun place(order: Order) {', '        orderRepository.save(order)', '        userRepository.save(order.user)', '    }', '}', '',
].join('\n')
writeFileSync(join(ws, 'src/order/OrderService.kt'), service)
writeFileSync(join(ws, 'src/repo/OrderRepository.kt'), ['package demo.repo', '', filler(30), 'interface OrderRepository {', '    fun save(order: Order)', '}', ''].join('\n'))
writeFileSync(join(ws, 'src/repo/UserRepository.kt'), ['package demo.repo', '', 'class UserRepository {', '    fun save(user: User) = Unit', '}', ''].join('\n'))
writeFileSync(join(ws, 'src/client/Client.kt'), ['package demo.client', '', 'class Client(private val orderService: OrderService) {', '    fun run(order: Order) {', '        orderService.place(order)', '    }', '}', ''].join('\n'))
git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'first')
await call('POST', '/api/workspaces', { path: ws })
const line = (file, text) => file.split('\n').findIndex(l => l.includes(text)) + 1
const placeLine = line(service, 'fun place'), saveCall = line(service, 'orderRepository.save'), userCall = line(service, 'userRepository.save'), field = line(service, 'private val orderRepository')
const repoSave = 34, repoDecl = 33 // 2 header lines, 30 filler lines, then `interface OrderRepository {` and `fun save`

const name = 'code-links'
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '코드 링크 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'm', patch: {
  elements: [
    { id: 'svc', kind: 'group', label: 'order' },
    { id: 'OrderService', parent: 'svc', files: ['src/order/OrderService.kt'], members: [{ text: '-orderRepository: OrderRepository' }, { text: '+place(order: Order)' }] },
    { id: 'repo', kind: 'group', label: 'repo' },
    { id: 'OrderRepository', parent: 'repo', kind: 'interface', files: ['src/repo/OrderRepository.kt'], members: [{ text: '+save(order: Order)' }] },
    { id: 'UserRepository', parent: 'repo', files: ['src/repo/UserRepository.kt'], members: [{ text: '+save(user: User)' }] },
  ],
  relations: [{ from: 'OrderService', to: 'OrderRepository', label: 'saves', via: 'field orderRepository' }],
} })
const seq = 'code-links-seq'
await call('POST', '/api/canvas', { ws, name: seq, diagram: 'sequence', title: '코드 링크 시퀀스' })
await call('POST', `/api/canvas/${seq}/patch`, { ws, note: 'm', patch: {
  elements: [{ id: 'Client', files: ['src/client/Client.kt'] }, { id: 'OrderService', files: ['src/order/OrderService.kt'] }],
  messages: [{ id: 'm1', from: 'Client', to: 'OrderService', label: 'place(order)' }],
} })
// The maps are bound to this commit and the tree on disk; OrderService.kt then changes in two places, the maps' code.
const changedService = service.split('\n')
changedService[14] += ' (checked)'; changedService[15] += ' (checked)'
writeFileSync(join(ws, 'src/order/OrderService.kt'), `${changedService.join('\n')}fun audit() = Unit\n`)
const auditLine = service.split('\n').length

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
await page.evaluate(([w, m]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m)
  localStorage.setItem('duet.canvas.code', '1'); localStorage.removeItem('duet.canvas.codeWidth')
  localStorage.removeItem('duet.canvas.codeWidthSide'); localStorage.removeItem('duet.canvas.codePair')
  localStorage.setItem(`duet.canvas.collapsed:${w}:${m}`, JSON.stringify(['repo']))
}, [ws, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="OrderService"]', { timeout: 20000 }); await sleep(1200)
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/code-links-${n}.png` }) }
const center = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
const pickBox = async id => { const p = await center(`.stage-inner > svg .cv-node[data-target="${id}"]`); await page.mouse.click(p.x, p.y) }
const live = '.code-pane.live'
const shownPath = () => page.$eval(`${live} .code-pane-path .file-path`, e => e.getAttribute('title')).catch(() => '')
const rows = cls => page.$$eval(`${live} tr.${cls}`, trs => trs.map(t => Number(t.getAttribute('data-line'))))
const size = h => page.evaluate(h => CSS.highlights.get(h)?.size ?? 0, h)
const selected = id => page.evaluate(id => Boolean(document.querySelector(`.stage-inner > svg [data-target="${id}"].cv-sel`)), id)
const folded = () => page.evaluate(([w, m]) => JSON.parse(localStorage.getItem(`duet.canvas.collapsed:${w}:${m}`) ?? '[]'), [ws, name])
const hint = () => page.$eval(`${live} .code-link-hint`, e => e.textContent).catch(() => '')
/** The middle of the character `o` past where `text` starts on a line of a column (the live one unless `scope` says). */
const at = (no, text, o = 0, scope = '.code-pane.live') => page.evaluate(([no, text, o, scope]) => {
  const cell = document.querySelector(`${scope} tr[data-line="${no}"] td.code`)
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const nodes = []
  let all = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, all.length]); all += n.data }
  const i = all.indexOf(text) + o, [node, off] = nodes.findLast(([, s]) => s <= i)
  const r = document.createRange(); r.setStart(node, i - off); r.setEnd(node, i - off + 1)
  const b = r.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}, [no, text, o, scope])
/** Whether the row sits inside a column's scrolled view (the live one unless `scope` says). */
const inView = (no, scope = '.code-pane.live') => page.evaluate(([no, scope]) => {
  const body = document.querySelector(`${scope} .code-pane-body`)?.getBoundingClientRect(), r = document.querySelector(`${scope} tr[data-line="${no}"]`)?.getBoundingClientRect()
  return Boolean(body && r && r.top >= body.top - 1 && r.bottom <= body.bottom + 1)
}, [no, scope])
/** Presses a key and says whether the page kept the browser from acting on it. */
const pressKept = async key => {
  await page.evaluate(() => {
    window.__kept = undefined
    const on = e => { if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; window.__kept = e.defaultPrevented; window.removeEventListener('keydown', on) }
    window.addEventListener('keydown', on)
  })
  await page.keyboard.press(key)
  return page.evaluate(() => window.__kept)
}

// 1. A name the map draws: a hint under the pointer, a link with ⌘ held, its part lit on the map.
await pickBox('OrderService')
check('a pick opens the live column on the box\'s file', await until(async () => (await shownPath()) === 'src/order/OrderService.kt'), await shownPath())
await until(() => page.$(`${live} tr[data-line="${saveCall}"]`)); await sleep(300)
await page.$eval(`${live} .code-pane-body`, (b, no) => b.querySelector(`tr[data-line="${no}"]`).scrollIntoView({ block: 'center' }), saveCall); await sleep(200)
let p = await at(saveCall, 'save')
await page.mouse.move(p.x, p.y); await sleep(250)
check('hovered, a linked name gets a hint underline', (await size('duet-link-hint')) === 1 && (await size('duet-link')) === 0, `${await size('duet-link-hint')}/${await size('duet-link')}`)
check('and the path line says where it leads', (await hint()).includes('OrderRepository.save()'), await hint())
await page.keyboard.down('Meta'); await page.mouse.move(p.x + 1, p.y); await sleep(250)
check('with ⌘ held it is a link', (await size('duet-link')) === 1 && (await size('duet-link-hint')) === 0 && Boolean(await page.$(`${live} .code-pane-body.link-armed`)))
check('and the folded package holding its box lights on the map', await page.evaluate(() => Boolean(document.querySelector('.stage-inner > svg [data-target="repo"].cv-peek'))))
await shot('hover')
const off = await at(saveCall, '(', 0)
await page.mouse.move(off.x, off.y); await sleep(250)
check('off the name, nothing is lit', (await size('duet-link')) === 0 && !(await page.$(`${live} .code-pane-body.link-armed`)))

// 2. ⌘-click: the part selected and unfolded, its declaring code opened at the name.
const wordBefore = await size('duet-word')
await page.mouse.click(p.x, p.y)
await page.keyboard.up('Meta')
check('⌘-click opens the declaring file', await until(async () => (await shownPath()) === 'src/repo/OrderRepository.kt'), await shownPath())
check('at the declaration of the name', await until(async () => JSON.stringify(await rows('target')) === `[${repoSave}]`), JSON.stringify(await rows('target')))
check('which is in view', await until(() => inView(repoSave)))
check('the name is lit', await until(async () => (await size('duet-word')) === 1), `${wordBefore} → ${await size('duet-word')}`)
check('its box is selected on the map, its package unfolded and remembered so', await until(() => selected('OrderRepository')) && !(await folded()).includes('repo'), JSON.stringify(await folded()))
await sleep(1000)
const box = await page.$eval('.stage-inner > svg .cv-node[data-target="OrderRepository"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
const stage = await page.$eval('.stage-canvas', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
check('and brought to the middle', Math.abs(box.x - stage.x) < 60 && Math.abs(box.y - stage.y) < 60, JSON.stringify({ box, stage }))
await shot('jumped')

// 3. ⌘-click on the declaration itself: the map shows its part, the code stays, no step is added; the caret stays put.
p = await at(repoSave - 2, 'line 30')
await page.mouse.click(p.x, p.y); await sleep(200)
const caret = JSON.stringify(await rows('cursor-line'))
p = await at(repoDecl, 'OrderRepository')
await page.keyboard.down('Meta'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta'); await sleep(500)
check('⌘-click on a declaration keeps the file and the caret', (await shownPath()) === 'src/repo/OrderRepository.kt' && JSON.stringify(await rows('cursor-line')) === caret, `${await shownPath()} ${caret} → ${JSON.stringify(await rows('cursor-line'))}`)
check('and selects its part', await selected('OrderRepository'))

// 4. Back and forward: ⌘[ returns to the line read and its part; ⌘] goes on; the browser stays.
check('⌘[ is kept from the browser', (await pressKept('Meta+BracketLeft')) === true)
check('⌘[ goes back to the file it came from', await until(async () => (await shownPath()) === 'src/order/OrderService.kt'), await shownPath())
check('to the line that was read', await until(() => inView(saveCall)))
check('and selects that part again', await until(() => selected('OrderService')))
check('⌘] goes forward again', (await pressKept('Meta+BracketRight')) && await until(async () => (await shownPath()) === 'src/repo/OrderRepository.kt'), await shownPath())
check('the head\'s ‹ goes back', await page.click(`${live} .code-pane-head button[aria-label="뒤로"]`).then(() => until(async () => (await shownPath()) === 'src/order/OrderService.kt')))
await page.click(`${live} .code-pane-head button[aria-label="앞으로"]`)
await until(async () => (await shownPath()) === 'src/repo/OrderRepository.kt' && Boolean(await page.$(`${live} tr[data-line="${repoSave}"]`)))
const back4 = await page.evaluate(() => {
  const el = document.querySelector('.code-pane.live tr[data-line] td.code')
  const ev = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return ev.defaultPrevented
})
check('the mouse\'s back button goes back, kept from the browser', back4 && await until(async () => (await shownPath()) === 'src/order/OrderService.kt'), await shownPath())

// 5. A receiver the map does not know: a menu of the parts the name may be; a pick goes there.
await until(() => inView(userCall)); await sleep(300)
p = await at(userCall, 'save')
await page.keyboard.down('Meta'); await page.mouse.move(p.x, p.y); await sleep(200)
check('an unsure link says how many it may be', (await hint()).includes('2곳 중 고르기'), await hint())
await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta')
const items = await until(async () => { const l = await page.$$eval('.ctx-menu .menu-item', bs => bs.map(b => b.textContent)); return l.length ? l : undefined })
check('⌘-click on it offers both repositories', items?.length === 2 && items.some(t => t.includes('UserRepository.save()')) && items.some(t => t.includes('OrderRepository.save()')), JSON.stringify(items))
await shot('chooser')
await page.click('.ctx-menu .menu-item:has-text("UserRepository")')
check('a pick goes to its declaration', await until(async () => (await shownPath()) === 'src/repo/UserRepository.kt' && JSON.stringify(await rows('target')) === '[4]'), `${await shownPath()} ${JSON.stringify(await rows('target'))}`)
await page.keyboard.press('Meta+BracketLeft')
await until(async () => (await shownPath()) === 'src/order/OrderService.kt')

// 6. A plain click on a link marks the word, as before, and goes nowhere.
await until(() => inView(saveCall)); await sleep(300)
p = await at(saveCall, 'orderRepository', 3)
await page.mouse.click(p.x, p.y); await sleep(400)
check('a plain click on a linked name only marks it', (await shownPath()) === 'src/order/OrderService.kt' && (await size('duet-word')) === 2 && JSON.stringify(await rows('cursor-line')) === `[${saveCall}]`, `${await size('duet-word')} ${JSON.stringify(await rows('cursor-line'))}`)

// 7. A name declared in the same file: the column moves to it there, as a step back can undo.
await page.keyboard.down('Meta'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta')
check('⌘-click on a field goes to its declaration in the same file', await until(async () => JSON.stringify(await rows('target')) === `[${field}]`) && (await shownPath()) === 'src/order/OrderService.kt', JSON.stringify(await rows('target')))
await page.keyboard.press('Meta+BracketLeft')
check('and back returns to the call', await until(async () => JSON.stringify(await rows('target')) !== `[${field}]`) && await until(() => inView(saveCall)))

// 8. A relation: its two ends stacked in the live column, the map's room unchanged.
/** Each half of the live column: its file, its marked lines and its evidence chip. */
const halves = () => page.$$eval('.code-pane.live .code-doc', ds => ds.map(d => ({
  path: d.querySelector('.code-pane-path .file-path')?.getAttribute('title') ?? '',
  target: [...d.querySelectorAll('tr.target')].map(t => Number(t.getAttribute('data-line'))),
  via: d.querySelector('.code-via')?.textContent ?? '',
})))
const liveWidth = () => page.$eval(live, e => Math.round(e.getBoundingClientRect().width))
const widthOf = sel => page.$eval(sel, e => Math.round(e.getBoundingClientRect().width)).catch(() => 0)
const widthBefore = await liveWidth()
const label = await center('.stage-inner > svg .cv-label')
await page.mouse.click(label.x, label.y)
const pair = await until(async () => { const h = await halves(); return h.length === 2 && h[0].target.length && h[1].target.length ? h : undefined })
check('a relation stacks its two ends', pair?.[0].path === 'src/order/OrderService.kt' && pair?.[1].path === 'src/repo/OrderRepository.kt', JSON.stringify(await halves()))
check('from at its via\'s evidence, with the chip', JSON.stringify(pair?.[0].target) === `[${field}]` && pair?.[0].via === '근거: field orderRepository', JSON.stringify(pair?.[0]))
check('to at its declaration', JSON.stringify(pair?.[1].target) === `[${repoDecl}]` && pair?.[1].via === '', JSON.stringify(pair?.[1]))
check('the evidence is in view and the map keeps its room', await until(() => inView(field)) && (await liveWidth()) === widthBefore, `${widthBefore} → ${await liveWidth()}`)
await sleep(600)
await shot('pair')

// 8b. A label that names the call: `from` at the call through its via's field, `to` at the function's declaration.
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'label', patch: { relations: [{ from: 'OrderService', to: 'OrderRepository', kind: 'association', label: 'save(order)' }] } })
await until(() => page.evaluate(() => [...document.querySelectorAll('.stage-inner > svg .cv-label')].some(e => e.textContent.includes('save(order)'))))
await sleep(400)
// The line shown again is not a move, so leave it for its box first.
await pickBox('OrderService')
await until(async () => (await halves()).length === 1)
const called = await center('.stage-inner > svg .cv-label')
await page.mouse.click(called.x, called.y)
const atCall = await until(async () => { const h = await halves(); return h.length === 2 && JSON.stringify(h[0].target) === `[${saveCall}]` && h[1].target.length ? h : undefined })
check('a label naming the call opens from at the call', Boolean(atCall) && await until(() => inView(saveCall)), JSON.stringify(await halves()))
check('and to at the function called', JSON.stringify(atCall?.[1].target) === `[${repoSave}]`, JSON.stringify(atCall?.[1]))
const docRects = () => page.$$eval(`${live} .code-doc`, ds => ds.map(d => { const r = d.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top) } }))
const room = await page.$eval('.code-columns', e => Math.round(e.parentElement.getBoundingClientRect().width))
await page.click(`${live} .code-pane-head button[aria-label="나란히 보기"]`)
await until(async () => { const d = await docRects(); return d.length === 2 && d[1].l >= d[0].r - 1 })
const sideBySide = await docRects()
check('the toggle puts the two ends side by side, from on the left', sideBySide.length === 2 && sideBySide[1].l >= sideBySide[0].r - 1 && sideBySide[0].t === sideBySide[1].t, JSON.stringify(sideBySide))
check('the column first takes twice its stacked width, the map kept at its least', Math.abs((await liveWidth()) - Math.min(2 * widthBefore, room - 360)) <= 2 && (await widthOf('.canvas-main')) >= 360,
  `${widthBefore} → ${await liveWidth()} of ${room}`)
check('both ends stay at the call and its declaration', JSON.stringify((await halves()).map(h => h.target)) === `[[${saveCall}],[${repoSave}]]`, JSON.stringify(await halves()))
check('the choice is remembered', await page.evaluate(() => localStorage.getItem('duet.canvas.codePair')) === 'side')
await sleep(400)
await shot('pair-side')
await page.click(`${live} .code-pane-head button[aria-label="나란히 보기"]`)
const stacked = await until(async () => { const d = await docRects(); return d.length === 2 && d[1].t > d[0].t ? d : undefined })
check('toggled back, they stack again at the stacked width', Boolean(stacked) && await until(async () => (await liveWidth()) === widthBefore), `${await liveWidth()} vs ${widthBefore}`)

// 9. Pins. ⌥⌘-click keeps the file read beside the live column, at the line read, and the map gives up that width.
const pin = '.code-pane.pinned'
const pinned = () => page.$$eval('.code-pane.pinned', ps => ps.map(p => p.querySelector('.code-pane-path .file-path')?.getAttribute('title') ?? ''))
const wordIn = scope => page.$eval(`${scope} .code-pane-path`, e => e.textContent).catch(() => '')
const varRanges = () => page.evaluate(() => [...CSS.highlights.keys()].filter(k => k.startsWith('duet-var-')).reduce((n, k) => n + CSS.highlights.get(k).size, 0))
await pickBox('OrderService')
await until(async () => (await halves()).length === 1 && (await shownPath()) === 'src/order/OrderService.kt')
await until(() => page.$(`${live} tr[data-line="${saveCall}"]`)); await sleep(300)
await page.$eval(`${live} .code-pane-body`, (b, no) => b.querySelector(`tr[data-line="${no}"]`).scrollIntoView({ block: 'center' }), saveCall); await sleep(200)
const mainBefore = await widthOf('.canvas-main'), liveBefore = await liveWidth()
p = await at(saveCall, 'save')
await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta'); await page.keyboard.up('Alt')
check('⌥⌘-click pins the file read', await until(async () => JSON.stringify(await pinned()) === '["src/order/OrderService.kt"]'), JSON.stringify(await pinned()))
check('and the live column goes on to the declaration', await until(async () => (await shownPath()) === 'src/repo/OrderRepository.kt'), await shownPath())
check('the pin opens at the line read', await until(() => inView(saveCall, pin)))
const side = await page.evaluate(() => [document.querySelector('.code-pane.pinned').getBoundingClientRect().right, document.querySelector('.code-pane.live').getBoundingClientRect().left])
const pinWidth = await widthOf(pin), mainAfter = await widthOf('.canvas-main')
check('left of the live column, the map giving up its width', Math.abs(side[0] - side[1]) <= 1 && Math.abs(mainBefore - mainAfter - pinWidth) <= 2 && (await liveWidth()) === liveBefore,
  JSON.stringify({ side, mainBefore, mainAfter, pinWidth }))
await sleep(1000)
const middle = await page.evaluate(() => {
  const b = document.querySelector('.stage-inner > svg .cv-node[data-target="OrderRepository"]').getBoundingClientRect(), s = document.querySelector('.stage-canvas').getBoundingClientRect()
  return { box: Math.round(b.left + b.width / 2), stage: Math.round(s.left + s.width / 2) }
})
check('the part it went to is in the middle of the narrower map', Math.abs(middle.box - middle.stage) < 60, JSON.stringify(middle))
// A word clicked in the pin lights in both columns; the caret line stays in the pin.
await until(() => inView(saveCall, pin)); await sleep(300)
p = await at(saveCall, 'order)', 1, pin)
await page.mouse.click(p.x, p.y); await sleep(400)
const hits = async scope => Number(/order\s+(\d+)곳/.exec(await wordIn(scope))?.[1] ?? 0)
const [inPin, inLive] = [await hits(pin), await hits(live)]
check('a word clicked in the pin lights in every column', inPin > 0 && inLive > 0 && (await size('duet-word')) === inPin + inLive, `${inPin}+${inLive} vs ${await size('duet-word')}`)
check('the caret line is the pin\'s alone', JSON.stringify(await page.$$eval(`${pin} tr.cursor-line`, t => t.map(r => Number(r.dataset.line)))) === `[${saveCall}]` && (await rows('cursor-line')).length === 0)
await shot('pinned')
// Variable colors in both; unpinning takes only the pin's.
await page.click(`${live} .code-pane-head button[title^="변수 색"]`)
const bothVars = await until(async () => { const n = await varRanges(); return n > 0 && (await page.$(`${pin} .code-pane-body.vars-on`)) && (await page.$(`${live} .code-pane-body.vars-on`)) ? n : 0 }, 15000)
await page.click(`${pin} button[aria-label="고정 풀기"]`)
await until(async () => (await pinned()).length === 0)
await sleep(300)
const liveVars = await varRanges()
check('unpinned, the live column keeps its variable colors', bothVars > 0 && liveVars > 0 && liveVars < bothVars, `${bothVars} → ${liveVars}`)
await page.click(`${live} .code-pane-head button[title^="변수 색"]`)
// ⌥-click on the map pins too; two pins in this room hide the older, and a narrow window hides both.
await page.keyboard.press('f'); await sleep(900)
await page.keyboard.down('Alt'); await pickBox('UserRepository'); await page.keyboard.up('Alt')
check('⌥-click on the map pins the file read, and the live column follows', await until(async () => JSON.stringify(await pinned()) === '["src/repo/OrderRepository.kt"]' && (await shownPath()) === 'src/repo/UserRepository.kt'),
  `${JSON.stringify(await pinned())} ${await shownPath()}`)
await page.click(`${live} .code-pane-head button[aria-label="고정"]`)
const toasted = () => page.$$eval('.toast', ts => ts.some(t => t.textContent.includes('오래된 고정 칸을 숨겼어')))
const hiddenNote = () => page.$eval(`${live} .code-hidden`, e => e.textContent).catch(() => '')
check('a second pin with no room for both hides the older, and says so', await until(async () => JSON.stringify(await pinned()) === '["src/repo/UserRepository.kt"]' && await toasted()) && (await hiddenNote()) === '고정 1개 숨김',
  `${JSON.stringify(await pinned())} ${await hiddenNote()}`)
check('the map keeps its least', (await widthOf('.canvas-main')) >= 360, await widthOf('.canvas-main'))
await page.setViewportSize({ width: 1100, height: 940 }); await sleep(700)
check('a narrow window hides every pin, the map still at its least', (await pinned()).length === 0 && (await hiddenNote()) === '고정 2개 숨김' && (await widthOf('.canvas-main')) >= 360,
  `${JSON.stringify(await pinned())} ${await hiddenNote()} ${await widthOf('.canvas-main')}`)
await page.setViewportSize({ width: 1500, height: 940 }); await sleep(700)
check('widened again, the newest comes back', JSON.stringify(await pinned()) === '["src/repo/UserRepository.kt"]', JSON.stringify(await pinned()))

// 10. Pins are the workspace's: another map and a reload keep them, and the live column waits for a pick.
// A sequence: ⌘-click a call selects its message and stacks the caller's line over the called function.
await page.evaluate(([w, m]) => localStorage.setItem(`duet.canvas.current:${w}`, m), [ws, seq])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-actor[data-target="Client"]', { timeout: 20000 }); await sleep(1200)
check('after a reload on another map the pins stay, and the live column waits', JSON.stringify(await until(async () => { const l = await pinned(); return l.length === 2 ? l : undefined })) === '["src/repo/OrderRepository.kt","src/repo/UserRepository.kt"]' && !(await page.$(live)),
  JSON.stringify(await pinned()))
await page.click(`${pin} button[aria-label="고정 풀기"]`)
await until(async () => (await pinned()).length === 1)
p = await center('.stage-inner > svg .cv-actor[data-target="Client"]')
await page.mouse.click(p.x, p.y)
check('a participant opens its file', await until(async () => (await shownPath()) === 'src/client/Client.kt'), await shownPath())
await until(() => page.$(`${live} tr[data-line="5"]`)); await sleep(300)
p = await at(5, 'place')
await page.keyboard.down('Meta'); await page.mouse.move(p.x, p.y); await sleep(200); await page.mouse.click(p.x, p.y); await page.keyboard.up('Meta')
check('⌘-click on a call selects its message', await until(() => page.evaluate(() => Boolean(document.querySelector('.stage-inner > svg .cv-msg[data-target="m1"].cv-sel')))))
const seqPair = await until(async () => { const h = await halves(); return h.length === 2 && h[0].target.length && h[1].target.length ? h : undefined })
check('and stacks the call over the function called', seqPair?.[0].path === 'src/client/Client.kt' && JSON.stringify(seqPair?.[0].target) === '[5]'
  && seqPair?.[1].path === 'src/order/OrderService.kt' && JSON.stringify(seqPair?.[1].target) === `[${placeLine}]`, JSON.stringify(await halves()))

// 11. `]` and `[` (and the head's +n, ⇧ for back) go through the blocks of changed lines, round the end.
await page.click(`${pin} button[aria-label="고정 풀기"]`)
await until(async () => (await pinned()).length === 0)
await page.keyboard.press('f'); await sleep(900)
p = await center('.stage-inner > svg .cv-actor[data-target="OrderService"]')
await page.mouse.click(p.x, p.y)
await until(async () => (await halves()).length === 1 && (await shownPath()) === 'src/order/OrderService.kt')
const added = () => page.$eval(`${live} .code-pane-head .code-added`, e => e.textContent).catch(() => '')
const caretAt = async () => JSON.stringify(await rows('cursor-line'))
check('a file the map\'s code changed counts its changed lines', await until(async () => (await added()) === '+3'), await added())
const wordMarks = no => page.$$eval(`${live} tr[data-line="${no}"] mark.w-add`, ms => ms.map(m => m.textContent).join(''))
check('a line changed in place marks only the words it changed', (await wordMarks(15)).trim() === '(checked)' && (await page.$eval(`${live} tr[data-line="15"] td.code`, td => td.textContent)) === '    // line 6 (checked)', await wordMarks(15))
check('a line all new is colored whole, with no word marks', (await rows('changed')).includes(auditLine) && (await wordMarks(auditLine)) === '', await wordMarks(auditLine))
await page.keyboard.press(']')
check('] goes to the first block, its first line clicked and in view', await until(async () => (await caretAt()) === '[15]') && await until(() => inView(15)), await caretAt())
await shot('words')
await page.keyboard.press(']')
check('] again goes to the next', await until(async () => (await caretAt()) === `[${auditLine}]`) && await until(() => inView(auditLine)), await caretAt())
await page.keyboard.press(']')
check('past the last, round to the first', await until(async () => (await caretAt()) === '[15]'), await caretAt())
await page.keyboard.press('[')
check('[ goes back, round to the last', await until(async () => (await caretAt()) === `[${auditLine}]`), await caretAt())
await page.click(`${live} .code-pane-head .code-added`)
check('the head\'s +n steps on', await until(async () => (await caretAt()) === '[15]'), await caretAt())
await page.click(`${live} .code-pane-head .code-added`, { modifiers: ['Shift'] })
check('and with ⇧ steps back', await until(async () => (await caretAt()) === `[${auditLine}]`), await caretAt())
const rail = `${live} .code-rail`, codeBody = `${live} .code-pane-body`
const ticks = await page.$$(`${rail} .code-rail-tick`)
check('the rail beside the code has a tick for each block of changed lines', ticks.length === 2, String(ticks.length))
await ticks[0].click()
check('a tick goes to its block as ] does', await until(async () => (await caretAt()) === '[15]') && await until(() => inView(15)), await caretAt())
const railShown = () => page.$eval(rail, r => r.classList.contains('shown'))
const barShown = () => page.$eval(codeBody, b => b.classList.contains('scrolling'))
await page.mouse.move(40, 400); await sleep(1200)
check('away from it and still, the rail shows only its ticks', !(await railShown()) && !(await barShown()))
await page.$eval(codeBody, b => { b.scrollTop = b.scrollHeight })
check('scrolling shows its thumb and the horizontal bar', await until(railShown, 500) && await barShown())
await sleep(350); await shot('rail')
const thumbAt = () => page.evaluate(([r, c]) => {
  const rail = document.querySelector(r).getBoundingClientRect(), t = document.querySelector(`${r} .code-rail-thumb`).getBoundingClientRect(), b = document.querySelector(c)
  return { thumb: (t.bottom - rail.top) / rail.height, view: (b.scrollTop + b.clientHeight) / b.scrollHeight, top: b.scrollTop, y: t.top + t.height / 2, x: t.left + t.width / 2 }
}, [rail, codeBody])
let th = await thumbAt()
check('the thumb stands where the view is', Math.abs(th.thumb - th.view) < 0.02, JSON.stringify(th))
await sleep(1200)
check('and both hide again once it stops', !(await railShown()) && !(await barShown()))
await page.mouse.move(th.x, th.y); await page.mouse.down(); await page.mouse.move(th.x, th.y - 60, { steps: 4 }); await page.mouse.up()
const dragged = await thumbAt()
check('dragging the thumb scrolls the code', dragged.top < th.top - 60, `${th.top} → ${dragged.top}`)

// 12. A box the map gives no files (drawn only for context) opens the file named after its type.
const ctx = 'code-links-ctx'
await call('POST', '/api/canvas', { ws, name: ctx, diagram: 'class', title: '맥락 상자' })
await call('POST', `/api/canvas/${ctx}/patch`, { ws, note: 'm', patch: { elements: [{ id: 'cli', label: 'Client (호출하는 쪽)' }, { id: 'gone', label: 'Nowhere' }] } })
await page.evaluate(([w, m]) => localStorage.setItem(`duet.canvas.current:${w}`, m), [ws, ctx])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="cli"]', { timeout: 20000 }); await sleep(1200)
await pickBox('cli')
check('a box without files opens the file named after it', await until(async () => (await shownPath()) === 'src/client/Client.kt'), await shownPath())
check('at its declaration', await until(async () => JSON.stringify(await rows('target')) === '[3]'), JSON.stringify(await rows('target')))
await page.click(`${live} .code-pane-head button[aria-label="고정"]`)
check('and pins it as any file', await until(async () => (await pinned()).includes('src/client/Client.kt')), JSON.stringify(await pinned()))
await sleep(800) // the map glides into the room the pin left it
await pickBox('gone')
check('a name no file has still says there is none', await until(() => page.$eval(`${live} .code-pane-empty`, e => e.textContent.includes('연결된 파일이 없어')).catch(() => false)))

await call('DELETE', `/api/canvas/${ctx}?ws=${encodeURIComponent(ws)}`)
await call('DELETE', `/api/canvas/${seq}?ws=${encodeURIComponent(ws)}`)
await call('DELETE', `/api/canvas/${name}?ws=${encodeURIComponent(ws)}`)
console.log('workspace left at', ws)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
