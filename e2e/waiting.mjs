// What waits on the person reaches them: while a command runs the strip shows what the agent last said
// (one line, a click away from the words), a question rings and the strip names it ("질문 1개 · 답하기") and
// brings it into view (also in focus mode), an answered question keeps its pick across a reload, and the
// context meter shows the real context, amber past 80%.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<scratch repo> node e2e/waiting.mjs   (runs one Haiku conversation)
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
const info = async id => (await call('GET', `/api/sessions?ws=${encodeURIComponent(ws)}`)).find(x => x.id === id)
const settle = async (id, turns) => {
  const t0 = Date.now()
  for (;;) {
    await sleep(1500)
    const i = await info(id)
    if (i.status === 'idle' && i.turns >= turns) return i
    if (Date.now() - t0 > 180_000) { console.log('FAIL turn timeout', i.status); process.exit(1) }
  }
}

const stamp = Date.now().toString(36)
await call('POST', '/api/workspaces', { path: ws })
const s = await call('POST', '/api/sessions', { ws, model: process.env.DUET_MODEL ?? 'claude-haiku-5-5', permissionMode: 'bypassPermissions' })
const { browser, page, errors } = await open({ port, token: T, ws, width: 1400, height: 640 })
await page.evaluate(([w, id]) => { localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem('duet.focus', '0'); localStorage.setItem('duet.sideWidth', '560') }, [ws, s.id])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.composer textarea', { timeout: 15000 })
await call('POST', `/api/sessions/${s.id}/messages`, { text: [
  'Do these steps in order:',
  `1. Write exactly this one sentence as text, and nothing else: "Sleeping a little before I ask, mark ${stamp}."`,
  '2. Run `sleep 15` with Bash.',
  '3. Use the AskUserQuestion tool to ask "Which color?" with exactly two options, "Red" and "Blue".',
  '4. After the answer, reply with one word: done.',
].join('\n') })

// While the command runs, the strip shows the narration; the activity moves to its tooltip.
let during
for (let i = 0; i < 240 && !during; i++) {
  await sleep(250)
  const v = await page.evaluate(() => ({
    sleeping: [...document.querySelectorAll('.tool.running code.cmd')].some(c => c.textContent.includes('sleep')),
    said: document.querySelector('.status-strip .said')?.textContent,
    title: document.querySelector('.status-strip')?.getAttribute('title'),
  }))
  if (v.sleeping && v.said) during = v
}
check('while a command runs, the strip shows what the agent last said', during?.said?.includes(stamp), JSON.stringify(during))
check('the activity is kept in the tooltip', during?.title === '명령 실행 중', during?.title)
if (shots) await page.locator('.side').screenshot({ path: `${shots}/waiting-narration.png` })

// The question rings, the strip names it, and a click brings it into view.
await page.waitForSelector('.tool.ask[data-waiting]', { timeout: 90_000 })
await sleep(500)
const card = await page.evaluate(() => ({ cls: document.querySelector('.tool.ask[data-waiting]')?.className, strip: document.querySelector('.status-strip .link')?.textContent }))
check('a waiting question carries the ring', /\basking\b/.test(card.cls ?? ''), card.cls)
check('the strip names what waits', card.strip === '질문 1개 · 답하기', card.strip)
const inView = () => page.evaluate(() => {
  const c = document.querySelector('[data-waiting]')?.getBoundingClientRect(), v = document.querySelector('.transcript')?.getBoundingClientRect()
  return Boolean(c && v && c.top >= v.top - 1 && c.bottom <= v.bottom + 1)
})
const jump = async mode => {
  await page.evaluate(() => { document.querySelector('.transcript').scrollTop = 0 }); await sleep(300)
  const before = await inView()
  await page.click('.status-strip .link'); await sleep(900)
  check(`${mode}: the strip's click brings the question into view`, !before && (await inView()), `in view before the click: ${before}`)
}
await jump('normal view')
if (shots) await page.locator('.side').screenshot({ path: `${shots}/waiting-question.png` })
await page.keyboard.press('Meta+.'); await sleep(500)
check('focus mode is on', await page.$eval('.focus-toggle', b => b.classList.contains('on')))
await jump('focus mode')
await page.keyboard.press('Meta+.'); await sleep(400)

