// Comparing with the previous revision marks a folded package that hides a change, and its badge says what changed.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=... DUET_MAP=<map whose last revision changed something inside DUET_GROUP> DUET_GROUP=<package> DUET_SHOTS=/dir node e2e/compare-folded.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_MAP: mapName, DUET_GROUP: group, DUET_SHOTS: shots } = process.env
const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 1000 })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
await page.evaluate(([w, m, g]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem(`duet.canvas.collapsed:${w}:${m}`, JSON.stringify([g])); localStorage.setItem('duet.sideOpen', '0') }, [ws, mapName, group])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector(`.stage-inner > svg .cv-node[data-target="${group}"]`, { timeout: 20000 }); await sleep(800)
await page.click('button:has-text("Compare with previous")'); await sleep(1500)
const folded = await page.evaluate(g => {
  const n = document.querySelector(`.stage-inner > svg .cv-node[data-target="${g}"]`)
  return { cls: [...n.classList].filter(c => c.startsWith('cv-')).join(' '), badge: n.querySelector('.cv-inside')?.getAttribute('data-text') ?? null }
}, group)
check('the folded package carries the change mark', /cv-changed|cv-new/.test(folded.cls), folded.cls)
check('its badge says what changed inside', Boolean(folded.badge), folded.badge ?? '(none)')
if (shots) {
  const b = await page.$eval(`.stage-inner > svg .cv-node[data-target="${group}"]`, n => { const r = n.getBoundingClientRect(); return { x: r.x - 40, y: r.y - 40, width: r.width + 80, height: r.height + 80 } })
  await page.screenshot({ path: `${shots}/compare-folded.png`, clip: b })
}
// Unfolded, the changed box inside carries the mark itself; the badge goes with the folded box.
const box = await page.$eval(`.stage-inner > svg .cv-node[data-target="${group}"]`, n => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 } })
await page.mouse.dblclick(box.x, box.y); await sleep(1500)
const open_ = await page.evaluate(() => ({ marked: document.querySelectorAll('.stage-inner > svg .cv-node.cv-changed, .stage-inner > svg .cv-node.cv-new').length, badges: document.querySelectorAll('.stage-inner > svg .cv-inside').length }))
check('unfolded: the box inside is marked, no badge left', open_.marked > 0 && open_.badges === 0, JSON.stringify(open_))
await page.click('.unseen-banner button').catch(() => {})
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
