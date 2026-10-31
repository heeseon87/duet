// Decision mode: the chip opens the open decisions one after another over the canvas, Claude's pick comes chosen, keys
// pick (1·2·3, also with the Korean input source), put off (l) and ask (q), ⏎ decides and moves on, a choice can be
// taken back, the summary comes after the last, the side shows the map and the real code an option touches, and esc
// closes the mode alone. Nothing goes to a conversation unless DUET_SEND=1: then one Haiku conversation (plan mode, told
// to use no tools) gets the choices, in one prompt at the end and once more after a reload; give it a scratch repo.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<a repo with README.md and package.json> DUET_SHOTS=/dir node e2e/decision-mode.mjs
//   (makes and removes a map named decision-mode)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const sendToo = process.env.DUET_SEND === '1'
const name = 'decision-mode'
const W = encodeURIComponent(ws)
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
const mapNow = async () => (await call('GET', `/api/canvas/${name}?ws=${W}`))

await call('POST', '/api/workspaces', { path: ws })
await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '결정 모드 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'api', kind: 'group' }, { id: 'Ctl', parent: 'api', files: ['package.json'], decision: 'D1' },
    { id: 'Route', parent: 'api', decision: 'D1', option: 'D1-a', files: ['README.md:1-6'] },
    { id: 'Nested', parent: 'api', decision: 'D1', option: 'D1-b' },
    { id: 'core', kind: 'group' }, { id: 'Svc', parent: 'core' },
    { id: 'Res', parent: 'core', decision: 'D2', option: 'D2-a' },
  ],
  relations: [{ from: 'Ctl', to: 'Svc', label: 'create' }, { from: 'Svc', to: 'Res' }],
  decisions: [
    { id: 'D1', question: 'URL을 어떤 모양으로 할까?', why: { tags: ['convention', 'scope'], text: '관례가 둘이고 다른 지도도 따라와.' }, recommended: 'D1-a',
      options: [{ id: 'D1-a', text: 'POST /groups', impact: '목록과 같은 컬렉션' }, { id: 'D1-b', text: 'POST /users/{id}/groups' }, { id: 'D1-c', text: '지금 그대로' }] },
    { id: 'D2', question: '성공하면 무엇을 돌려줄까?', why: { tags: ['context'], text: '화면이 무엇을 쓰는지는 네가 알아.' },
      options: [{ id: 'D2-a', text: '201 + 본문' }, { id: 'D2-b', text: '200 빈 본문' }] },
  ],
} })

// The conversation the agent panel shows: where the choices go.
const session = sendToo ? await call('POST', '/api/sessions', { ws, model: process.env.DUET_MODEL ?? 'claude-haiku-5-5', permissionMode: 'plan' }) : undefined
if (session) await call('POST', `/api/sessions/${session.id}/messages`, { text: 'From now on answer every message in this conversation with one short sentence and use no tools at all.' })

const theme = process.env.DUET_THEME ?? 'light'
const { browser, page, errors } = await open({ port, token: T, ws, width: 1600, height: 1000, theme })
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }
const shot = async label => { if (shots) await page.screenshot({ path: `${shots}/${theme}-decide-${label}.png` }) }
const pendingKey = `duet.canvas.pendingDecisions:${ws}:${name}`
await page.evaluate(([w, m, send, sid]) => {
  if (sid) localStorage.setItem(`duet.session:${w}`, sid)
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem('duet.canvas.decideTab', 'map')
  localStorage.setItem('duet.canvas.decideSend', send ? '1' : '0'); localStorage.removeItem(`duet.canvas.pendingDecisions:${w}:${m}`)
}, [ws, name, sendToo, session?.id])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 20000 }); await sleep(1200)
const state = () => page.evaluate(() => {
  const d = document.querySelector('.decide')
  if (!d) return null
  return {
    step: d.querySelector('.dm-main .dm-step')?.textContent ?? '',
    q: d.querySelector('.dm-main .dm-q')?.textContent ?? '',
    picked: d.querySelector('.dm-option[aria-checked="true"]')?.getAttribute('data-option') ?? null,
    rec: [...d.querySelectorAll('.dm-option')].filter(o => o.querySelector('.dm-rec')).map(o => o.getAttribute('data-option')),
    two: Boolean(d.querySelector('.dm-options.two')),
    go: d.querySelector('.dm-go')?.textContent ?? '',
    summary: Boolean(d.querySelector('.dm-summary')),
    undo: d.querySelector('.dm-undo')?.textContent ?? '',
    list: [...d.querySelectorAll('.dm-item')].map(i => `${i.getAttribute('data-decision')}${i.classList.contains('made') ? '✓' : ''}${i.classList.contains('on') ? '*' : ''}`).join(' '),
  }
})

