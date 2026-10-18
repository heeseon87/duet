// Canvas right-click menu: what it offers per part, zoom to a part, unfolding one package alone,
// asking, and the empty-canvas menu.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=... DUET_MAP=<class map with packages> DUET_SHOTS=/dir node e2e/canvas-menu.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_MAP: mapName, DUET_SHOTS: shots } = process.env
const theme = process.env.DUET_THEME ?? 'light'
const { browser, page, errors } = await open({ port, token: T, ws, width: 1600, height: 1000, theme })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${theme}-menu-${name}.png` }) }
await page.evaluate(([w, m]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m)
  localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.removeItem('duet.canvas.explore')
}, [ws, mapName])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 20000 }); await sleep(1500)
await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(700)
const map = await page.evaluate(async ([w, m]) => (await (await fetch(`/api/canvas/${m}?ws=${encodeURIComponent(w)}`)).json()).map, [ws, mapName])

const menuLabels = () => page.$$eval('.ctx-menu .menu-item', bs => bs.map(b => b.textContent.trim()))
const clickItem = label => page.click(`.ctx-menu .menu-item:has-text("${label}")`)
const stageRect = () => page.$eval('.stage-canvas', e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
// A class box with lines, well on screen.
const pickNode = () => page.evaluate(ids => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  for (const n of document.querySelectorAll('.stage-inner > svg .cv-node:not([data-group])')) {
    const id = n.getAttribute('data-target')
    if (!ids.includes(id)) continue
    const b = n.getBoundingClientRect()
    if (b.left > stage.left + 20 && b.right < stage.right - 60 && b.top > stage.top + 40 && b.bottom < stage.bottom - 60) return { x: b.left + b.width / 2, y: b.top + 10, id }
  }
  return null
}, map.relations.flatMap(r => [r.from, r.to]))

// 1. A class box: the menu speaks about it, lights it, leaves the info card alone.
const node = await pickNode()
await page.mouse.click(node.x, node.y, { button: 'right' }); await sleep(300)
const head = await page.$eval('.ctx-menu .ctx-head', e => e.textContent).catch(() => '')
const labels = await menuLabels()
const lit = await page.evaluate(id => Boolean(document.querySelector(`.stage-inner > svg .cv-node.cv-sel[data-target="${CSS.escape(id)}"]`)), node.id)
const el = map.elements.find(e => e.id === node.id)
check('right click on a box opens its menu and lights it', head.includes(el.label ?? el.id) && lit && !(await page.$('.inspector')), head)
check('box menu: ask, zoom, info card', ['에이전트에게 묻기', 'Zoom to selection', '정보 카드에서 보기'].every(l => labels.some(x => x.startsWith(l))), labels.join(' | '))
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
await page.keyboard.press('ArrowDown')
const moved = await page.evaluate(() => document.activeElement?.textContent?.trim())
check('arrow keys move through the menu', focused?.startsWith('에이전트에게 묻기') && moved !== focused, `${focused} → ${moved}`)
await shot('box')

// 2. Zoom to it: the box ends up in the middle of the free stage, larger.
const kBefore = await page.$eval('.zoom-readout', e => parseInt(e.textContent))
await clickItem('Zoom to selection'); await sleep(600)
const after = await page.evaluate(id => { const r = document.querySelector(`.stage-inner > svg .cv-node[data-target="${CSS.escape(id)}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, node.id)
const st = await stageRect()
const kAfter = await page.$eval('.zoom-readout', e => parseInt(e.textContent))
const midX = st.left + (st.right - st.left) / 2, midY = st.top + (st.bottom - st.top) / 2
check('zoom to a box centers it and zooms in', Math.abs(after.x - midX) < 40 && Math.abs(after.y - midY) < 40 && kAfter > kBefore, `${Math.round(after.x)},${Math.round(after.y)} vs ${Math.round(midX)},${Math.round(midY)} · ${kBefore}%→${kAfter}%`)
check('the menu closes after an action', !(await page.$('.ctx-menu')))

// 4. Unfold one package alone: every other package folds; that one is framed.
const parents = new Set(map.elements.map(e => e.parent).filter(Boolean))
const foldable = map.elements.filter(e => e.kind === 'group' && parents.has(e.id))
const top = foldable.find(g => !g.parent && foldable.some(o => o.id !== g.id && !o.parent))
await page.keyboard.press('f'); await sleep(600)
const cl = await page.$eval(`.stage-inner > svg .cv-cluster[data-target="${top.id}"] rect`, r => { const b = r.getBoundingClientRect(); return { x: b.left + 14, y: b.top + 8 } })
await page.mouse.click(cl.x, cl.y, { button: 'right' }); await sleep(250)
const pkgLabels = await menuLabels()
check('package menu adds fold and "unfold this one only"', pkgLabels.some(l => l.startsWith('Collapse')) && pkgLabels.some(l => l.startsWith('이것만 펼치기')), pkgLabels.join(' | '))
await clickItem('이것만 펼치기'); await sleep(1600)
const solo = await page.evaluate(([w, m, id]) => {
  const folded = JSON.parse(localStorage.getItem(`duet.canvas.collapsed:${w}:${m}`) ?? '[]')
  const svg = document.querySelector('.stage-inner > svg')
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  const r = svg.querySelector(`.cv-cluster[data-target="${id}"]`)?.getBoundingClientRect()
  return { folded, clusters: [...svg.querySelectorAll('.cv-cluster')].map(c => c.getAttribute('data-target')), framed: r ? r.left >= stage.left - 2 && r.right <= stage.right + 2 && r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2 : false, overlays: document.querySelectorAll('.morph-overlay').length }
}, [ws, mapName, top.id])
const others = foldable.filter(g => g.id !== top.id && !g.parent).map(g => g.id)
check('"unfold this one only" folds every other top package and keeps this one open', !solo.folded.includes(top.id) && others.every(id => solo.folded.includes(id)) && solo.clusters.includes(top.id), JSON.stringify({ folded: solo.folded.length, others: others.length }))
check('"unfold this one only" frames the package after the fold settles', solo.framed && solo.overlays === 0)
await shot('solo')
// A folded package box offers unfolding too (the whole map in view, so one is on screen).
await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(700)
const box = await page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  for (const n of document.querySelectorAll('.stage-inner > svg .cv-node[data-group]')) {
    const b = n.getBoundingClientRect()
    if (b.left > stage.left + 10 && b.right < stage.right - 10 && b.top > stage.top + 10 && b.bottom < stage.bottom - 10) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }
  return null
})
if (box) {
  await page.mouse.click(box.x, box.y, { button: 'right' }); await sleep(250)
  const fl = await menuLabels()
  check('a folded package box offers unfold and "unfold this one only"', fl.some(l => l.startsWith('Expand')) && fl.some(l => l.startsWith('이것만 펼치기')), fl.join(' | '))
  await page.keyboard.press('Escape'); await sleep(150)
} else console.log('SKIP no folded package box on screen')
await page.click('button:has-text("Expand all")'); await sleep(1200)

