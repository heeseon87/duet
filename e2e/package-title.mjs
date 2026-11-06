// Package titles: an open package is titled with its name (label), not its id, from the left, with its fold button at
// the end of the title's row; a name wider than the frame is cut with an ellipsis inside the frame and shown whole by the pointer (only then), even where a line coming into the package
// crosses the title; a package with no name keeps its id; a folded package shows its name too.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_SHOTS=/dir node e2e/package-title.mjs   (makes and removes a map named package-title)
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
const NAME = 'package-title'
const LONG = 'user.group.domain.service.transfer.policy.internal'

for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === NAME) await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
await call('POST', '/api/canvas', { ws, name: NAME, diagram: 'class', title: '패키지 제목 시험' })
await call('POST', `/api/canvas/${NAME}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'g_api', kind: 'group', label: 'user.group.controller' }, { id: 'GroupController', parent: 'g_api' }, { id: 'GroupSwagger', parent: 'g_api' },
    { id: 'g_long', kind: 'group', label: LONG }, { id: 'Pol', parent: 'g_long' },
    { id: 'plain', kind: 'group' }, { id: 'Store', parent: 'plain' },
  ],
  relations: [{ from: 'GroupController', to: 'Pol' }, { from: 'Pol', to: 'Store' }, { from: 'GroupSwagger', to: 'Store' }],
} })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/package-title-${n}.png` }) }
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`) }, [ws, NAME])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-cluster', { state: 'attached', timeout: 15000 }); await sleep(1200)
const title = id => page.evaluate(id => {
  const g = document.querySelector(`.stage-inner > svg .cv-cluster[data-target="${id}"]`), p = g?.querySelector('.cluster-label p'), frame = g?.querySelector(':scope > rect')
  if (!p || !frame) return null
  const pr = p.getBoundingClientRect(), fr = frame.getBoundingClientRect(), fold = document.querySelector(`.stage-fold[data-group="${id}"]`)?.getBoundingClientRect()
  const k = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.stage-inner').style.transform)?.[1] ?? 1)
  // Cut as drawn: the text's own box wider than its line (scrollWidth and clientWidth round, and miss a fraction).
  const range = document.createRange(); range.selectNodeContents(p)
  return { text: p.textContent, cut: range.getBoundingClientRect().width > pr.width + 0.5, ellipsis: getComputedStyle(p).textOverflow, inside: pr.left >= fr.left - 1 && pr.right <= fr.right + 1,
    clear: !fold || pr.right <= fold.left, atLeft: Math.abs(pr.left - fr.left - 12 * k) < 2,
    inRow: !fold || Math.abs((fold.top + fold.bottom) / 2 - (pr.top + pr.bottom) / 2) < 3 }
}, id)
const api = await title('g_api'), long = await title('g_long'), plain = await title('plain')
check('an open package shows its name, not its id, from the left, its fold button at the end of that row', api?.text === 'user.group.controller' && !api.cut && api.inside && api.atLeft && api.inRow && api.clear, JSON.stringify(api))
check('a name wider than its frame is cut with an ellipsis, inside the frame and clear of the fold button', long?.text === LONG && long.cut && long.ellipsis === 'ellipsis' && long.inside && long.clear, JSON.stringify(long))
check('a package with no name keeps its id', plain?.text === 'plain', JSON.stringify(plain))
await shot('open')

// Hover: the whole name by the pointer, only where it was cut. In the middle of the narrow title a line comes in from
// above: its hit area lies over the title, and the name must still show.
const hover = async (id, where) => {
  const at = await page.$eval(`.stage-inner > svg .cv-cluster[data-target="${id}"] .cluster-label foreignObject > div`, (d, where) => {
    const r = d.getBoundingClientRect(), y = r.top + r.height / 2
    if (where === 'left') return { x: r.left + 3, y }
    // Where a line's hit area lies over the title, if one does; else its middle.
    for (let x = r.left + 1; x < r.right; x += 2) if (document.elementFromPoint(x, y)?.classList.contains('cv-edge-hit')) return { x, y }
    return { x: r.left + r.width / 2, y }
  }, where)
  await page.mouse.move(at.x, at.y, { steps: 3 }); await sleep(700)
  return page.evaluate(([x, y]) => {
    const tip = document.querySelector('.stage-tip')
    return { tip: tip && !tip.hidden && Number(getComputedStyle(tip).opacity) > 0.9 ? tip.textContent : '', under: document.elementFromPoint(x, y)?.getAttribute('class') }
  }, [at.x, at.y])
}
const middle = await hover('g_long', 'line')
check('a line coming into the narrow package lies over its title', middle.under === 'cv-edge-hit', JSON.stringify(middle))
check('…and hovering there still shows the whole name', middle.tip === LONG, JSON.stringify(middle))
check('hovering the cut title\'s end shows it too', (await hover('g_long', 'left')).tip === LONG)
await shot('tip')
check('hovering a whole name shows nothing', (await hover('g_api', 'middle')).tip === '')
await page.mouse.move(5, 500); await sleep(200)
check('leaving the title takes the name away', await page.$eval('.stage-tip', t => t.hidden))

// Folded, the box shows the name as before.
await page.click('button[title="Collapse all packages"]'); await sleep(1200)
const folded = await page.$eval('.stage-inner > svg .cv-node[data-group="g_api"]', g => g.textContent)
check('a folded package shows its name', folded.includes('user.group.controller'), folded)

check('no page errors', !errors.length, errors.join(' | '))
await browser.close()
await call('DELETE', `/api/canvas/${NAME}?ws=${W}`)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