// 1. The chip opens the mode on the first open decision, Claude's pick already chosen.
await page.click('.canvas-bar .dec-chip'); await sleep(1500)
let s = await state()
check('the chip opens decision mode on D1, 1 of 2', s?.step.includes('결정 1 / 2') && s.q.includes('URL') && s.list === 'D1* D2', JSON.stringify(s))
check('Claude\'s pick comes chosen, tagged, and the button says so', s?.picked === 'D1-a' && s.rec.join() === 'D1-a' && s.go.includes('추천대로 a로 결정'), JSON.stringify(s))
check('why Claude asks shows under the question', await page.$eval('.decide .dm-main', m => m.textContent.includes('왜 Claude가 혼자 정하지 않았나') && m.textContent.includes('관례가 둘')))
const lit = await page.$$eval('.dm-side .stage-inner > svg .cv-node.cv-sel, .dm-side .stage-inner > svg .cv-node.cv-in', ns => ns.map(n => n.getAttribute('data-target')).sort().join())
check('the side map lights what the picked option brings', lit.includes('Route') && lit.includes('Ctl') && !lit.includes('Nested'), lit)
const mainView = await page.evaluate(() => document.querySelector('.canvas-main .stage-inner')?.style.transform)
await shot('open')

// 2. Keys: a number picks, also as a jamo; the canvas keys and the approval card's stay out.
const sideAt = id => page.evaluate(t => {
  const s = document.querySelector('.dm-side .dm-map').getBoundingClientRect()
  const n = document.querySelector(`.dm-side .stage-inner > svg .cv-node[data-target="${t}"]`)?.getBoundingClientRect()
  return n ? { dx: Math.abs(n.left + n.width / 2 - (s.left + s.width / 2)) / s.width, dy: Math.abs(n.top + n.height / 2 - (s.top + s.height / 2)) / s.height } : null
}, id)
check('the side map opens on the picked option\'s own box', ((p) => p && p.dx < 0.15 && p.dy < 0.15)(await sideAt('Route')), JSON.stringify(await sideAt('Route')))
await page.keyboard.press('2'); await sleep(700)
check('2 picks the second option', (await state())?.picked === 'D1-b')
check('and the side map moves to that option\'s box', ((p) => p && p.dx < 0.15 && p.dy < 0.15)(await sideAt('Nested')), JSON.stringify(await sideAt('Nested')))
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true })))
await sleep(200)
check('3 picks the third', (await state())?.picked === 'D1-c')
await page.keyboard.press('1'); await sleep(200)
await page.keyboard.press('f'); await page.keyboard.press('e'); await sleep(300)
check('canvas keys do nothing under the mode', (await page.evaluate(() => document.querySelector('.canvas-main .stage-inner')?.style.transform)) === mainView && Boolean(await state()))
// q (as ㅂ with the Korean input source) opens the question box; esc closes it before the mode.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅂ', code: 'KeyQ', bubbles: true })))
await sleep(300)
check('q (ㅂ) opens a question about the picked option', await page.$eval('.decide .dm-ask', a => a.textContent.includes('a안에 대해')).catch(() => false))
await page.keyboard.press('Escape'); await sleep(150)
await page.keyboard.press('Escape'); await sleep(300)
check('esc puts the question box away, the mode stays', !(await page.$('.decide .dm-ask')) && Boolean(await state()))

// 3. The code tab: the real lines of the files the option's boxes name.
await page.click('.dm-tabs button:has-text("코드")'); await sleep(1500)
const code = await page.$$eval('.dm-snippet', ss => ss.map(x => ({ head: x.querySelector('.dm-snippet-head')?.textContent ?? '', rows: x.querySelectorAll('tr').length, target: x.querySelectorAll('tr.target').length })))
check('the code tab shows a snippet per file, the referenced lines marked', code.length === 2 && code.some(c => c.head.includes('README.md') && c.target === 6) && code.every(c => c.rows > 0), JSON.stringify(code))
await page.click('.dm-opt-switch button:has-text("b")'); await sleep(600)
check('switching to b shows b\'s share (no file: says so)', (await state())?.picked === 'D1-b' && (await page.$$('.dm-snippet')).length === 1)
await shot('code')
await page.click('.dm-tabs button:has-text("지도")'); await sleep(300)

