// Zooming to a part without the menu: hovering a box, a package or a line brings a zoom button (a package also gets
// fold and unfold), the pointer can reach it, and it frames that part; a pan or zoom puts it away. Double-clicking a
// box or a package frames it too (a package no longer folds that way); double-clicking a line still fits the map. With
// explore off, the info card a click opens narrows the stage, and framing centers in what is left.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_SHOTS=/dir node e2e/hover-zoom.mjs   (makes and removes a map named hover-zoom)
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
const NAME = 'hover-zoom'

for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === NAME) await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
await call('POST', '/api/canvas', { ws, name: NAME, diagram: 'class', title: '호버 확대 시험' })
await call('POST', `/api/canvas/${NAME}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'api', kind: 'group' }, { id: 'api1', label: 'Api one', parent: 'api' }, { id: 'api2', label: 'Api two', parent: 'api' },
    { id: 'auth', kind: 'group', parent: 'api' }, { id: 'auth1', label: 'Auth one', parent: 'auth' }, { id: 'auth2', label: 'Auth two', parent: 'auth' },
    { id: 'store', kind: 'group' }, { id: 'store1', label: 'Store one', parent: 'store' }, { id: 'store2', label: 'Store two', parent: 'store' },
  ],
  relations: [
    { from: 'api1', to: 'api2', label: 'calls' }, { from: 'api2', to: 'store1' }, { from: 'auth1', to: 'auth2' }, { from: 'store1', to: 'store2' }, { from: 'api1', to: 'auth1' },
  ],
} })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
// Explore mode: a click only lights a part, so no info card narrows the stage while we measure the middle.
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.setItem('duet.canvas.explore', '1') }, [ws, NAME])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target="store2"]', { timeout: 20000 }); await sleep(1200)
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/hover-zoom-${n}.png` }) }
const rect = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })
const node = id => `.stage-inner > svg .cv-node[data-target="${id}"]`
const cluster = id => `.stage-inner > svg .cv-cluster[data-target="${id}"]`
const stage = () => rect('.stage-canvas')
const toolbar = () => page.$('.stage-hover')
const buttons = () => page.$$eval('.stage-hover button', bs => bs.map(b => b.title))
/** The part's middle lies in the stage's middle. */
const centered = async sel => { const s = await stage(), r = await rect(sel); return { ok: Math.abs(r.x - s.x) < 10 && Math.abs(r.y - s.y) < 10, dx: Math.round(r.x - s.x), dy: Math.round(r.y - s.y) } }

// 1. A box: one button, above its top right corner, reachable, and it frames the box.
await page.keyboard.press('f'); await sleep(600)
let b = await rect(node('store2'))
await page.mouse.move(b.x, b.y); await sleep(80)
check('the button waits a moment before showing', !(await toolbar()))
await sleep(300)
const bar = (await toolbar()) && await rect('.stage-hover')
check('hovering a box shows its zoom button', JSON.stringify(await buttons()) === '["Zoom to this (double-click)"]', JSON.stringify(await buttons()))
check('beside the box, at its top right corner', bar && bar.left >= b.right && bar.left - b.right < 10 && Math.abs(bar.top - b.top) < 2, JSON.stringify({ bar, box: b }))
await shot('box')
// Over empty canvas first, as a hand travelling to the button would go.
await page.mouse.move(bar.left - 2, bar.y); await sleep(100)
await page.mouse.move(bar.x, bar.y); await sleep(400)
check('the pointer can reach the button', Boolean(await toolbar()))
const before = await page.$eval('.zoom-readout', e => e.textContent)
await page.mouse.click(bar.x, bar.y); await sleep(700)
check('clicking it frames the box in the middle', (await centered(node('store2'))).ok, JSON.stringify(await centered(node('store2'))))
check('and zooms in', await page.$eval('.zoom-readout', e => e.textContent) !== before, `${before} → ${await page.$eval('.zoom-readout', e => e.textContent)}`)
check('the button goes away with the move', !(await toolbar()))
check('clicking the button did not pick or unpick anything under it', !(await page.$('.stage-inner > svg .cv-sel')))

// 2. A pan or a zoom puts it away.
b = await rect(node('store2'))
await page.mouse.move(b.x, b.y); await sleep(400)
check('back over the box, the button is back', Boolean(await toolbar()))
await page.mouse.wheel(0, 120); await sleep(300)
check('the wheel puts it away', !(await toolbar()))

// 3. A package: zoom, and fold then unfold with its own button.
await page.keyboard.press('f'); await sleep(600)
let c = await rect(`${cluster('store')} rect`)
await page.mouse.move(c.left + 12, c.top + 8); await sleep(400)
check('hovering a package shows zoom and Collapse', JSON.stringify(await buttons()) === '["Zoom to this (double-click)","Collapse"]', JSON.stringify(await buttons()))
await shot('package')
await page.click('.stage-hover button[title="Collapse"]'); await sleep(1200)
check('Collapse folds the package', Boolean(await page.$(node('store'))) && !(await page.$(cluster('store'))))
const folded = await rect(node('store'))
await page.mouse.move(folded.x, folded.y); await sleep(400)
check('the folded package offers Expand', (await buttons()).includes('Expand'), JSON.stringify(await buttons()))
await page.click('.stage-hover button[title="Expand"]'); await sleep(1200)
check('Expand unfolds it', Boolean(await page.$(cluster('store'))))
check('an ordinary box has no fold button', await (async () => { const r = await rect(node('api1')); await page.mouse.move(r.x, r.y); await sleep(400); return !(await buttons()).some(t => t === 'Collapse' || t === 'Expand') })())