// A relation: right click on its label; zoom frames both ends.
await page.keyboard.press('f'); await sleep(600)
const lab = await page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  for (const l of document.querySelectorAll('.stage-inner > svg .cv-label[data-target]')) {
    const b = l.getBoundingClientRect()
    if (b.width > 4 && b.left > stage.left + 20 && b.right < stage.right - 60 && b.top > stage.top + 40 && b.bottom < stage.bottom - 60) return { x: b.left + b.width / 2, y: b.top + b.height / 2, key: l.getAttribute('data-target') }
  }
  return null
})
await page.mouse.click(lab.x, lab.y, { button: 'right' }); await sleep(250)
const relHead = await page.$eval('.ctx-menu .ctx-head', e => e.textContent).catch(() => '')
check('right click on a line label opens the line menu', relHead.includes('관계선'), relHead)
await clickItem('Zoom to selection'); await sleep(600)
const [rf, rt] = lab.key.split(':')[0].split('->')
const ends = await page.evaluate(ids => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  return ids.map(id => { const n = document.querySelector(`.stage-inner > svg [data-target="${CSS.escape(id)}"]:is(.cv-node, .cv-cluster)`); if (!n) return false; const b = n.getBoundingClientRect(); return b.left >= stage.left - 2 && b.right <= stage.right + 2 && b.top >= stage.top - 2 && b.bottom <= stage.bottom + 2 })
}, [rf, rt])
check('zoom to a line frames both of its ends', ends.every(Boolean), `${rf} → ${rt}: ${ends}`)
await page.keyboard.press('Escape'); await sleep(150)

