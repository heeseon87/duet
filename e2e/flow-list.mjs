// The flow list: a class map with numbered relations lists its steps top left in order; a row under the pointer lights
// its line and label, a click picks the step and brings it to the middle at the zoom the map is at; n and p walk the steps
// (n in Hangul input too) and stop at the ends, the brackets do not; the head's −·+ (and ⌘ + wheel) size the list like the
// code, remembered; folding the list keeps a one-line head (remembered) and the keys still walk; folded packages keep
// every step listed and picking one lights what stands for it; a sequence map has no list.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_SHOTS=/dir node e2e/flow-list.mjs   (makes and removes maps named flow-list, flow-list-seq)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const W = encodeURIComponent(ws)
const NAME = 'flow-list', SEQ = 'flow-list-seq'

for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === NAME || m.name === SEQ) await call('DELETE', `/api/canvas/${m.name}?ws=${W}`)
await call('POST', '/api/canvas', { ws, name: NAME, diagram: 'class', title: '흐름 목록 시험' })
await call('POST', `/api/canvas/${NAME}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'web', kind: 'group' }, { id: 'Controller', parent: 'web' },
    { id: 'core', kind: 'group' }, { id: 'Service', parent: 'core' }, { id: 'Policy', parent: 'core' },
    { id: 'data', kind: 'group' }, { id: 'Repo', parent: 'data' }, { id: 'Db', parent: 'data' },
  ],
  relations: [
    { from: 'Repo', to: 'Db', label: 'insert', step: 4 },
    { from: 'Controller', to: 'Service', label: 'handle(req)', step: 1 },
    { from: 'Service', to: 'Policy', label: 'check(order)', step: 2 },
    { from: 'Policy', to: 'Repo', kind: 'dependency', label: 'reads rules' },
    { from: 'Service', to: 'Repo', kind: 'dependency', label: 'save(order)', step: 3 },
  ],
} })
await call('POST', '/api/canvas', { ws, name: SEQ, diagram: 'sequence', title: '흐름 목록 시퀀스' })
await call('POST', `/api/canvas/${SEQ}/patch`, { ws, note: '시험 지도', patch: { elements: [{ id: 'App' }, { id: 'Api' }], messages: [{ id: 'm1', from: 'App', to: 'Api', label: 'call' }] } })
const KEYS = ['Controller->Service:association', 'Service->Policy:association', 'Service->Repo:dependency', 'Repo->Db:association']

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/flow-list-${n}.png` }) }
const show = async name => {
  // Explore mode: a click only lights a part, so no info card narrows the stage while we measure the middle.
  await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.setItem('duet.canvas.explore', '1') }, [ws, name])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.stage-inner > svg [data-target]', { state: 'attached', timeout: 15000 })
  await sleep(900)
}
const press = (key, code) => page.evaluate(([key, code]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })), [key, code])
const selected = () => page.evaluate(() => document.querySelector('.stage-inner > svg .cv-edge.cv-sel')?.getAttribute('data-keys') ?? null)
const active = () => page.evaluate(() => document.querySelector('.flow-step.active .flow-no')?.textContent ?? null)

await show(NAME)
const rows = await page.$$eval('.flow-list .flow-step', bs => bs.map(b => b.textContent))
check('the list shows the numbered steps in order, with their ends and labels', rows.length === 4 && rows[0] === '1Controller → Servicehandle(req)' && rows[1].startsWith('2Service → Policy') && rows[2].startsWith('3Service → Repo') && rows[3].startsWith('4Repo → Db'), JSON.stringify(rows))
const place = await page.evaluate(() => { const l = document.querySelector('.flow-list').getBoundingClientRect(), s = document.querySelector('.stage-canvas').getBoundingClientRect(); return { dx: l.left - s.left, dy: l.top - s.top, opacity: Number(getComputedStyle(document.querySelector('.flow-list')).opacity) } })
check('it sits at the top left of the canvas, see-through', place.dx >= 0 && place.dx < 30 && place.dy >= 0 && place.dy < 30 && place.opacity < 1, JSON.stringify(place))
await shot('list')

