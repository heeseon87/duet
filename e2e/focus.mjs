// Focus mode on a real turn: while it runs, one live line; after, the last words, the folded work and the changed files.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<demo repo> DUET_SHOTS=/dir node e2e/focus.mjs   (runs one short Haiku turn)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 1000 })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = async name => { if (!shots) return; const b = await page.$eval('.side', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }); await page.screenshot({ path: `${shots}/focus-${name}.png`, clip: b }) }
await page.evaluate(() => { localStorage.setItem('duet.focus', '0'); localStorage.setItem('duet.sideOpen', '1') })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.composer textarea', { timeout: 15000 })
await page.keyboard.press('Meta+Shift+o'); await sleep(900)
await page.click('.composer-bar .pick >> nth=0'); await sleep(200)
await page.click('.popover .menu-item:has-text("Haiku 5.5")'); await sleep(300)
await page.keyboard.press('Meta+.'); await sleep(200)
check('⌘. turns focus on', await page.$eval('.focus-toggle', b => b.classList.contains('on')))
await page.fill('.composer textarea', 'Do these steps with tools, one after another, and before each tool call write one short Korean sentence saying what you are about to do: 1) Read README.md. 2) Append the line "focus mode check" to docs/notes.md (use Edit or Write). 3) Run `git status --short` with Bash. Then reply in one short Korean sentence saying what changed.')
await page.keyboard.press('Enter')
let sawLive = 0, sawCount = false, cardsWhileRunning = 0
for (let i = 0; i < 240; i++) {
  const s = await page.evaluate(() => ({
    live: document.querySelectorAll('.focus-turn:last-child .ftl .live-tool').length,
    counted: [...document.querySelectorAll('.focus-turn:last-child .ftl .run-tally')].map(e => e.textContent),
    // Finished calls never show as cards in the timeline itself (only inside an opened count or live line).
    cards: document.querySelectorAll('.focus-turn:last-child .ftl > .ftl-item > .tool, .focus-turn:last-child .ftl > .ftl-item > .explore').length,
    running: Boolean(document.querySelector('.status-strip')),
  }))
  if (s.running) { sawLive = Math.max(sawLive, s.live); if (s.counted.length) sawCount = true; cardsWhileRunning = Math.max(cardsWhileRunning, s.cards) }
  if (s.live && !globalThis.__shot) { globalThis.__shot = 1; await shot('running') }
  // The live line must sit inside the timeline item: not wider, not shifted left.
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.live-tool-head')].some(h => { const r = h.getBoundingClientRect(), p = h.closest('.ftl-item').getBoundingClientRect(); return r.left < p.left - 1 || r.right > p.right + 1 || r.width < p.width - 2 }))
  if (overflow) globalThis.__overflow = true
  if (i > 10 && !s.running) break
  await sleep(250)
}
check('while running, the call in flight shows on its own line', sawLive > 0, `${sawLive} live lines seen`)
check('finished calls join the work line while the turn runs', sawCount)
check('no finished call shows as a card in the timeline', cardsWhileRunning === 0, `${cardsWhileRunning}`)
check('the live line fills its place in the timeline, no wider', !globalThis.__overflow)
await sleep(800)
const after = await page.evaluate(() => {
  const turn = [...document.querySelectorAll('.focus-turn')].pop()
  return {
    asked: Boolean(turn?.querySelector(':scope > .msg-user')),
    timeline: Boolean(turn?.querySelector(':scope > .ftl')),
    runs: [...(turn?.querySelectorAll('.ftl > .ftl-item.run .run-head') ?? [])].map(w => w.textContent?.replace(/\s+/g, ' ').trim()),
    says: turn?.querySelectorAll('.ftl > .ftl-item.say').length,
    live: turn?.querySelectorAll('.live-tool').length,
    foot: turn?.querySelector('.turn-foot')?.textContent?.replace(/\s+/g, ' ').trim(),
  }
})
check('after the turn: a timeline of words and counts, nothing live', after.asked && after.timeline && after.runs.length > 0 && after.live === 0, JSON.stringify(after))
check('the words along the way stay, with the answer', after.says >= 2, `${after.says} messages`)
check('each work line tells what was done in one sentence', after.runs.every(r => /^(Thought for|Read|Searched|Ran|Edited|Wrote|Fetched|Viewed|Updated|Used)/.test(r ?? '')) && after.runs.some(r => /read \d+ files?|ran \d+ shell commands?|(edited|wrote) \d+ files?/i.test(r ?? '')), after.runs.join(' / '))
check('the changed-files link stays', /파일 \d+개/.test(after.foot ?? ''), after.foot)
await shot('done')
await page.click('.focus-turn:last-child .ftl .run-head >> nth=-1'); await sleep(400)
check('a count opens to its calls in place', await page.$$eval('.focus-turn:last-child .run-body > *', els => els.length > 0))
await shot('run-open')
await page.keyboard.press('Meta+.'); await sleep(300)
check('⌘. turns focus off and shows everything', !(await page.$('.focus-turn')) && (await page.$$('.transcript .tool, .transcript .explore, .transcript .thinking')).length > 0)
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
