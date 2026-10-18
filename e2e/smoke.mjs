// Browser smoke test against a running Duet and the demo repo from e2e/make-demo.sh.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=/path/to/demo-repo node e2e/smoke.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const T = process.env.DUET_TOKEN, ws = process.env.DUET_WS
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const { browser, page, errors } = await open({ port, token: T, ws })
let failed = 0
const check = (name, ok) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name) }
await page.evaluate(w => { localStorage.setItem('duet.tab', 'review'); localStorage.setItem(`duet.review.source:${w}`, JSON.stringify({ kind: 'branch', base: 'main', compare: 'WORKTREE' })) }, ws)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tree-row.file', { timeout: 20000 })
check('branch compare lists files', (await page.$$('.tree-row.file')).length >= 4)
await page.click('.tree-row.file:has-text("ThumbnailWorker.kt")'); await sleep(1200)
check('word marks keep syntax colors', (await page.$$('mark.w-add span[style]')).length > 0)
check('indent-only changes are not marked', !(await page.$$eval('mark.w-add', ms => ms.some(m => m.textContent.trim() === ''))))
await page.click('.review-main'); await page.keyboard.press('/'); await sleep(300)
await page.keyboard.type('workDir'); await sleep(500)
check('find in file counts matches', /^1\/\d+$/.test(await page.$eval('.find-count', e => e.textContent ?? '')))
await page.keyboard.press('Escape'); await sleep(200)
await page.keyboard.press('s'); await sleep(500)
check('split view has blank cells, no grid cells', await page.$$eval('td.blank', tds => tds.length > 0 && tds.every(td => getComputedStyle(td).display === 'table-cell')))
await page.keyboard.press('u'); await sleep(300)
await page.click('.tabs button:has-text("캔버스")'); await sleep(2500)
check('canvas renders boxes', (await page.$$('.cv-node')).length > 0 || (await page.$$('.cv-msg')).length > 0)
check('edge labels painted', await page.$$eval('.cv-label p', ps => ps.length === 0 || ps.every(p => p.getBoundingClientRect().width > 0)))
await page.click('button[title="지도 지우기"]'); await sleep(300)
check('in-app confirm opens', Boolean(await page.$('.confirm')))
await page.keyboard.press('Escape'); await sleep(200)
check('confirm cancels with escape', !(await page.$('.confirm')))
await page.keyboard.press('Meta+k'); await sleep(300)
await page.keyboard.type('deleteRecursively'); await sleep(1200)
check('palette searches code while typing', await page.$$eval('.palette .menu-item', els => els.some(e => /\.kt:\d+/.test(e.textContent ?? ''))))
await page.fill('.palette input', ''); await page.keyboard.type('Generator'); await sleep(600)
check('palette finds files', (await page.$$('.palette .menu-item')).length > 1)
await page.keyboard.press('Enter'); await sleep(1200)
check('palette opens file in review', await page.$eval('.file-head .name', e => e.textContent).then(t => t.includes('Generator')).catch(() => false))
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
