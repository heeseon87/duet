// The legend over the map's top right corner names every kind of arrow the diagram can draw, drawn on the map or not,
// in the terms Korean UML texts use, with the UML name and meaning on hover; it keeps clear of the flow list at the top
// left as the window narrows, wrapping a group at a time. A sequence map's legend names its three kinds of message.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> [DUET_SHOTS=/dir] node e2e/legend.mjs
//   (makes and removes maps named legend-class and legend-seq)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const W = encodeURIComponent(ws)
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }

await call('POST', '/api/workspaces', { path: ws })
for (const n of ['legend-class', 'legend-seq']) await call('DELETE', `/api/canvas/${n}?ws=${W}`).catch(() => {})
// Only dependencies, in steps with long labels: a wide flow list holds the top left, and no other kind of line is on
// the map. Box states and an open decision make the legend long enough to run over it in a narrower window.
await call('POST', '/api/canvas', { ws, name: 'legend-class', diagram: 'class', title: '범례 시험 지도' })
await call('POST', '/api/canvas/legend-class/patch', { ws, note: '시험 지도', patch: {
  elements: [{ id: 'TransferGroupController', change: 'modify' }, { id: 'TransferGroupCreateService', change: 'add' }, { id: 'UserGroupRepository' }, { id: 'Fast', decision: 'D1', option: 'D1-a' }],
  relations: [
    { from: 'TransferGroupController', to: 'TransferGroupCreateService', kind: 'dependency', label: 'createTransferGroup(hostUserId, request)', step: 1 },
    { from: 'TransferGroupCreateService', to: 'UserGroupRepository', kind: 'dependency', label: 'saveAll(request.toUserGroupMembers())', step: 2 },
  ],
  decisions: [{ id: 'D1', question: '어느 쪽?', why: { tags: ['tie'], text: '무게가 같아.' }, options: [{ id: 'D1-a', text: 'A' }, { id: 'D1-b', text: 'B' }] }],
} })
await call('POST', '/api/canvas', { ws, name: 'legend-seq', diagram: 'sequence', title: '범례 시퀀스 시험' })
await call('POST', '/api/canvas/legend-seq/patch', { ws, note: '시험 지도', patch: {
  elements: [{ id: 'A' }, { id: 'B' }], messages: [{ id: 'm1', from: 'A', to: 'B', label: 'call()' }],
} })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1480, height: 900 })
const show = async name => {
  await page.evaluate(([w, n]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, n) }, [ws, name])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.stage-inner > svg', { timeout: 20000 }); await sleep(1200)
}
const legend = () => page.evaluate(() => {
  const l = document.querySelector('.map-legend'), r = l?.getBoundingClientRect(), f = document.querySelector('.flow-list')?.getBoundingClientRect()
  return {
    arrows: [...(l?.querySelectorAll('[data-arrow]') ?? [])].map(e => ({ kind: e.getAttribute('data-arrow'), text: e.textContent, title: e.title })),
    clear: Boolean(r && f) && r.left >= f.right, left: r && Math.round(r.left), flowRight: f && Math.round(f.right), rows: r && Math.round(r.height),
  }
})

// 1. A class map with dependencies alone: the legend names all six kinds of line, loosest tie first, in common terms.
await show('legend-class')
let l = await legend()
check('the legend names every kind of line a class map draws, though the map draws one', JSON.stringify(l.arrows.map(a => a.text)) === JSON.stringify(['연관', '의존', '일반화(상속)', '실체화(구현)', '집합', '합성']), JSON.stringify(l.arrows.map(a => a.text)))
check('each says its UML name and what it means on hover', l.arrows.every(a => /^[A-Z][a-z]+( message)? · /.test(a.title)) && l.arrows[0].title.startsWith('Association · ') && l.arrows[5].title.startsWith('Composition · '), JSON.stringify(l.arrows.map(a => a.title)))
if (shots) await page.screenshot({ path: `${shots}/legend-1480.png` })

// 2. Narrower, it keeps clear of the flow list: it wraps instead of running over it.
for (const width of [1100, 860]) {
  await page.setViewportSize({ width, height: 800 }); await sleep(700)
  l = await legend()
  check(`at ${width}px the legend keeps clear of the flow list`, l.clear && l.arrows.length === 6, JSON.stringify({ left: l.left, flowRight: l.flowRight, rows: l.rows }))
  if (shots) await page.screenshot({ path: `${shots}/legend-${width}.png` })
}
await page.setViewportSize({ width: 1480, height: 900 })

// 3. A sequence map with calls alone: the legend names its three kinds of message.
await show('legend-seq')
l = await legend()
check('a sequence map\'s legend names call, reply and async, though the map draws only calls', JSON.stringify(l.arrows.map(a => a.text)) === JSON.stringify(['호출', '응답', '비동기']), JSON.stringify(l.arrows))

for (const n of ['legend-class', 'legend-seq']) await call('DELETE', `/api/canvas/${n}?ws=${W}`).catch(() => {})
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
