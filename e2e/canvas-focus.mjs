// Canvas: nested packages select and fold, selection dims lightly, folding animates and cleans up.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=... DUET_SHOTS=/dir node e2e/canvas-focus.mjs   (makes and removes a map named canvas-focus)
//   or on a map of yours: DUET_MAP=<map with nested packages, more than three, and a made decision> DUET_NESTED=<nested package id>
import { open, sleep, toggleFold } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
const own = !process.env.DUET_MAP
const mapName = process.env.DUET_MAP ?? 'canvas-focus', nested = process.env.DUET_NESTED ?? 'rules'
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
if (own) {
  // Four packages, one inside another, a flow through them, and a decision already made.
  await call('DELETE', `/api/canvas/${mapName}?ws=${encodeURIComponent(ws)}`).catch(() => {})
  await call('POST', '/api/canvas', { ws, name: mapName, diagram: 'class', title: '포커스 시험' })
  await call('POST', `/api/canvas/${mapName}/patch`, { ws, note: '시험 지도', patch: {
    elements: [
      { id: 'web', kind: 'group' }, { id: 'Ctl', parent: 'web' },
      { id: 'core', kind: 'group' }, { id: 'Svc', parent: 'core' }, { id: 'rules', kind: 'group', parent: 'core' }, { id: 'Policy', parent: 'rules' }, { id: 'Limit', parent: 'rules' },
      { id: 'data', kind: 'group' }, { id: 'Repo', parent: 'data' }, { id: 'Db', parent: 'data' },
      { id: 'ext', kind: 'group' }, { id: 'Mail', parent: 'ext' }, { id: 'Cache', parent: 'data', decision: 'D1', option: 'D1-a' },
    ],
    relations: [
      { from: 'Ctl', to: 'Svc', label: 'handle' }, { from: 'Svc', to: 'Policy' }, { from: 'Policy', to: 'Limit', kind: 'dependency' },
      { from: 'Svc', to: 'Repo' }, { from: 'Repo', to: 'Db' }, { from: 'Svc', to: 'Mail', kind: 'dependency' }, { from: 'Repo', to: 'Cache' },
    ],
    decisions: [{ id: 'D1', question: '캐시를 둘까?', why: { tags: ['tie'], text: '둘 다 맞아.' }, options: [{ id: 'D1-a', text: '둔다' }, { id: 'D1-b', text: '안 둔다' }] }],
  } })
  await call('POST', `/api/canvas/${mapName}/choose`, { ws, decision: 'D1', option: 'D1-a' })
}
const theme = process.env.DUET_THEME ?? 'light'
const { browser, page, errors } = await open({ port, token: T, ws, width: 1600, height: 1000, theme })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${theme}-${name}.png` }) }
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`) }, [ws, mapName])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 20000 }); await sleep(1500)
await page.mouse.click(5, 500); await page.keyboard.press('f'); await sleep(700)

const known = await page.evaluate(async ([w, m]) => (await (await fetch(`/api/canvas/${m}?ws=${encodeURIComponent(w)}`)).json()).map.elements.map(e => e.id), [ws, mapName])
const strays = await page.$$eval('.stage-inner > svg [data-target]', (els, ids) => els.filter(e => (e.classList.contains('cv-node') || e.classList.contains('cv-cluster')) && !ids.includes(e.getAttribute('data-target'))).map(e => e.getAttribute('data-target')), known)
check('every box maps to a map element', strays.length === 0, strays.join(','))

const clusterCenter = id => page.$eval(`.stage-inner > svg .cv-cluster[data-target="${id}"] rect`, r => { const b = r.getBoundingClientRect(); return { x: b.left + 12, y: b.top + 8 } })
// 2. A nested package lights everything inside it.
let c = await clusterCenter(nested)
await page.mouse.click(c.x, c.y); await sleep(500)
const sel = await page.evaluate(id => {
  const svg = document.querySelector('.stage-inner > svg')
  return {
    sel: svg.querySelector(`.cv-cluster[data-target="${id}"]`)?.classList.contains('cv-sel'),
    inside: svg.querySelectorAll('.cv-node.cv-in').length,
    dim: svg.querySelectorAll('.cv-node.cv-dim').length,
  }
}, nested)
check('a nested package selects and lights what it holds', sel.sel && sel.inside > 0, JSON.stringify(sel))
await shot('nested-selected')

