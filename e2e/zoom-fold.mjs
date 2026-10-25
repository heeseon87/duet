// Zooming to a part and folding a package without the menu: double-clicking a box or a package frames it (a package no
// longer folds that way; a line or the empty canvas still fits the map), and every package that can fold shows its fold
// button on its frame's top edge at the right corner, with no pointer near it; the buttons wait while a fold slides and
// go with their corners through a wheel, a drag and a glide, shrinking as the map zooms out. With explore off, the info card a click opens narrows the
// stage, framing centers in what is left, and the card covers the buttons under it.
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
const groups = () => page.$$eval('.stage-fold', bs => bs.map(b => b.dataset.group).sort())
/** For each fold button, whether it stands on its package's top edge at the right corner (measured at one instant). */
const corners = (tol = 2) => page.evaluate(tol => {
  const out = {}
  for (const b of document.querySelectorAll('.stage-fold')) {
    const f = document.querySelector(`.stage-inner > svg [data-group="${CSS.escape(b.dataset.group)}"]`)?.getBoundingClientRect()
    const r = b.getBoundingClientRect()
    out[b.dataset.group] = Boolean(f) && Math.abs(r.top + r.height / 2 - f.top) < tol && Math.abs(r.right - (f.right - r.height * 8 / 22)) < tol
  }
  return out
}, tol)
const allOn = o => Object.keys(o).length > 0 && Object.values(o).every(Boolean)
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

// 1. Every package that can fold shows its button on its frame's top right corner, with the pointer nowhere near.
await page.mouse.move(1, 1)
await page.keyboard.press('f'); await sleep(600)
check('every foldable package has a button, unhovered', JSON.stringify(await groups()) === '["api","auth","store"]', JSON.stringify(await groups()))
check('each on its frame\'s top edge at the right corner', allOn(await corners()), JSON.stringify(await corners()))
const inner = await rect('.stage-fold[data-group="auth"]'), outer_ = await rect(cluster('api'))
check('a nested package\'s button stays inside its parent', inner.left > outer_.left && inner.right < outer_.right && inner.top > outer_.top, JSON.stringify({ inner, outer_ }))
await shot('package')

// 2. A click folds and unfolds; the buttons wait while the fold slides, then stand on the new frames.
await page.click('.stage-fold[data-group="store"]')
const waited = await page.waitForFunction(() => document.querySelector('.morph-overlay') && !document.querySelector('.stage-fold'), undefined, { timeout: 3000 }).then(() => true, () => false)
check('while the fold slides, the buttons wait', waited)
await sleep(1000)
check('Collapse folds the package', Boolean(await page.$(node('store'))) && !(await page.$(cluster('store'))))
check('clicking the button did not pick anything under it', !(await page.$('.stage-inner > svg .cv-sel')))
const title = id => page.$eval(`.stage-fold[data-group="${id}"]`, b => b.title).catch(() => null)
check('the folded package offers Expand', await title('store') === 'Expand', String(await title('store')))
check('after the fold, every button is on its new corner', allOn(await corners()), JSON.stringify(await corners()))
await page.click('.stage-fold[data-group="store"]'); await sleep(1200)
check('Expand unfolds it', Boolean(await page.$(cluster('store'))) && await title('store') === 'Collapse')

// 3. The buttons go with their corners: a wheel, a drag, and a glide all the way through.
const s0 = await stage()
await page.mouse.move(s0.left + 40, s0.bottom - 60)
await page.mouse.wheel(0, -240); await sleep(300)
check('after a wheel zoom, still on their corners', allOn(await corners()), JSON.stringify(await corners()))
// Zoomed out, the buttons shrink with the drawing (22px at 100%), and once smaller than 8px they are gone.
const sides = () => page.$$eval('.stage-fold', bs => [...new Set(bs.map(b => Math.round(b.getBoundingClientRect().height)))])
const steps = []
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 240); await sleep(300)
  const k = parseInt(await zoom()) / 100, want = Math.round(22 * Math.min(1, k)), got = await sides()
  // A small button still takes a click across 18px, off its own edge.
  const hit = want >= 8 && want < 16 ? await page.$eval('.stage-fold[data-group="store"]', b => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left - (18 - r.width) / 2 + 0.5, r.top + r.height / 2)?.closest('.stage-fold') === b }) : true
  steps.push({ k, want, got, hit, ok: want < 8 ? got.length === 0 : got.length === 1 && Math.abs(got[0] - want) <= 1 && allOn(await corners()) && hit })
}
check('zoomed out, the buttons shrink on their corners, then go', steps.every(x => x.ok) && steps.some(x => x.want < 16 && x.want >= 8) && steps.some(x => x.want < 8), JSON.stringify(steps))
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await sleep(80) }
await sleep(300)
await page.mouse.down(); await page.mouse.move(s0.left + 160, s0.bottom - 120, { steps: 6 }); await page.mouse.up(); await sleep(200)
check('after a drag, still on their corners', allOn(await corners()), JSON.stringify(await corners()))
await page.keyboard.press('f'); await sleep(140)
check('mid-glide, they move with the drawing', allOn(await corners(3)), JSON.stringify(await corners(3)))
await sleep(600)

// 4. Double-click: a box or a package frames it; the package stays open; a line or the empty canvas fits the map.
await page.keyboard.press('f'); await sleep(600)
let b = await rect(node('auth2'))
await page.mouse.dblclick(b.x, b.y); await sleep(700)
check('double-clicking a box frames it', (await centered(node('auth2'))).ok, JSON.stringify(await centered(node('auth2'))))
await page.keyboard.press('f'); await sleep(600)
let c = await rect(`${cluster('auth')} rect`)
await page.mouse.dblclick(c.left + 12, c.top + 8); await sleep(700)
check('double-clicking a package frames it', (await centered(`${cluster('auth')} rect`)).ok, JSON.stringify(await centered(`${cluster('auth')} rect`)))
check('and leaves it unfolded', Boolean(await page.$(cluster('auth'))) && !(await page.$(node('auth'))))
await shot('package-framed')
const zoomed = await zoom()
const now = await pointOn(line)
await page.mouse.dblclick(now.x, now.y); await sleep(700)
check('double-clicking a line fits the whole map', await zoom() !== zoomed, `${zoomed} → ${await zoom()}`)

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
// Slide the map sideways until the api package's top right corner lies under the card: the card covers its button.
await page.keyboard.press('f'); await sleep(600)
const card = await rect('.inspector'), s1 = await stage()
await page.mouse.move(s1.left + 30, s1.y)
for (let i = 0; i < 30 && (await rect(cluster('api'))).right < card.left + 60; i++) { await page.mouse.wheel(-40, 0); await sleep(30) }
await sleep(200)
const underCard = await page.evaluate(() => {
  const r = document.querySelector('.stage-fold[data-group="api"]')?.getBoundingClientRect()
  const c = document.querySelector('.inspector')?.getBoundingClientRect()
  return r && c && { under: r.left > c.left && r.top > c.top, covered: Boolean(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.inspector')) }
})
await shot('card')
check('a button under the info card is covered by it', underCard?.under && underCard.covered, JSON.stringify(underCard))

await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
