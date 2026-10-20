// Double-clicking the empty canvas fits the whole map, however large: zoom in, double-click the background,
// and the drawing lies inside the stage, filling it in one direction. A big map once stayed at the old 20% floor
// and ran off the side.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> DUET_MAP=<a large class map> node e2e/fit.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_MAP: map, DUET_SHOTS: shots } = process.env
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }

const { browser, page, errors } = await open({ port, token: T, ws, width: 1440, height: 900 })
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem('duet.sideWidth', '460') }, [ws, map])
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.stage-canvas svg', { timeout: 15000 }); await sleep(1500)
const view = () => page.evaluate(() => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  const svg = document.querySelector('.stage-inner > svg').getBoundingClientRect()
  return {
    zoom: document.querySelector('.zoom-readout')?.textContent,
    inside: svg.left >= stage.left - 1 && svg.top >= stage.top - 1 && svg.right <= stage.right + 1 && svg.bottom <= stage.bottom + 1,
    fill: Math.max(svg.width / stage.width, svg.height / stage.height),
  }
})
const mid = await page.$eval('.stage-canvas', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
for (let i = 0; i < 6; i++) { await page.mouse.move(mid.x, mid.y); await page.mouse.wheel(0, -200); await sleep(80) }
await sleep(400)
check('zoomed in, the map runs past the stage', !(await view()).inside, JSON.stringify(await view()))
const empty = await page.evaluate(() => {
  const r = document.querySelector('.stage-canvas').getBoundingClientRect()
  for (let y = r.top + 60; y < r.bottom - 40; y += 23) for (let x = r.left + 30; x < r.right - 30; x += 29) {
    const el = document.elementFromPoint(x, y)
    if (el && !el.closest('[data-target],[data-group],.inspector,button')) return { x, y }
  }
})
await page.mouse.dblclick(empty.x, empty.y); await sleep(900)
const fitted = await view()
check('double-clicking the background fits the whole map inside the stage', fitted.inside && fitted.fill > 0.85, JSON.stringify(fitted))
await page.mouse.wheel(0, 400); await sleep(400)
check('the wheel can still zoom out from there, not jump back in', Number((await view()).zoom.replace('%', '')) <= Number(fitted.zoom.replace('%', '')), `${fitted.zoom} → ${(await view()).zoom}`)
if (shots) await page.screenshot({ path: `${shots}/fit.png` })
if (errors.length) { failed++; console.log('page errors', errors.slice(0, 3)) }
await browser.close()
process.exit(failed ? 1 : 0)