// 1. Selecting a class: unrelated boxes stay readable, package frames stay.
await page.keyboard.press('Escape'); await sleep(200)
// A class box well inside the visible stage.
const node = await page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  const right = stage.right - 40
  for (const n of document.querySelectorAll('.stage-inner > svg .cv-node:not([data-group])')) {
    const b = n.getBoundingClientRect()
    if (b.left > stage.left + 20 && b.right < right && b.top > stage.top + 40 && b.bottom < stage.bottom - 40) return { x: b.left + b.width / 2, y: b.top + 12, id: n.getAttribute('data-target') }
  }
  return null
})
await page.mouse.click(node.x, node.y); await sleep(500)
const op = await page.evaluate(async ([w, m]) => {
  const svg = document.querySelector('.stage-inner > svg')
  const o = sel => { const e = svg.querySelector(sel); return e ? Number(getComputedStyle(e).opacity) : null }
  const sel = svg.querySelector('.cv-node.cv-sel')?.getAttribute('data-target')
  const flowing = [...svg.querySelectorAll('.cv-edge.cv-rel, .cv-edge.cv-sel')]
  // Each flowing line must run from the relation's `from` box toward its `to` box.
  const map = (await (await fetch(`/api/canvas/${m}?ws=${encodeURIComponent(w)}`)).json()).map
  const center = id => { const r = svg.querySelector(`[data-target="${CSS.escape(id)}"]:is(.cv-node, .cv-cluster)`)?.getBoundingClientRect(); return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  let forward = 0, backward = 0
  for (const path of flowing) {
    const key = path.getAttribute('data-target')
    const rel = map.relations.find(r => `${r.from}->${r.to}:${r.kind ?? 'association'}` === key)
    if (!rel) continue
    const p0 = path.getPointAtLength(0), ctm = path.getScreenCTM()
    const start = { x: p0.x * ctm.a + ctm.e, y: p0.y * ctm.d + ctm.f }
    const a = center(rel.from), b = center(rel.to)
    if (!a || !b) continue
    const d = q => Math.hypot(q.x - start.x, q.y - start.y)
    if (d(a) < d(b)) forward++; else backward++
  }
  return {
    unrelatedNode: o('.cv-node.cv-dim'), unrelatedCluster: o('.cv-cluster.cv-dim'), unrelatedEdge: o('.cv-edge.cv-dim'), sel: o('.cv-node.cv-sel'), selected: sel,
    flowing: flowing.length, animated: flowing.filter(p => getComputedStyle(p).animationName === 'cv-flow').length, forward, backward,
  }
}, [ws, mapName])
check('selecting dims the rest partly (boxes 0.55, frames 0.87, lines 0.33)', op.unrelatedNode === 0.55 && (op.unrelatedCluster === null || op.unrelatedCluster === 0.87) && (op.unrelatedEdge === null || op.unrelatedEdge === 0.33) && op.sel === 1, JSON.stringify(op))
check('the lines it touches flow', op.flowing > 0 && op.animated === op.flowing, JSON.stringify({ flowing: op.flowing, animated: op.animated }))
check('they flow from → to, the way the relation reads', op.forward > 0 && op.backward === 0, JSON.stringify({ forward: op.forward, backward: op.backward }))
await shot('class-selected')
await page.keyboard.press('Escape'); await sleep(300)

// 3. Folding animates, keeps the package's top-right corner (its fold button) in place, and cleans up after itself.
const wasBox = await page.$eval(`.stage-inner > svg .cv-cluster[data-target="${nested}"] rect`, r => { const b = r.getBoundingClientRect(); return { x: b.right, y: b.top } })
await toggleFold(page, nested)
await page.waitForSelector('.morph-overlay', { timeout: 3000 }).catch(() => {})
const during = await page.evaluate(() => ({ anims: document.getAnimations().filter(a => a instanceof CSSTransition === false).length, overlays: document.querySelectorAll('.morph-overlay').length }))
check('folding animates', during.anims > 0 && during.overlays === 1, JSON.stringify(during))
await sleep(60); await shot('folding-mid')
await sleep(700)
const done = await page.evaluate(id => {
  const svg = document.querySelector('.stage-inner > svg')
  const box = svg.querySelector(`.cv-node[data-target="${id}"]`)?.getBoundingClientRect()
  return {
    // The flowing lines of the selection run forever by design; only the fold's own animations must be gone.
    anims: document.getAnimations().filter(a => a.playState === 'running' && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length,
    overlays: document.querySelectorAll('.morph-overlay').length,
    inline: [...svg.querySelectorAll('[data-target]')].filter(e => e.style.transform || e.style.opacity).length,
    folded: Boolean(box), x: box?.right, y: box?.top,
  }
}, nested)
check('after folding: no animation, overlay or inline style left', done.anims === 0 && done.overlays === 0 && done.inline === 0 && done.folded, JSON.stringify(done))
check('the folded package kept its top-right corner', Math.abs(done.x - wasBox.x) < 6 && Math.abs(done.y - wasBox.y) < 6, JSON.stringify({ was: wasBox, now: { x: done.x, y: done.y } }))
await shot('folded')
// Quick double toggles must not leave two drawings behind.
await toggleFold(page, nested); await sleep(90)
await page.click('button[title="Collapse all packages"]'); await sleep(60)
await page.click('button[title="Expand all packages"]'); await sleep(900)
const calm = await page.evaluate(() => ({ svgs: document.querySelectorAll('.stage-inner > svg').length, overlays: document.querySelectorAll('.morph-overlay').length, clusters: document.querySelectorAll('.stage-inner > svg .cv-cluster').length }))
check('rapid toggles settle into one drawing, all unfolded', calm.svgs === 1 && calm.overlays === 0 && calm.clusters > 3, JSON.stringify(calm))
await page.click('button[title="Collapse all packages"]'); await sleep(900)
const all = await page.evaluate(() => ({ clusters: document.querySelectorAll('.stage-inner > svg .cv-cluster').length, groupBoxes: document.querySelectorAll('.stage-inner > svg .cv-node[data-group]').length }))
check('fold all leaves only package boxes', all.clusters === 0 && all.groupBoxes > 0, JSON.stringify(all))
await shot('all-folded')
await page.click('button[title="Expand all packages"]'); await sleep(900)
// Letting go of a selection: clicking empty canvas, or Esc.
const someBox = await page.$eval('.stage-inner > svg .cv-node:not([data-group])', n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 } })
const picked = () => page.evaluate(() => Boolean(document.querySelector('.stage-inner > svg .cv-sel')))
await page.mouse.click(someBox.x, someBox.y); await sleep(300)
const pickedNow = await picked()
const ring = await page.evaluate(() => {
  const r = document.querySelector('.stage-inner > svg .cv-ring'), c = r && getComputedStyle(r)
  const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.append(probe)
  const accent = getComputedStyle(probe).color; probe.remove()
  return c && { stroke: c.stroke, fill: c.fill, width: c.strokeWidth, accent }
})
check('the picked box is ringed in the accent, 2px, unfilled (not painted like the box by Mermaid)', ring?.stroke === ring?.accent && ring.fill === 'none' && ring.width === '2px', JSON.stringify(ring))
const empty = await page.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.left + r.width - 80, y: r.bottom - 80 } })
await page.mouse.click(empty.x, empty.y); await sleep(300)
check('a click picks a box; clicking empty canvas lets go', pickedNow && !(await picked()))
await page.mouse.click(someBox.x, someBox.y); await sleep(300)
await page.keyboard.press('Escape'); await sleep(300)
check('Esc lets go too', !(await picked()))
// Decisions made in the older design-map read as made: the chip counts them all made, quietly.
const chip = await page.$eval('.canvas-bar .dec-chip', c => ({ text: c.textContent.trim(), accent: c.classList.contains('accent') })).catch(() => null)
check('decided map: the chip counts every decision made, without the accent', Boolean(chip) && /^결정 (\d+)\/\1$/.test(chip.text) && !chip.accent, JSON.stringify(chip))
await shot('deselected')
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
if (own) await call('DELETE', `/api/canvas/${mapName}?ws=${encodeURIComponent(ws)}`)
process.exit(failed ? 1 : 0)