// Control-click (a Mac's right click) does not pick, so it never opens the info card.
await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(600)
const n4 = await pickNode()
await page.keyboard.down('Control'); await page.mouse.click(n4.x, n4.y); await page.keyboard.up('Control'); await sleep(300)
await page.keyboard.press('Escape'); await sleep(150)
check('control-click does not open the info card', !(await page.$('.inspector')))

// 5. Ask: a card at the click, focused; Esc closes it without sending.
await page.keyboard.press('f'); await sleep(600)
const n3 = await pickNode()
await page.mouse.click(n3.x, n3.y, { button: 'right' }); await sleep(250)
await clickItem('에이전트에게 묻기'); await sleep(300)
const ask = await page.evaluate(() => ({ card: Boolean(document.querySelector('.ctx-ask')), focused: document.activeElement?.tagName, head: document.querySelector('.ctx-ask-head')?.textContent }))
check('ask opens a focused box about the part', ask.card && ask.focused === 'TEXTAREA' && ask.head.includes('에 대해 묻기'), JSON.stringify(ask))
await page.keyboard.type('테스트')
await page.mouse.click(st.left + 10, st.bottom - 30); await sleep(200)
check('the ask box survives a click elsewhere (typed text is not lost)', Boolean(await page.$('.ctx-ask')))
await page.focus('.ctx-ask textarea'); await page.keyboard.press('Escape'); await sleep(200)
check('Esc closes the ask box', !(await page.$('.ctx-ask')))

// 6. Code: a box with files opens it in review.
const withFile = map.elements.find(e => e.files?.length === 1 && e.kind !== 'group')
if (withFile) {
  await page.keyboard.press('f'); await sleep(600)
  const p = await page.$eval(`.stage-inner > svg .cv-node[data-target="${withFile.id}"]`, n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 8 } }).catch(() => null)
  if (p) {
    await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(250)
    await clickItem('코드 열기'); await sleep(800)
    const tab = await page.evaluate(() => localStorage.getItem('duet.tab'))
    check('"open code" jumps to the file in review', tab === 'review', tab)
    await page.keyboard.press('Meta+1'); await sleep(800)
  }
} else console.log('SKIP no element with one file')

// 7. Empty canvas: the map menu.
await page.waitForSelector('.stage-canvas svg .cv-node'); await page.keyboard.press('f'); await sleep(600)
const empty = await page.evaluate(() => { const r = document.querySelector('.stage-canvas').getBoundingClientRect(); return { x: r.left + 8, y: r.bottom - 40 } })
await page.mouse.click(empty.x, empty.y, { button: 'right' }); await sleep(250)
const emptyLabels = await menuLabels()
check('empty canvas menu: fit, fold all, explore, info card, Mermaid', ['Zoom to fit', 'Collapse all', '탐색 모드 켜기', '정보 카드', 'Mermaid로 복사'].every(l => emptyLabels.some(x => x.startsWith(l))), emptyLabels.join(' | '))
await shot('empty')
await clickItem('탐색 모드 켜기'); await sleep(300)
check('the menu turns explore mode on', await page.$eval('button:has-text("탐색")', b => b.getAttribute('aria-pressed') === 'true'))
await page.keyboard.press('e'); await sleep(200)
await page.mouse.click(empty.x, empty.y, { button: 'right' }); await sleep(250)
await page.keyboard.press('Escape'); await sleep(200)
check('Esc closes the menu', !(await page.$('.ctx-menu')))
await page.mouse.click(empty.x, empty.y, { button: 'right' }); await sleep(250)
// Well away from the menu (it opens upward from the bottom-left corner).
await page.mouse.click(st.right - 200, st.top + 120); await sleep(200)
check('a click outside closes the menu', !(await page.$('.ctx-menu')))