// Answered: the card shows the pick, not the raw result, also after a reload.
await page.click('.tool.ask .ask-opt:has-text("Blue")')
await page.click('.tool.ask .perm-actions .btn.primary')
await settle(s.id, 1)
await sleep(800)
const answered = () => page.evaluate(() => {
  const c = document.querySelector('.tool.ask')
  return { ring: c?.classList.contains('asking'), said: c?.querySelector('.ask-said')?.textContent, picked: [...(c?.querySelectorAll('.ask-opt.on') ?? [])].map(o => o.querySelector('b')?.textContent), folded: c?.querySelector('.ask-more summary')?.textContent, raw: document.querySelector('.side')?.textContent.includes('Your questions have been answered') }
})
const ok = a => !a.ring && a.said === '이걸로 답함' && a.picked.join() === 'Blue' && a.folded === '고르지 않은 선택지 1개' && !a.raw
const a1 = await answered()
check('the answered card shows the pick, the rest folded, no raw result', ok(a1), JSON.stringify(a1))
if (shots) await page.locator('.side').screenshot({ path: `${shots}/waiting-answered.png` })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.turn-foot', { timeout: 15000 }); await sleep(800)
const a2 = await answered()
check('a reload keeps the pick', ok(a2), JSON.stringify(a2))

// Under a long transcript: a long narration fits one line, and its click brings the words into view.
const mark = `${stamp}x`
await call('POST', `/api/sessions/${s.id}/messages`, { text: `Write exactly this one sentence as text, and nothing else: "지금은 꽤 오래 걸리는 명령을 돌리는 중이니까 끝날 때까지 조금만 기다려 주면 결과를 정리해서 바로 알려 줄게 ${mark}." Then run \`python3 -c "import time; time.sleep(25)"\` with Bash in the foreground. Then reply with one word: done.` })
await page.waitForFunction(m => document.querySelector('.status-strip .said')?.textContent.includes(m), mark, { timeout: 90_000 }).catch(() => {})
const words = () => page.evaluate(m => {
  const w = [...document.querySelectorAll('.msg-agent[data-key]')].find(e => e.textContent.includes(m))?.getBoundingClientRect(), v = document.querySelector('.transcript')?.getBoundingClientRect()
  return Boolean(w && v && w.top >= v.top - 1 && w.bottom <= v.bottom + 1)
}, mark)
const cut = await page.$eval('.status-strip .said', e => e.scrollWidth > e.clientWidth && e.textContent.includes('지금은')).catch(() => false)
check('a long narration is cut to one line', cut)
await page.evaluate(() => { document.querySelector('.transcript').scrollTop = 0 }); await sleep(300)
const hidden = !(await words())
await page.click('.status-strip .said').catch(() => {}); await sleep(900)
check("the narration's click brings its words into view", hidden && (await words()), `out of view before the click: ${hidden}`)

// The meter: a percent of the window, from the last top-level call in the log.
const fromLog = log => {
  const calls = log.filter(e => e.kind === 'sdk' && e.msg.type === 'assistant' && !e.msg.parent_tool_use_id && e.msg.message?.model !== '<synthetic>')
    .map(e => { const u = e.msg.message.usage ?? {}; return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) }).filter(Boolean)
  return calls[calls.length - 1]
}
const meter = () => page.$eval('.composer .meter', m => m.textContent).catch(() => '')
const done = await settle(s.id, 2)
await sleep(800)
const expected = fromLog((await call('GET', `/api/sessions/${s.id}`)).log)
const pct = Math.min(100, Math.round((expected / done.contextWindow) * 100))
const shown = await meter()
check('the meter shows a percent of the window, from the last top-level call', done.contextTokens === expected && done.contextWindow > 0 && pct <= 100 && shown === `${pct}%`, `log ${expected} · info ${done.contextTokens}/${done.contextWindow} · shown ${shown}`)

// A local command answered with no model call leaves the meter alone.
await page.fill('.composer textarea', '/plugin list')
await page.keyboard.press('Enter')
const after = await settle(s.id, 3)
await sleep(800)
const shownAfter = await meter()
check('/plugin list neither hides nor zeroes the meter', after.contextTokens === expected && shownAfter === shown, `info ${after.contextTokens} · shown ${shownAfter}`)

// Past 80% of the window the meter turns amber and points at /compact (the session list is edited on its way in).
await page.route(url => url.pathname === '/api/sessions' && url.searchParams.has('ws'), async route => {
  const res = await route.fetch()
  const list = (await res.json()).map(x => (x.id === s.id ? { ...x, contextTokens: Math.round(x.contextWindow * 0.85) } : x))
  await route.fulfill({ response: res, json: list })
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.composer .meter', { timeout: 15000 }).catch(() => {})
const amber = await page.$eval('.composer .meter', m => ({ full: m.classList.contains('full'), color: getComputedStyle(m).color, title: m.title, text: m.textContent })).catch(() => ({}))
check('past 80% the meter turns amber and suggests /compact', amber.full && amber.text === '85%' && amber.title?.includes('/compact'), JSON.stringify(amber))
if (shots) await page.locator('.composer-bar').screenshot({ path: `${shots}/waiting-meter-full.png` })
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
console.log('session', s.id)
process.exit(failed ? 1 : 0)
