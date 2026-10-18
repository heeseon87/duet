// Switching maps fits the new map as a first open does, from the map menu, the palette, or a map that loads slowly;
// the open map's own events (an agent edit, a comparison, a trip to the review tab) keep the person's zoom and pan.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_SHOTS=/dir node e2e/map-switch.mjs   (makes and removes maps switch-a and switch-b)
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
const A = { name: 'switch-a', title: '전환 시험 큰 지도', first: 'ingest1' }
const B = { name: 'switch-b', title: '전환 시험 작은 지도', first: 'Left' }
const term = 'map-switch-e2e-terminal'

for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === A.name || m.name === B.name) await call('DELETE', `/api/canvas/${m.name}?ws=${W}`)
const groups = ['ingest', 'process', 'store', 'notify']
await call('POST', '/api/canvas', { ws, name: A.name, diagram: 'class', title: A.title })
await call('POST', `/api/canvas/${A.name}/patch`, { ws, note: '큰 지도', patch: {
  elements: groups.flatMap(g => [{ id: g, kind: 'group' }, ...[1, 2, 3, 4].map(i => ({ id: `${g}${i}`, label: `${g} worker ${i}`, parent: g }))]),
  relations: groups.flatMap((g, k) => [...[1, 2, 3].map(i => ({ from: `${g}${i}`, to: `${g}${i + 1}` })), ...(k ? [{ from: `${groups[k - 1]}4`, to: `${g}1`, label: 'hand off' }] : [])]),
} })
await call('POST', '/api/canvas', { ws, name: B.name, diagram: 'class', title: B.title })
await call('POST', `/api/canvas/${B.name}/patch`, { ws, note: '작은 지도', patch: { elements: [{ id: 'Left', label: '왼쪽' }, { id: 'Right', label: '오른쪽' }], relations: [{ from: 'Left', to: 'Right', label: 'calls' }] } })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/switch-${n}.png` }) }
const camera = () => page.$eval('.stage-inner', e => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(e.style.transform)
  return m && { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])), k: Number(Number(m[3]).toFixed(3)) }
})
const same = (a, b) => Boolean(a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.k - b.k) < 0.01)
const show = (now, want) => JSON.stringify({ now, want })
const drawn = id => page.waitForSelector(`.stage-inner > svg [data-target="${id}"]`, { timeout: 20000 })
const inStage = () => page.evaluate(() => {
  const s = document.querySelector('.stage-canvas').getBoundingClientRect()
  const d = document.querySelector('.stage-inner > svg').getBoundingClientRect()
  return d.left >= s.left && d.top >= s.top && d.right <= s.right && d.bottom <= s.bottom
})
/** The camera a first open of the map gives: a reload with it current. */
const freshOpen = async m => {
  await page.evaluate(([w, names, cur]) => {
    localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, cur)
    localStorage.removeItem('duet.canvas.explore'); localStorage.removeItem('duet.canvas.wideInspector')
    for (const n of names) { localStorage.removeItem(`duet.canvas.collapsed:${w}:${n}`); localStorage.setItem(`duet.canvas.seen:${w}:${n}`, '99') }
  }, [ws, [A.name, B.name], m.name])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await drawn(m.first); await sleep(1200)
  return camera()
}

const freshA = await freshOpen(A)
const freshB = await freshOpen(B)
check('a first open fits each map, and the two fits differ', Boolean(freshA && freshB) && !same(freshA, freshB) && await inStage(), show(freshB, freshA))

// The person zooms in and pans on A.
await freshOpen(A)
for (let i = 0; i < 3; i++) { await page.click('button[title="Zoom in (+)"]'); await sleep(120) }
const stage = await page.$eval('.stage-canvas', e => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.top + 120 } })
await page.mouse.move(stage.x, stage.y); await page.mouse.down()
await page.mouse.move(stage.x - 150, stage.y - 100, { steps: 8 }); await page.mouse.up(); await sleep(500)
const mine = await camera()
check('zoomed in and panned', !same(mine, freshA) && mine.k > freshA.k, show(mine, freshA))

// An agent edit on the open map, and comparing it with the rev before, keep the person's camera.
await call('POST', '/api/terminals', { id: term, workspace: ws, cwd: ws, label: 'map-switch' })
await call('POST', `/api/terminals/${term}/tools/canvas_update`, { name: A.name, note: '에이전트 수정', elements: [{ id: 'notify4', label: 'notify worker four' }] })
await page.waitForFunction(() => document.querySelector('.stage-inner > svg [data-target="notify4"]')?.textContent.includes('four'), null, { timeout: 10000 }); await sleep(800)
check('an agent edit (a new rev) keeps the zoom and pan', same(await camera(), mine), show(await camera(), mine))
await page.click('button[title="Compare with previous"]')
await page.waitForSelector('.stage-inner > svg .cv-changed', { timeout: 10000 }).catch(() => {}); await sleep(800)
check('comparing with the rev before keeps them', same(await camera(), mine), show(await camera(), mine))
await page.keyboard.press('Meta+2'); await sleep(600)
await page.keyboard.press('Meta+1'); await drawn(A.first); await sleep(1000)
check('a trip to the review tab and back keeps them', same(await camera(), mine), show(await camera(), mine))
await shot('a-zoomed')

// Switching from the map menu, with B slow to load: B is drawn fitted, as a first open draws it.
await page.route(url => url.pathname === `/api/canvas/${B.name}`, async route => { await sleep(1500); await route.continue() })
await page.click('.map-pick'); await sleep(300)
await page.click(`.popover .menu-item:has-text("${B.title}")`)
await drawn(B.first); await sleep(1200)
await page.unroute(url => url.pathname === `/api/canvas/${B.name}`)
const atB = await camera()
check('the map menu: B opens fitted, as on a first open', same(atB, freshB), show(atB, freshB))
check('B lies inside the stage', await inStage())
await shot('b-switched')

// And back to A from the palette: fitted too, not where the person left it.
await page.keyboard.press('Meta+k'); await sleep(300)
await page.keyboard.type(A.title); await sleep(300)
await page.click(`.palette .menu-item:has-text("${A.title}")`)
await page.waitForFunction(() => !document.querySelector('.stage-inner > svg [data-target="Left"]'), null, { timeout: 10000 })
await drawn(A.first); await sleep(1200)
const backA = await camera()
check('the palette: back on A, it opens fitted again', same(backA, freshA), show(backA, freshA))
await shot('a-back')

await call('DELETE', `/api/terminals/${term}`)
await call('DELETE', `/api/canvas/${A.name}?ws=${W}`)
await call('DELETE', `/api/canvas/${B.name}?ws=${W}`)
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
