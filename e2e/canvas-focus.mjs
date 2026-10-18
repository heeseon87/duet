// Canvas: nested packages select and fold, selection dims lightly, folding animates and cleans up.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=... DUET_MAP=<map with nested packages> DUET_NESTED=<nested package id> DUET_SHOTS=/dir node e2e/canvas-focus.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_MAP: mapName, DUET_NESTED: nested, DUET_SHOTS: shots } = process.env
const theme = process.env.DUET_THEME ?? 'light'
const { browser, page, errors } = await open({ port, token: T, ws, width: 1600, height: 1000, theme })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${theme}-${name}.png` }) }
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.removeItem('duet.canvas.explore') }, [ws, mapName])
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
const card = await page.$eval('.inspector', e => e.textContent).catch(e => 'ERR ' + e.message)
check('the info card opens for the nested package', card.includes(nested), card.slice(0, 120))
await shot('nested-selected')

// 1. Selecting a class: unrelated boxes stay readable, package frames stay.
await page.keyboard.press('Escape'); await sleep(200)
// A class box well inside the visible stage (not under the info card).
const node = await page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  const right = stage.right - 380
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

// 3. Folding animates, keeps the package in place, and cleans up after itself.
c = await clusterCenter(nested)
const wasBox = await page.$eval(`.stage-inner > svg .cv-cluster[data-target="${nested}"] rect`, r => { const b = r.getBoundingClientRect(); return { x: b.left, y: b.top } })
await page.mouse.dblclick(c.x, c.y)
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
    folded: Boolean(box), x: box?.left, y: box?.top,
  }
}, nested)
check('after folding: no animation, overlay or inline style left', done.anims === 0 && done.overlays === 0 && done.inline === 0 && done.folded, JSON.stringify(done))
check('the folded package stayed in place', Math.abs(done.x - wasBox.x) < 6 && Math.abs(done.y - wasBox.y) < 6, JSON.stringify({ was: wasBox, now: { x: done.x, y: done.y } }))
await shot('folded')
// Quick double toggles must not leave two drawings behind.
const nb = await page.$eval(`.stage-inner > svg .cv-node[data-target="${nested}"]`, n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 } })
await page.mouse.dblclick(nb.x, nb.y); await sleep(90)
await page.click('button:has-text("Collapse all")'); await sleep(60)
await page.click('button:has-text("Expand all")'); await sleep(900)
const calm = await page.evaluate(() => ({ svgs: document.querySelectorAll('.stage-inner > svg').length, overlays: document.querySelectorAll('.morph-overlay').length, clusters: document.querySelectorAll('.stage-inner > svg .cv-cluster').length }))
check('rapid toggles settle into one drawing, all unfolded', calm.svgs === 1 && calm.overlays === 0 && calm.clusters > 3, JSON.stringify(calm))
await page.click('button:has-text("Collapse all")'); await sleep(900)
const all = await page.evaluate(() => ({ clusters: document.querySelectorAll('.stage-inner > svg .cv-cluster').length, groupBoxes: document.querySelectorAll('.stage-inner > svg .cv-node[data-group]').length }))
check('fold all leaves only package boxes', all.clusters === 0 && all.groupBoxes > 0, JSON.stringify(all))
await shot('all-folded')
await page.click('button:has-text("Expand all")'); await sleep(900)
// Letting go of a selection puts the info card away: clicking empty canvas, or Esc. `i` brings the overview back.
const someBox = await page.$eval('.stage-inner > svg .cv-node:not([data-group])', n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 } })
await page.mouse.click(someBox.x, someBox.y); await sleep(300)
const shownOnPick = Boolean(await page.$('.inspector:not(.compact)'))
const empty = await page.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.left + 8, y: r.bottom - 40 } })
await page.mouse.click(empty.x, empty.y); await sleep(300)
check('picking shows the info card; clicking empty canvas hides it', shownOnPick && !(await page.$('.inspector')) && Boolean(await page.$('.insp-open')))
await page.mouse.click(someBox.x, someBox.y); await sleep(300)
await page.keyboard.press('Escape'); await sleep(300)
check('Esc lets go and hides the info card too', !(await page.$('.inspector')))
await page.keyboard.press('i'); await sleep(300)
// Decisions made in the older design-map read as made: nothing left to decide, each shows its pick.
const dec = await page.evaluate(() => ({
  left: [...document.querySelectorAll('.chip.accent')].some(c => /결정 \d+개 남음/.test(c.textContent)),
  sections: [...document.querySelectorAll('.inspector .insp-section h4')].map(h => h.textContent.trim()),
}))
check('decided map: nothing left to decide, decisions listed as made', !dec.left && dec.sections.some(t => t.startsWith('정한 결정')), JSON.stringify(dec))
await page.click('.inspector button[title="넓게 보기"]'); await sleep(300)
check('the info card widens', await page.$eval('.inspector', e => e.getBoundingClientRect().width > 500))
await page.click('.inspector button[title="좁게 보기"]'); await sleep(200)

// Explore mode: clicking only highlights; the info card neither opens nor closes on its own. Remembered.
const exploreBtn = 'button:has-text("탐색")'
const pressed = () => page.$eval(exploreBtn, b => b.getAttribute('aria-pressed') === 'true')
await page.keyboard.press('e'); await sleep(300)
check('explore on (e): the info card goes away', (await pressed()) && !(await page.$('.inspector')))
const boxes = await page.$$eval('.stage-inner > svg .cv-node:not([data-group])', ns => ns.slice(0, 2).map(n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10, id: n.getAttribute('data-target') } }))
await page.mouse.click(boxes[0].x, boxes[0].y); await sleep(400)
const lit = await page.evaluate(id => Boolean(document.querySelector(`.stage-inner > svg .cv-node.cv-sel[data-target="${CSS.escape(id)}"]`)), boxes[0].id)
check('explore: a click highlights without opening the info card', lit && !(await page.$('.inspector')) && Boolean(await page.$('.insp-open')))
await page.keyboard.press('i'); await sleep(300)
await page.mouse.click(boxes[1].x, boxes[1].y); await sleep(400)
const follows = await page.$eval('.inspector', e => e.textContent).catch(() => '')
await page.mouse.click(empty.x, empty.y); await sleep(300)
check('explore: a card opened by hand follows the pick and stays on empty clicks', follows.includes(boxes[1].id) && Boolean(await page.$('.inspector')))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-node', { timeout: 20000 }); await sleep(1200)
check('explore is remembered and opens with the card away', (await pressed()) && !(await page.$('.inspector')))
await page.click(exploreBtn); await page.keyboard.press('f'); await sleep(700)
// A box on screen (the reload does not restore the camera).
const again = await page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  for (const n of document.querySelectorAll('.stage-inner > svg .cv-node:not([data-group])')) {
    const b = n.getBoundingClientRect()
    if (b.left > stage.left + 20 && b.right < stage.right - 120 && b.top > stage.top + 40 && b.bottom < stage.bottom - 40) return { x: b.left + b.width / 2, y: b.top + 10 }
  }
  return { x: 0, y: 0 }
})
await page.mouse.click(again.x, again.y); await sleep(400)
check('explore off: a click opens the info card again', !(await pressed()) && Boolean(await page.$('.inspector')))
await shot('explore-off')
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
