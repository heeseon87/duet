// Zooming to a part and folding a package without the menu: double-clicking a box or a package frames it (a package no
// longer folds that way; a line or the empty canvas still fits the map), and hovering a package or a box or line inside
// it brings that package's fold button (the innermost package's), which the pointer can reach; a pan or zoom puts it
// away, and outside every package nothing does. With explore off, the info card a click opens narrows the stage, and
// framing centers in what is left.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_SHOTS=/dir node e2e/zoom-fold.mjs   (makes and removes a map named zoom-fold)
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
const NAME = 'zoom-fold'

for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === NAME) await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
await call('POST', '/api/canvas', { ws, name: NAME, diagram: 'class', title: '확대·접기 시험' })
await call('POST', `/api/canvas/${NAME}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'api', kind: 'group' }, { id: 'api1', label: 'Api one', parent: 'api' }, { id: 'api2', label: 'Api two', parent: 'api' },
    { id: 'auth', kind: 'group', parent: 'api' }, { id: 'auth1', label: 'Auth one', parent: 'auth' }, { id: 'auth2', label: 'Auth two', parent: 'auth' },
    { id: 'store', kind: 'group' }, { id: 'store1', label: 'Store one', parent: 'store' }, { id: 'store2', label: 'Store two', parent: 'store' },
    { id: 'solo', label: 'Solo' },
  ],
  relations: [
    { from: 'api1', to: 'api2', label: 'calls' }, { from: 'api2', to: 'store1' }, { from: 'auth1', to: 'auth2' }, { from: 'store1', to: 'store2' }, { from: 'api1', to: 'auth1' },
    { from: 'solo', to: 'api1' },
  ],
} })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
// Explore mode: a click only lights a part, so no info card narrows the stage while we measure the middle.
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.setItem('duet.canvas.explore', '1') }, [ws, NAME])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target="store2"]', { timeout: 20000 }); await sleep(1200)
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/zoom-fold-${n}.png` }) }
const rect = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })
const node = id => `.stage-inner > svg .cv-node[data-target="${id}"]`
const cluster = id => `.stage-inner > svg .cv-cluster[data-target="${id}"]`
const stage = () => rect('.stage-canvas')
const toolbar = () => page.$('.stage-hover')
const buttons = () => page.$$eval('.stage-hover button', bs => bs.map(b => b.title))
const zoom = () => page.$eval('.zoom-readout', e => e.textContent)
/** The part's middle lies in the stage's middle. */
const centered = async sel => { const s = await stage(), r = await rect(sel); return { ok: Math.abs(r.x - s.x) < 10 && Math.abs(r.y - s.y) < 10, dx: Math.round(r.x - s.x), dy: Math.round(r.y - s.y) } }
/** A point on the line itself, not on a box or a label, inside every package in `inside` and outside every one in `outside`. */
const pointOn = (k, inside = [], outside = []) => page.evaluate(([k, inside, outside]) => {
  const frame = id => document.querySelector(`.stage-inner > svg .cv-cluster[data-target="${id}"]`)?.getBoundingClientRect()
  const within = (r, x, y) => Boolean(r) && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  for (const hit of document.querySelectorAll(`.stage-inner > svg .cv-edge-hit[data-target="${CSS.escape(k)}"]`)) {
    const r = hit.getBoundingClientRect()
    for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
      const x = r.left + (r.width * i) / 30, y = r.top + (r.height * j) / 30
      const el = document.elementFromPoint(x, y)
      if (!el?.matches('.cv-edge-hit') || el.getAttribute('data-target') !== k) continue
      if (inside.every(id => within(frame(id), x, y)) && !outside.some(id => within(frame(id), x, y))) return { x, y }
    }
  }
}, [k, inside, outside])
const line = 'api2->store1:association'

// 1. A package: its fold button, beside its top right corner, reachable; it folds and unfolds.
await page.keyboard.press('f'); await sleep(600)
let c = await rect(`${cluster('store')} rect`)
await page.mouse.move(c.left + 12, c.top + 8); await sleep(150)
check('hovering a package shows only its fold button', JSON.stringify(await buttons()) === '["Collapse"]', JSON.stringify(await buttons()))
const pkg = await rect(cluster('store'))
const bar = await rect('.stage-hover')
check('beside the package, at its top right corner', bar.left >= pkg.right && bar.left - pkg.right < 10 && Math.abs(bar.top - pkg.top) < 2, JSON.stringify({ bar, pkg }))
await shot('package')
// Over empty canvas first, as a hand travelling to the button would go.
await page.mouse.move(bar.left - 2, bar.y); await sleep(100)
await page.mouse.move(bar.x, bar.y); await sleep(400)
check('the pointer can reach the button', Boolean(await toolbar()))
await page.mouse.click(bar.x, bar.y); await sleep(1200)
check('Collapse folds the package', Boolean(await page.$(node('store'))) && !(await page.$(cluster('store'))))
check('clicking the button did not pick anything under it', !(await page.$('.stage-inner > svg .cv-sel')))
const folded = await rect(node('store'))
await page.mouse.move(folded.x, folded.y); await sleep(250)
check('the folded package offers Expand', JSON.stringify(await buttons()) === '["Expand"]', JSON.stringify(await buttons()))
await page.click('.stage-hover button[title="Expand"]'); await sleep(1200)
check('Expand unfolds it', Boolean(await page.$(cluster('store'))))