await page.evaluate(([w, m]) => { localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`); localStorage.removeItem('duet.canvas.explore') }, [ws, mapName])

// 8. Order: move a package, then a class, right past its neighbor in the row; the map keeps it as a revision.
const orderMap = process.env.DUET_ORDER
if (orderMap) {
  await page.evaluate(([w, m]) => { localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`) }, [ws, orderMap])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 20000 }); await sleep(1200)
  const api = async () => page.evaluate(async ([w, m]) => (await (await fetch(`/api/canvas/${m}?ws=${encodeURIComponent(w)}`)).json()), [ws, orderMap])
  // A top-level package with another one right beside it in the same row, both on screen.
  const pair = m => page.evaluate(els => {
    const svg = document.querySelector('.stage-inner > svg')
    const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
    const rect = id => svg.querySelector(`[data-target="${CSS.escape(id)}"]:is(.cv-node, .cv-cluster)`)?.getBoundingClientRect()
    const vis = r => r && r.left > stage.left && r.right < stage.right && r.top > stage.top && r.bottom < stage.bottom
    const tops = els.filter(e => e.kind === 'group' && !e.parent)
    for (const a of tops) {
      const ra = rect(a.id)
      if (!vis(ra)) continue
      let best
      for (const b of tops) {
        const rb = rect(b.id)
        if (b.id === a.id || !vis(rb)) continue
        if (Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) < 0.3 * Math.min(ra.height, rb.height)) continue
        const d = (rb.left + rb.width / 2) - (ra.left + ra.width / 2)
        if (d > 0 && (!best || d < best.d)) best = { id: b.id, d }
      }
      if (best) return { a: a.id, b: best.id, at: { x: ra.left + 14, y: ra.top + 8 } }
    }
    return null
  }, m.elements)
  const cx = id => page.$eval(`.stage-inner > svg [data-target="${id}"]:is(.cv-node, .cv-cluster)`, n => { const r = n.getBoundingClientRect(); return r.left + r.width / 2 })
  await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(700)
  const before = await api()
  const p = await pair(before.map)
  await page.mouse.click(p.at.x, p.at.y, { button: 'right' }); await sleep(250)
  const ml = await page.$$eval('.ctx-menu .menu-item', bs => bs.map(b => ({ t: b.textContent.trim(), off: b.disabled })))
  const right = ml.find(x => x.t.startsWith('오른쪽으로 옮기기'))
  check('a top-level package menu offers moving left and right', Boolean(right && !right.off) && ml.some(x => x.t.startsWith('왼쪽으로 옮기기')), ml.map(x => x.t + (x.off ? '(off)' : '')).join(' | '))
  let slid = false
  const watch = page.waitForSelector('.morph-overlay', { timeout: 4000 }).then(() => { slid = true }).catch(() => {})
  await page.click('.ctx-menu .menu-item:has-text("오른쪽으로 옮기기")')
  await watch; await sleep(1200)
  const after = await api()
  const [xa, xb] = [await cx(p.a), await cx(p.b)]
  const idx = (m, id) => m.elements.findIndex(e => e.id === id)
  check('moving a package right puts it past its neighbor, as a new revision, sliding', xa > xb && after.revision === before.revision + 1 && Math.sign(idx(after.map, p.a) - idx(after.map, p.b)) !== Math.sign(idx(before.map, p.a) - idx(before.map, p.b)) && slid, `${p.a} ${Math.round(xa)} vs ${p.b} ${Math.round(xb)} · rev ${before.revision}→${after.revision} · slid ${slid}`)
  await shot('moved-package')
  // Classes and packages inside packages: the lines decide their place, so no moving.
  await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(700)
  const inner = await page.evaluate(els => {
    const svg = document.querySelector('.stage-inner > svg')
    const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
    const at = (id, cluster) => { const n = svg.querySelector(`[data-target="${CSS.escape(id)}"]${cluster ? '.cv-cluster rect' : '.cv-node'}`); const r = n?.getBoundingClientRect(); return r && r.left > stage.left && r.right < stage.right && r.top > stage.top && r.bottom < stage.bottom ? { x: r.left + (cluster ? 14 : r.width / 2), y: r.top + (cluster ? 8 : 10) } : null }
    const cls = els.find(e => e.kind !== 'group' && at(e.id, false))
    const nested = els.find(e => e.kind === 'group' && e.parent && at(e.id, true))
    return [cls && at(cls.id, false), nested && at(nested.id, true)].filter(Boolean)
  }, after.map.elements)
  let none = inner.length > 0
  for (const q of inner) {
    await page.mouse.click(q.x, q.y, { button: 'right' }); await sleep(250)
    if ((await menuLabels()).some(l => l.includes('옮기기'))) none = false
    await page.keyboard.press('Escape'); await sleep(150)
  }
  check('classes and nested packages offer no moving (their lines place them)', none, `${inner.length} checked`)
  await page.evaluate(([w, m]) => localStorage.setItem(`duet.canvas.current:${w}`, m), [ws, mapName])
}

