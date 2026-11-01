// Checks for the round-6 feedback: repo picker, sideways scroll in the review.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=/path/to/demo-repo DUET_SHOTS=/dir node e2e/round6.mjs
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const T = process.env.DUET_TOKEN, ws = process.env.DUET_WS, shots = process.env.DUET_SHOTS
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const theme = process.env.DUET_THEME ?? 'light'
const { browser, page, errors } = await open({ port, token: T, ws, theme })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${theme}-${name}.png` }) }

await page.evaluate(w => { localStorage.setItem('duet.tab', 'review'); localStorage.setItem(`duet.review.source:${w}`, JSON.stringify({ kind: 'working' })); localStorage.removeItem('duet.review.wrap') }, ws)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tree-row.file', { timeout: 20000 })

// 1. Repo picker: a big list, in the flow, searchable by name, walkable by path.
await page.click('.ws-pick'); await sleep(700)
const pop = await page.$eval('.ws-popover', el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, scroll: el.scrollHeight > el.clientHeight + 2 } })
check('picker is wide and does not scroll as a whole', pop.w >= 560 && !pop.scroll, JSON.stringify(pop))
await page.waitForFunction(() => document.querySelectorAll('.rp-row').length > 3, null, { timeout: 8000 })
check('picker lists repos found under home', (await page.$$('.rp-row')).length > 3, `${(await page.$$('.rp-row')).length} rows`)
await shot('picker-empty')
await page.keyboard.type('duet'); await sleep(400)
check('typing a name finds the repo', await page.$$eval('.rp-row .rp-name', els => els.some(e => e.textContent === 'duet')))
await page.fill('.rp-search input', '~/'); await sleep(700)
const home = await page.$$eval('.rp-row', rs => rs.length)
const listBox = await page.$eval('.rp-list', el => ({ h: el.clientHeight, sh: el.scrollHeight }))
check('~/ lists home folders in a tall list', home > 20 && listBox.h > 380, `${home} rows, list ${listBox.h}px`)
await shot('picker-path')
await page.fill('.rp-search input', '~/git'); await sleep(600)
await page.keyboard.press('Tab'); await sleep(700)
check('Tab walks into the folder', (await page.$eval('.rp-search input', e => e.value)) === '~/github/' && (await page.$$('.rp-row')).length > 3)
await page.keyboard.press('Escape'); await sleep(300)
check('Escape closes the picker', !(await page.$('.ws-popover')))

// 2. Review: a long line scrolls the file as one piece; numbers and the comment box stay in view.
await page.click('.tree-row.file:has-text("SourceResolver.kt")'); await sleep(1500)
const sx = await page.evaluate(() => {
  const body = document.querySelector('.file-diff .file-body')
  const cells = [...document.querySelectorAll('.file-diff table.diff td.code')]
  return {
    bodyScrolls: body.scrollWidth > body.clientWidth + 20,
    cellScrolls: cells.filter(td => td.scrollWidth > td.clientWidth + 1).length,
    overflowX: getComputedStyle(cells[0]).overflowX,
  }
})
check('the file scrolls sideways, no single line does', sx.bodyScrolls && sx.cellScrolls === 0, JSON.stringify(sx))
await page.$eval('.file-diff .file-body', el => { el.scrollLeft = 400 })
await sleep(200)
const pinned = await page.evaluate(() => {
  const body = document.querySelector('.file-diff .file-body').getBoundingClientRect()
  const no = document.querySelector('.file-diff tr.line td.no').getBoundingClientRect()
  return { noLeft: Math.round(no.left - body.left) }
})
check('line numbers stay pinned while scrolled', pinned.noLeft >= 0 && pinned.noLeft < 4, JSON.stringify(pinned))
await shot('review-scrolled')
await page.hover('.file-diff tr.line.add td.no >> nth=0'); await sleep(150)
await page.click('.file-diff tr.line.add .add-comment >> nth=0'); await sleep(400)
const editor = await page.evaluate(() => {
  const body = document.querySelector('.file-diff .file-body').getBoundingClientRect()
  const ed = document.querySelector('.comment-pin').getBoundingClientRect()
  return { left: Math.round(ed.left - body.left), right: Math.round(body.right - ed.right) }
})
check('the comment box stays inside the visible width', editor.left >= -1 && editor.right >= -1, JSON.stringify(editor))
await shot('review-comment')
await page.keyboard.press('Escape'); await sleep(200)
await page.keyboard.press('s'); await sleep(700)
const split = await page.evaluate(() => {
  const t = document.querySelector('.file-diff table.diff.split')
  const body = document.querySelector('.file-diff .file-body')
  const cols = [...t.querySelectorAll('col.c-half')].map(c => Math.round(c.getBoundingClientRect().width))
  return { scrolls: body.scrollWidth > body.clientWidth + 20, cols, cellScrolls: [...t.querySelectorAll('td.code')].filter(td => td.scrollWidth > td.clientWidth + 1).length }
})
check('split view: halves stay equal and the file scrolls as one', split.scrolls && Math.abs(split.cols[0] - split.cols[1]) <= 1 && split.cellScrolls === 0, JSON.stringify(split))
await page.keyboard.press('u'); await sleep(300)
const toggleWrap = async () => { await page.click('button[title="보기 설정"]'); await sleep(200); await page.click('.popover .menu-item:has-text("Wrap long lines")'); await sleep(500); await page.keyboard.press('Escape'); await sleep(200) }
await toggleWrap()
const wrapped = await page.$eval('.file-diff .file-body', el => el.scrollWidth <= el.clientWidth + 1)
check('wrap mode has no sideways scroll', wrapped)
await toggleWrap()

if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