// 2. A pan or a zoom puts it away.
c = await rect(`${cluster('store')} rect`)
await page.mouse.move(c.left + 12, c.top + 8); await sleep(250)
check('back over the package, the button is back', Boolean(await toolbar()))
await page.mouse.wheel(0, 120); await sleep(300)
check('the wheel puts it away', !(await toolbar()))

// 3. Inside a package, a box or a line brings that package's button (the innermost one's); outside every package, nothing.
await page.keyboard.press('f'); await sleep(600)
/** The button stands beside this package's top right corner. */
const beside = async id => {
  const p = await rect(cluster(id)), t = (await toolbar()) && await rect('.stage-hover')
  return { ok: Boolean(t && t.left >= p.right && t.left - p.right < 10 && Math.abs(t.top - p.top) < 2), buttons: await buttons() }
}
let b = await rect(node('api1'))
await page.mouse.move(b.x, b.y); await sleep(250)
check('a box in a package brings the package\'s button', (await beside('api')).ok, JSON.stringify(await beside('api')))
b = await rect(node('auth1'))
await page.mouse.move(b.x, b.y); await sleep(250)
check('a box in a nested package brings the inner package\'s button', (await beside('auth')).ok, JSON.stringify(await beside('auth')))
const inApi = await pointOn('api1->api2:association', ['api'], ['auth'])
await page.mouse.move(inApi.x, inApi.y); await sleep(250)
check('a line inside a package brings the package\'s button', (await beside('api')).ok, JSON.stringify({ inApi, ...(await beside('api')) }))
b = await rect(node('solo'))
await page.mouse.move(b.x, b.y); await sleep(400)
check('a box outside every package brings no button', !(await toolbar()))
const between = await pointOn(line, [], ['api', 'store'])
await page.mouse.move(between.x, between.y); await sleep(400)
check('a line outside every package brings no button', !(await toolbar()), JSON.stringify(between))
b = await rect(node('store1'))
await page.mouse.move(b.x, b.y); await sleep(250)
await page.click('.stage-hover button'); await sleep(1200)
check('the button a box brings folds its package', Boolean(await page.$(node('store'))) && !(await page.$(cluster('store'))))
const shut = await rect(node('store'))
await page.mouse.move(shut.x, shut.y); await sleep(250)
await page.click('.stage-hover button[title="Expand"]'); await sleep(1200)

// 4. Double-click: a box or a package frames it; the package stays open; a line or the empty canvas fits the map.
await page.keyboard.press('f'); await sleep(600)
b = await rect(node('auth2'))
await page.mouse.dblclick(b.x, b.y); await sleep(700)
check('double-clicking a box frames it', (await centered(node('auth2'))).ok, JSON.stringify(await centered(node('auth2'))))
await page.keyboard.press('f'); await sleep(600)
c = await rect(`${cluster('auth')} rect`)
await page.mouse.dblclick(c.left + 12, c.top + 8); await sleep(700)
check('double-clicking a package frames it', (await centered(`${cluster('auth')} rect`)).ok, JSON.stringify(await centered(`${cluster('auth')} rect`)))
check('and leaves it unfolded', Boolean(await page.$(cluster('auth'))) && !(await page.$(node('auth'))))
// The pointer arrived and double-clicked at once: the button's moment came mid-glide, and it is not placed where the package passed.
check('a double-click on arrival leaves no stray button', !(await toolbar()))
await shot('package-framed')
const zoomed = await zoom()
const now = await pointOn(line)
await page.mouse.dblclick(now.x, now.y); await sleep(700)
check('double-clicking a line fits the whole map', await zoom() !== zoomed, `${zoomed} → ${await zoom()}`)

await page.mouse.move(c.left + 12, c.top + 8); await sleep(250)
await page.mouse.move(5, 5); await sleep(400)
check('leaving the stage puts the button away', !(await toolbar()))

// 5. Explore off, as by default: a click opens the info card, and framing centers in what the card leaves of the stage.
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
c = await rect(`${cluster('store')} rect`)
await page.mouse.dblclick(c.left + 12, c.top + 8); await sleep(800)
check('explore off: double-clicking a package centers it beside the info card', (await leftOf(`${cluster('store')} rect`)).ok, JSON.stringify(await leftOf(`${cluster('store')} rect`)))

await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