// The row under the pointer lights its line and label; leaving lets go.
await page.hover('.flow-list .flow-step >> nth=1'); await sleep(250)
const peek = await page.evaluate(() => ({
  edge: document.querySelector('.stage-inner > svg .cv-edge.cv-peek')?.getAttribute('data-keys'),
  label: document.querySelector('.stage-inner > svg .cv-label.cv-peek')?.getAttribute('data-keys'),
  stroke: (() => { const e = document.querySelector('.stage-inner > svg .cv-edge.cv-peek'); return e && getComputedStyle(e).stroke })(),
  accent: (() => { const d = document.createElement('div'); d.style.color = 'var(--accent)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c })(),
  picked: Boolean(document.querySelector('.stage-inner > svg .cv-sel')),
}))
check('hovering a row lights its line and label, picking nothing', peek.edge === KEYS[1] && peek.label === KEYS[1] && peek.stroke === peek.accent && !peek.picked, JSON.stringify(peek))
await shot('peek')
await page.mouse.move(700, 900); await sleep(250)
check('leaving the list lets the line go', !(await page.$('.stage-inner > svg .cv-peek')))

// A click picks the step and centers it at the zoom the map is at.
const scale = () => page.evaluate(() => { const s = document.querySelector('.stage-inner > svg'); return s.getBoundingClientRect().width / Number(s.getAttribute('width')) })
const before = await scale()
await page.click('.flow-list .flow-step >> nth=2'); await sleep(900)
const mid = await page.evaluate(k => {
  const svg = document.querySelector('.stage-inner > svg'), st = document.querySelector('.stage-canvas').getBoundingClientRect()
  const rs = [svg.querySelector(`.cv-edge[data-keys~="${k}"]`), svg.querySelector('.cv-node[data-target="Service"]'), svg.querySelector('.cv-node[data-target="Repo"]')].map(e => e.getBoundingClientRect())
  const l = Math.min(...rs.map(r => r.left)), r = Math.max(...rs.map(r => r.right)), t = Math.min(...rs.map(r => r.top)), b = Math.max(...rs.map(r => r.bottom))
  return { dx: Math.round((l + r) / 2 - (st.left + st.width / 2)), dy: Math.round((t + b) / 2 - (st.top + st.height / 2)) }
}, KEYS[2])
const after = await scale()
check('a click picks the step and lights its row', (await selected()) === KEYS[2] && (await active()) === '3')
check('…and brings it to the middle at the same zoom', Math.abs(mid.dx) < 30 && Math.abs(mid.dy) < 30 && Math.abs(after - before) < 0.01, JSON.stringify({ ...mid, before, after }))
await shot('picked')

// The keys walk the flow and stop at the ends; the brackets do not walk it.
await page.keyboard.press('n'); await sleep(500)
check('n goes to the next step', (await selected()) === KEYS[3] && (await active()) === '4')
await page.keyboard.press('n'); await sleep(500)
check('…and stays at the last one', (await selected()) === KEYS[3])
await page.keyboard.press('p'); await sleep(500)
check('p goes back', (await selected()) === KEYS[2])
await page.keyboard.press(']'); await sleep(300); await page.keyboard.press('['); await sleep(300)
check('the brackets leave the step as it is', (await selected()) === KEYS[2])
await press('ㅜ', 'KeyN'); await sleep(500)
check('n goes forward in Hangul input too (ㅜ)', (await selected()) === KEYS[3])
await page.keyboard.press('Escape'); await sleep(300)
await page.keyboard.press('n'); await sleep(500)
check('with nothing picked, n starts at the first step', (await selected()) === KEYS[0])
await page.keyboard.press('Escape'); await sleep(300)
await page.keyboard.press('p'); await sleep(500)
check('…and p at the last', (await selected()) === KEYS[3])
check('the head shows no bracket keys', !(await page.$('.flow-list kbd')))

// Sized like the code: −·+ on the head, the percent back to 100%, ⌘ + wheel; remembered.
const size = () => page.evaluate(() => ({ pct: document.querySelector('.flow-zoom button:nth-child(2)')?.textContent, font: parseFloat(getComputedStyle(document.querySelector('.flow-step')).fontSize), width: Math.round(document.querySelector('.flow-list').getBoundingClientRect().width) }))
const full = await size()
await page.click('.flow-zoom button >> nth=0'); await sleep(100); await page.click('.flow-zoom button >> nth=0'); await sleep(200)
const small = await size()
check('− makes the list smaller, rows and width with it', small.pct === '80%' && Math.abs(small.font - full.font * 0.8) < 0.2 && small.width < full.width, JSON.stringify({ full, small }))
await shot('small')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target]', { state: 'attached' }); await sleep(800)
check('…and the size is remembered', (await size()).pct === '80%')
await page.evaluate(() => document.querySelector('.flow-list').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })))
await sleep(200)
check('⌘ + wheel over the list sizes it too', (await size()).pct === '88%', (await size()).pct)
await page.click('.flow-zoom button >> nth=1'); await sleep(200)
check('the percent brings it back to 100%', (await size()).pct === '100%')

// Folded away, the head stays (remembered) and the keys still walk.
await page.click('.flow-toggle'); await sleep(200)
check('clicking the head folds the list to one line', !(await page.$('.flow-list ol')) && !(await page.$('.flow-zoom')) && Boolean(await page.$('.flow-head')))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target]', { state: 'attached' }); await sleep(800)
check('…and it stays folded after a reload', !(await page.$('.flow-list ol')) && Boolean(await page.$('.flow-head')))
await page.keyboard.press('Escape'); await sleep(200)
await page.keyboard.press('n'); await sleep(500)
check('…while the keys still walk the flow', (await selected()) === KEYS[0])
await page.click('.flow-toggle'); await sleep(200)

// Folded packages: every step stays listed; a step inside one folded package lights that package.
await page.keyboard.press('Escape'); await sleep(200)
await page.click('button:has-text("Collapse all")'); await sleep(1200)
check('with packages folded every step is still listed', (await page.$$('.flow-list .flow-step')).length === 4)
await page.click('.flow-list .flow-step >> nth=0'); await sleep(700)
const merged = await selected()
check('picking a step whose line merged into a package line lights that line', Boolean(merged?.split(' ').includes(KEYS[0])), String(merged))
await page.click('.flow-list .flow-step >> nth=1'); await sleep(700)
check('picking a step inside one folded package lights the package', await page.evaluate(() => Boolean(document.querySelector('.stage-inner > svg .cv-node.cv-sel[data-target="core"]'))))
await shot('folded')

// A sequence map reads in order already: no list.
await show(SEQ)
check('a sequence map has no flow list', !(await page.$('.flow-list')))

check('no page errors', !errors.length, errors.join(' | '))
await browser.close()
for (const m of [NAME, SEQ]) await call('DELETE', `/api/canvas/${m}?ws=${W}`)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