// 9. A sequence map: actors (drawn twice) zoom to one box; a message zooms to itself.
const seq = process.env.DUET_SEQ
if (seq) {
  await page.evaluate(([w, m]) => localStorage.setItem(`duet.canvas.current:${w}`, m), [ws, seq])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.stage-canvas svg .cv-actor', { timeout: 20000 }); await sleep(1200)
  await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(600)
  const actor = await page.$eval('.stage-inner > svg .cv-actor', a => { const b = a.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: a.getAttribute('data-target') } })
  await page.mouse.click(actor.x, actor.y, { button: 'right' }); await sleep(250)
  const aLabels = await menuLabels()
  check('actor menu: ask, zoom, info card', ['에이전트에게 묻기', 'Zoom to selection', '정보 카드에서 보기'].every(l => aLabels.some(x => x.startsWith(l))), aLabels.join(' | '))
  const k0 = await page.$eval('.zoom-readout', e => parseInt(e.textContent))
  await clickItem('Zoom to selection'); await sleep(600)
  const k1 = await page.$eval('.zoom-readout', e => parseInt(e.textContent))
  check('zoom to an actor zooms in on one of its boxes, not the whole lifeline', k1 > k0, `${k0}% → ${k1}%`)
  await page.keyboard.press('f'); await sleep(600)
  const msg = await page.evaluate(() => {
    const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
    for (const t of document.querySelectorAll('.stage-inner > svg .cv-msg-text[data-target]')) {
      const b = t.getBoundingClientRect()
      if (b.width > 4 && b.top > stage.top + 20 && b.bottom < stage.bottom - 20) return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: t.getAttribute('data-target') }
    }
    return null
  })
  await page.mouse.click(msg.x, msg.y, { button: 'right' }); await sleep(250)
  const mHead = await page.$eval('.ctx-menu .ctx-head', e => e.textContent).catch(() => '')
  await clickItem('Zoom to selection'); await sleep(600)
  const mOn = await page.evaluate(id => { const stage = document.querySelector('.stage-canvas').getBoundingClientRect(); const b = document.querySelector(`.stage-inner > svg .cv-msg-text[data-target="${CSS.escape(id)}"]`).getBoundingClientRect(); return b.left >= stage.left && b.right <= stage.right && b.top >= stage.top && b.bottom <= stage.bottom }, msg.id)
  const k2 = await page.$eval('.zoom-readout', e => parseInt(e.textContent))
  check('message menu, and zoom brings the message in close', mHead.includes('메시지') && mOn && k2 > k0, `${mHead} · ${k0}% → ${k2}%`)
  const st2 = await stageRect()
  await page.keyboard.press('Escape')
  await page.mouse.click(st2.left + 8, st2.bottom - 40, { button: 'right' }); await sleep(250)
  const seqEmpty = await menuLabels()
  check('sequence empty menu has no package items', seqEmpty.some(l => l.startsWith('Zoom to fit')) && !seqEmpty.some(l => /Collapse all|Expand all/.test(l)), seqEmpty.join(' | '))
  await page.keyboard.press('Escape')
  await shot('sequence')
  await page.evaluate(([w, m]) => localStorage.setItem(`duet.canvas.current:${w}`, m), [ws, mapName])
}
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