// 4. l puts D1 off; ⏎ decides D2 and comes back to D1; the choice can be taken back.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅣ', code: 'KeyL', bubbles: true })))
await sleep(400)
s = await state()
check('l (ㅣ) puts D1 off and shows D2, two options side by side', s?.q.includes('성공') && s.two && s.picked === null && s.go.includes('하나 골라 줘') && s.list.includes('D2*'), JSON.stringify(s))
await page.keyboard.press('Enter'); await sleep(300)
check('⏎ with nothing picked decides nothing', (await mapNow()).map.decisions[1].chosen === undefined)
await page.keyboard.press('2')
await page.fill('.decide .dm-why', '화면은 목록을 다시 읽어')
await page.press('.decide .dm-why', 'Enter'); await sleep(1200)
let m = await mapNow()
s = await state()
check('⏎ in the reason box decides: on the map at once, with the reason', m.map.decisions[1].chosen === 'D2-b' && m.map.decisions[1].rationale === '화면은 목록을 다시 읽어', JSON.stringify(m.map.decisions[1]))
check('then the one put off comes back, and the undo bar says what was decided', s?.q.includes('URL') && s.undo.includes('D2를 b로 정했어') && s.list.includes('D2✓'), JSON.stringify(s))
const pendingIds = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? '{}').ids ?? [], pendingKey)
const pending1 = (await pendingIds()).join()
check(sendToo ? 'a choice to send waits in the tab until the end' : 'with sending off nothing waits for Claude', sendToo ? pending1 === 'D2' : pending1 === '', pending1)
const revBefore = m.revision
await page.click('.dm-undo .link-btn'); await sleep(1200)
m = await mapNow()
s = await state()
check('되돌리기 takes the choice back: the option\'s parts return, D2 is open again with b picked', m.map.decisions[1].chosen === undefined && m.revision === revBefore + 1 && m.map.elements.some(e => e.id === 'Res') && s?.q.includes('성공') && s.picked === 'D2-b', JSON.stringify({ rev: m.revision, s }))
check('and nothing waits for Claude about it', (await pendingIds()).length === 0)

// 5. Esc closes the mode alone; the chip opens it again where things stand.
await page.keyboard.press('Escape'); await sleep(400)
check('esc closes the mode, back to the map', !(await state()) && Boolean(await page.$('.canvas-bar .dec-chip')))
await page.click('.canvas-bar .dec-chip'); await sleep(1200)
await page.keyboard.press('Enter'); await sleep(1200)
s = await state()
check('⏎ takes Claude\'s pick for D1 and moves to D2', (await mapNow()).map.decisions[0].chosen === 'D1-a' && s?.q.includes('성공'), JSON.stringify(s))
await page.keyboard.press('1'); await page.keyboard.press('Enter'); await sleep(1500)
s = await state()
check('after the last, the summary: every decision with its pick', s?.summary && (await page.$eval('.dm-summary', x => x.textContent.includes('결정 2개를 다 정했어') && x.querySelectorAll('.dm-done').length === 2)), JSON.stringify(s))
check('the summary says where Claude is with them', await page.$eval('.dm-claude', (x, send) => x.textContent.includes(send ? 'Claude에게 보낼 결정 2개' : 'Claude에게 보내지 않았어'), sendToo))
await page.click('.dm-tabs button:has-text("코드")'); await sleep(500)
check('the code tab lists the files the choices reach', await page.$$eval('.dm-file', fs => fs.some(f => f.textContent.includes('README.md') && f.textContent.includes('D1'))))
await shot('summary')

// 6. A choice reopened before the batch goes out is left out of it, and so is one never chosen.
const skipped = await call('POST', `/api/canvas/${name}/decided`, { ws, decisions: ['D9'] })
check('the batch route skips what is not decided, starting no conversation', Array.isArray(skipped.sent) && skipped.sent.length === 0 && !skipped.sessionId, JSON.stringify(skipped))

if (sendToo) {
  // The undo bar goes, then both choices go to Claude in one prompt; each decision's thread shows it.
  await sleep(9000)
  const th = (await call('GET', `/api/canvas/${name}/threads?ws=${W}`)).threads
  // What was sent: the agent may answer on the threads too.
  const items = th.flatMap(t => t.items.filter(i => i.who === 'person').map(i => ({ target: t.target, text: i.text, messageId: i.messageId, sessionId: i.sessionId })))
  check('both choices went out together, one prompt for both, to the conversation shown', items.length === 2 && items[0].messageId === items[1].messageId && items.every(i => i.sessionId === session.id) && items.some(i => i.target === 'D1') && items.some(i => i.target === 'D2'), JSON.stringify(items))
  check('nothing waits any more', (await pendingIds()).length === 0)
  check('the summary follows Claude', await page.$eval('.dm-claude', x => x.textContent.includes('Claude ·')))
  // A choice kept when the tab reloads goes out when the map opens again, to the conversation it was made for.
  await page.keyboard.press('Escape'); await sleep(300)
  await call('POST', `/api/canvas/${name}/choose`, { ws, decision: 'D2', option: null })
  await page.click('.canvas-bar .dec-chip'); await sleep(1000)
  await page.keyboard.press('1'); await page.keyboard.press('Enter'); await sleep(800)
  check('a new choice waits in the tab', (await pendingIds()).join() === 'D2')
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(5000)
  const again = (await call('GET', `/api/canvas/${name}/threads?ws=${W}`)).threads.flatMap(t => t.items).filter(i => i.who === 'person' && i.messageId !== items[0].messageId)
  check('after the reload it went out, to the same conversation', again.length === 1 && again[0].sessionId === session.id && (await pendingIds()).length === 0, JSON.stringify(again))
  await page.click('.canvas-bar .dec-chip'); await sleep(800)
}
await page.keyboard.press('Escape'); await sleep(300)
check('esc from the summary returns to the map', !(await state()))

check('no page errors', errors.length === 0, errors.join('\n'))
await browser.close()
await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
