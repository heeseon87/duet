// Code links: a name in the code pane that the map draws (a box, a member, a message's call) is a link. Under the
// pointer it is underlined and the path line says where it leads; with ⌘ held it is a solid link and its part lights on
// the map; ⌘-click selects the part (unfolding its package), centers it, and opens its declaring code at the name. A
// receiver named in a relation's via picks that relation's end; an unknown one offers a menu. A plain click still marks
// the word. ⌘[ ⌘], the head's ‹ › and the mouse's back and forward buttons retrace the way, back to the line read.
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
  relations: [{ from: 'OrderService', to: 'OrderRepository', via: 'field orderRepository' }],
} })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
await page.evaluate(([w, m]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m)
  localStorage.setItem('duet.canvas.code', '1'); localStorage.removeItem('duet.canvas.codeWidth')
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
/** The middle of the first character of `text` on a line of the live column (the first match when `nth` is 0). */
const at = (no, text, o = 0) => page.evaluate(([no, text, o]) => {
  const cell = document.querySelector(`.code-pane.live tr[data-line="${no}"] td.code`)
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const nodes = []
  let all = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, all.length]); all += n.data }
  const i = all.indexOf(text) + o, [node, off] = nodes.findLast(([, s]) => s <= i)
  const r = document.createRange(); r.setStart(node, i - off); r.setEnd(node, i - off + 1)
  const b = r.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}, [no, text, o])
/** Whether the row sits inside the live column's scrolled view. */
const inView = no => page.evaluate(no => {
  const body = document.querySelector('.code-pane.live .code-pane-body').getBoundingClientRect(), r = document.querySelector(`.code-pane.live tr[data-line="${no}"]`)?.getBoundingClientRect()
  return Boolean(r && r.top >= body.top - 1 && r.bottom <= body.bottom + 1)
}, no)
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

await call('DELETE', `/api/canvas/${name}?ws=${encodeURIComponent(ws)}`)
console.log('workspace left at', ws)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
