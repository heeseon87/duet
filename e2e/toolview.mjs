// How a turn's tool calls read, Claude Code style: look-arounds and shell commands fold into one
// sentence ("…, ran 2 shell commands"), an edit shows "Added n lines, removed m lines" over a word-marked diff, and a
// new file shows its first lines.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<scratch repo; its README.md is rewritten> node e2e/toolview.mjs   (runs one Haiku turn)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }

const stamp = Date.now().toString(36)
// One word of a long line changes, so the diff can mark the word.
writeFileSync(join(ws, 'README.md'), '# A small workspace for trying the review\n')
await call('POST', '/api/workspaces', { path: ws })
const s = await call('POST', '/api/sessions', { ws, model: process.env.DUET_MODEL ?? 'claude-haiku-5-5', permissionMode: 'bypassPermissions' })
const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\\n')
await call('POST', `/api/sessions/${s.id}/messages`, { text: [
  'Do these steps in order, with no text between them:',
  '1. Run `ls` with Bash. 2. Run `git status --short` with Bash. 3. Read README.md with Read.',
  '4. With Edit, in README.md replace the word "review" with "canvas".',
  `5. With Write, create notes/twenty-${stamp}.md whose content is exactly these 20 lines: ${lines}`,
  'Then reply with one word: done.',
].join('\n') })
const t0 = Date.now()
for (;;) {
  await sleep(1500)
  const i = (await call('GET', `/api/sessions?ws=${encodeURIComponent(ws)}`)).find(x => x.id === s.id)
  if (i.status === 'idle' && i.turns > 0) break
  if (Date.now() - t0 > 180_000) { console.log('FAIL turn timeout', i.status); process.exit(1) }
}

const { browser, page, errors } = await open({ port, token: T, ws, width: 1600, height: 1100 })
await page.evaluate(([w, id]) => { localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem('duet.focus', '0'); localStorage.setItem('duet.sideWidth', '640') }, [ws, s.id])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.turn-foot', { timeout: 15000 }); await sleep(800)

const view = () => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.side .tool')].map(t => ({ title: t.querySelector('.tool-title')?.textContent, summary: t.querySelector('.edit-summary')?.textContent, marks: t.querySelectorAll('.mini-diff mark.w-add').length, preview: t.querySelectorAll('.write-preview .cl').length, more: t.querySelector('.write-preview .more')?.textContent }))
  return { folds: [...document.querySelectorAll('.side .explore-line')].map(e => e.textContent), loose: [...document.querySelectorAll('.side .tool')].filter(t => t.querySelector('.tool-sub code.cmd') || t.querySelector('.tool-title')?.textContent === 'Read').map(t => t.textContent.slice(0, 60)), cards }
})
const v = await view()
check('look-arounds and shell commands fold into one sentence', v.folds.some(f => /ran 2 shell commands/.test(f)) && v.loose.length === 0, JSON.stringify(v.folds) + ' loose ' + JSON.stringify(v.loose))
const ed = v.cards.find(c => c.title === 'Update')
check('an edit says what it changed, over a word-marked diff', ed?.summary === 'Added 1 line, removed 1 line' && ed.marks > 0, JSON.stringify(ed))
const wr = v.cards.find(c => c.title === 'Write')
check('a new file shows its first lines, the rest one click away', wr?.summary === 'Wrote 20 lines' && wr.preview === 10 && wr.more === '10줄 더 보기', JSON.stringify(wr))
if (shots) await page.locator('.side').screenshot({ path: `${shots}/toolview.png` })
// Opened, the fold lists each call.
await page.click('.side .explore-head'); await sleep(300)
const inside = await page.$$eval('.side .explore-body .tool', ts => ts.length)
check('the folded line opens to each call', inside >= 2, String(inside))
// Focus mode words its work line the same way.
await page.keyboard.press('Meta+.'); await sleep(600)
const run = await page.$$eval('.side .run-tally', rs => rs.map(r => r.textContent))
check('focus mode tells its work in the same sentence', run.some(r => /ran 2 shell commands/.test(r)), JSON.stringify(run))
await page.keyboard.press('Meta+.'); await sleep(300)
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