// 4. Double-click: a box or a package frames it; the package stays open.
await page.keyboard.press('f'); await sleep(600)
b = await rect(node('auth2'))
await page.mouse.dblclick(b.x, b.y); await sleep(700)
check('double-clicking a box frames it', (await centered(node('auth2'))).ok, JSON.stringify(await centered(node('auth2'))))
// The pointer arrived and double-clicked at once: the button's moment came mid-glide, and it is not placed where the box passed.
check('a double-click on arrival leaves no stray button', !(await toolbar()))
await page.keyboard.press('f'); await sleep(600)
c = await rect(`${cluster('auth')} rect`)
await page.mouse.dblclick(c.left + 12, c.top + 8); await sleep(700)
check('double-clicking a package frames it', (await centered(`${cluster('auth')} rect`)).ok, JSON.stringify(await centered(`${cluster('auth')} rect`)))
check('and leaves it unfolded', Boolean(await page.$(cluster('auth'))) && !(await page.$(node('auth'))))
await shot('package-framed')

// 5. A line: the button sits beside the pointer and frames both ends.
await page.keyboard.press('f'); await sleep(600)
// The line between the packages, unlabeled: hovered on the line itself.
const ends = ['api2', 'store1'], key = 'api2->store1:association'
const pointOn = k => page.evaluate(k => {
  for (const hit of document.querySelectorAll(`.stage-inner > svg .cv-edge-hit[data-target="${CSS.escape(k)}"]`)) {
    const r = hit.getBoundingClientRect()
    for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
      const x = r.left + (r.width * i) / 30, y = r.top + (r.height * j) / 30
      const el = document.elementFromPoint(x, y)
      if (el?.matches('.cv-edge-hit') && el.getAttribute('data-target') === k) return { x, y }
    }
  }
}, k)
const at = await pointOn(key)
await page.mouse.move(at.x, at.y); await sleep(400)
const lineBar = (await toolbar()) && await rect('.stage-hover')
check('hovering a line shows its zoom button beside the pointer', lineBar && JSON.stringify(await buttons()) === '["Zoom to this"]' && Math.abs(lineBar.left - at.x - 12) < 3 && lineBar.bottom < at.y, JSON.stringify({ lineBar, at, buttons: await buttons() }))
await shot('line')
await page.click('.stage-hover button'); await sleep(700)
const s = await stage()
const inView = await Promise.all(ends.map(async id => { const r = await rect(node(id)); return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom }))
check('it frames the line with both its boxes', ends.length === 2 && inView.every(Boolean), JSON.stringify({ key, ends, inView }))
const zoomed = await page.$eval('.zoom-readout', e => e.textContent)
const now = await pointOn(key)
await page.mouse.dblclick(now.x, now.y); await sleep(700)
check('double-clicking a line still fits the whole map', await page.$eval('.zoom-readout', e => e.textContent) !== zoomed, `${zoomed} → ${await page.$eval('.zoom-readout', e => e.textContent)}`)

await page.mouse.move(5, 5); await sleep(400)
check('leaving the stage puts the button away', !(await toolbar()))

// 6. Explore off, as by default: a click opens the info card, and framing centers in what the card leaves of the stage.
await page.evaluate(() => localStorage.setItem('duet.canvas.explore', '0'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target="store2"]', { timeout: 20000 }); await sleep(1200)
const leftOf = async sel => {
  const s = await stage(), r = await rect(sel), card = Boolean(await page.$('.inspector'))
  const aw = s.w - (card ? 364 : 0)
  return { ok: card && Math.abs(r.x - (s.left + aw / 2)) < 10 && Math.abs(r.y - s.y) < 10, dx: Math.round(r.x - (s.left + aw / 2)), dy: Math.round(r.y - s.y), card }
}
await page.keyboard.press('f'); await sleep(600)
b = await rect(node('store2'))
await page.mouse.dblclick(b.x, b.y); await sleep(800)
check('explore off: double-clicking a box centers it beside the info card', (await leftOf(node('store2'))).ok, JSON.stringify(await leftOf(node('store2'))))
await page.keyboard.press('f'); await sleep(600)
b = await rect(node('api1'))
await page.mouse.move(b.x, b.y); await sleep(400)
await page.click('.stage-hover button[title^="Zoom"]'); await sleep(800)
check('explore off: the button centers it beside the info card', (await leftOf(node('api1'))).ok, JSON.stringify(await leftOf(node('api1'))))
await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
