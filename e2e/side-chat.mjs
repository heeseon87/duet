// Side chats (사이드 채팅): ⌘J opens a drawer beside the main area; a question there is answered by a fork of the rail's
// terminal and kept as a chat; a follow-up replays the chat so far, 새 사이드 채팅 starts one with nothing replayed; 기록 lists
// chats by last activity and reopens one; a question being answered shuts its box; a chat whose session closed says so
// and moves to the terminal picked now (※ on the earlier Q&A, a divider); ↗ sends the chat to the main conversation as one
// message; a deleted chat stays deleted after a reload; a terminal whose mod cannot fork is refused with nothing kept;
// esc in an empty box closes the drawer, and ⌘J (ㅓ with the Korean input source) reopens it on the chat it showed.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<a git repo> DUET_SHOTS=/dir node e2e/side-chat.mjs
//   (deletes the workspace's side chats before and after; run it against a dev server)
import { fakeTerminal, open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7981)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const W = encodeURIComponent(ws)
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
const chats = () => call('GET', `/api/side?ws=${W}`)
const clear = async () => { for (const c of await chats()) await call('DELETE', `/api/side/${c.id}?ws=${W}`) }
const stamp = Date.now().toString(36)
/** Each fork answers with its name and the question it was asked. */
const answerOf = who => ask => `${who}의 답: ${ask.prompt.split('\n').at(-1).replace('질문: ', '')}`

await call('POST', '/api/workspaces', { path: ws })
await clear()
const A = await fakeTerminal({ port, token: T, ws, id: `side-a-${stamp}`, label: 'A-term', side: answerOf('A'), sideMs: 1500 })

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 900 })
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }
const shot = async label => { if (shots) await page.screenshot({ path: `${shots}/side-${label}.png` }) }
const box = '.side-panel-foot textarea'
const panel = () => page.$('.side-panel')
await page.evaluate(() => localStorage.setItem('duet.tab', 'review'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rail-side', { timeout: 15000 }); await sleep(1200)

// 1. ⌘J opens the drawer over the review, the box ready for a new chat on the rail's terminal.
await page.keyboard.press('Meta+j'); await sleep(400)
check('⌘J opens the drawer, its box focused', Boolean(await panel()) && await page.evaluate(() => document.activeElement?.matches('.side-panel-foot textarea') ?? false))
const cols = await page.evaluate(() => ({ main: document.querySelector('.main').getBoundingClientRect(), side: document.querySelector('.side-panel').getBoundingClientRect() }))
check('it is a column of its own right of the main area', cols.main.right <= cols.side.left + 1 && Math.abs(cols.side.width - 380) < 2 && Math.abs(cols.side.right - 1500) < 2, JSON.stringify(cols))
const edge = await page.$eval('.side-split', x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await page.mouse.move(edge.x, edge.y); await page.mouse.down(); await page.mouse.move(edge.x - 120, edge.y, { steps: 6 }); await page.mouse.up(); await sleep(200)
const wide = await page.$eval('.side-panel', x => x.getBoundingClientRect().width)
check('dragging its left edge widens it', Math.abs(wide - 500) < 3, String(wide))
check('its scrollbars are the quiet ones, shown only while scrolling', await page.$eval('.side-panel-body', x => x.classList.contains('quiet-scroll')))
check('a new chat names the terminal that will answer it', await page.$eval('.side-panel-term', x => x.textContent.includes('A-term')))
check('the rail\'s 사이드 shows the drawer open', await page.$eval('.rail-side', x => x.getAttribute('aria-pressed') === 'true'))

// 2. A question waits with its box shut, then the fork's answer lands.
await page.fill(box, '첫 질문이야')
await page.press(box, 'Enter'); await sleep(600)
check('while the fork answers, the turn says so and the box is shut', await page.$eval('.side-panel', p => Boolean(p.querySelector('.side-turn[data-state="asking"]')?.textContent.includes('곁에서 답하는 중')) && p.querySelector('.side-panel-foot textarea').disabled))
await sleep(2200)
let all = await chats()
check('the question is kept as a chat, answered by the fork of the rail\'s terminal', all.length === 1 && all[0].turns[0].question === '첫 질문이야' && all[0].turns[0].terminal === A.id && all[0].turns[0].reply?.text === 'A의 답: 첫 질문이야', JSON.stringify(all))
check('the drawer shows the answer and opens the box again', await page.$eval('.side-panel', p => p.textContent.includes('A의 답: 첫 질문이야') && !p.querySelector('.side-panel-foot textarea').disabled))
check('the first question carries nothing earlier', A.asked.length === 1 && !A.asked[0].prompt.includes('앞서 나눈 말'), A.asked[0]?.prompt)
const first = all[0].id

// 3. A follow-up replays the chat so far to the same session.
await page.fill(box, '이어서 묻는 말'); await page.press(box, 'Enter'); await sleep(2600)
check('a follow-up asks the same session, replaying the chat so far', A.asked.length === 2 && A.asked[1].prompt.includes('- 사람: 첫 질문이야\n- 너: A의 답: 첫 질문이야') && A.asked[1].prompt.endsWith('질문: 이어서 묻는 말'), A.asked[1]?.prompt)
check('and it is that chat\'s second turn', (await chats()).find(c => c.id === first)?.turns.length === 2)

// 4. 새 사이드 채팅 starts a chat with nothing replayed.
await page.click('.side-new'); await sleep(300)
check('새 사이드 채팅 shows an empty chat with the box ready', Boolean(await page.$('.side-empty')) && await page.evaluate(() => document.activeElement?.matches('.side-panel-foot textarea') ?? false))
await page.fill(box, '새로 묻는 말'); await page.press(box, 'Enter'); await sleep(2600)
check('its question carries nothing earlier', A.asked.length === 3 && !A.asked[2].prompt.includes('앞서 나눈 말'), A.asked[2]?.prompt)
all = await chats()
const second = all.find(c => c.id !== first)?.id
check('two chats now', all.length === 2 && Boolean(second))

// 5. 기록 lists them by last activity; a click reopens one.
await page.click('.side-history-btn'); await sleep(300)
const rows = await page.$$eval('.side-row', rs => rs.map(r => ({ id: r.getAttribute('data-chat'), text: r.textContent })))
check('기록 lists the chats latest first, each with its title, session and Q&A count', rows.length === 2 && rows[0].id === second && rows[1].id === first && rows[1].text.includes('첫 질문이야') && rows[1].text.includes('A-term') && rows[1].text.includes('2문답'), JSON.stringify(rows))
await page.click(`.side-row[data-chat="${first}"]`); await sleep(300)
check('a click reopens that chat', await page.$eval('.side-panel-body', b => b.textContent.includes('첫 질문이야') && b.textContent.includes('이어서 묻는 말') && !b.textContent.includes('새로 묻는 말')))
await shot('chat')

// 6. A's session closes: the chat says so, and asking moves it to the terminal picked now.
await A.stop(); await sleep(1000)
check('a chat whose session closed says so', await page.$eval('.side-gone', x => x.textContent.includes('A-term 세션이 닫혔거나 /clear로 바뀌었어')).catch(() => false))
const B = await fakeTerminal({ port, token: T, ws, id: `side-b-${stamp}`, label: 'B-term', side: answerOf('B') })
await sleep(1000)
await page.fill(box, 'B에게 이어서')
await page.click('.side-move'); await sleep(1500)
check('asking moves the chat to the live terminal, the earlier Q&A marked as another session\'s', B.asked.length === 1 && B.asked[0].prompt.includes('- ※ 사람: 첫 질문이야') && B.asked[0].prompt.includes('※는 다른 세션에서'), B.asked[0]?.prompt)
const moved = (await chats()).find(c => c.id === first)
check('the chat is bound to B from then on', moved?.turns.map(t => t.terminal).join() === [A.id, A.id, B.id].join() && moved.turns[2].reply?.text === 'B의 답: B에게 이어서', JSON.stringify(moved))
check('the thread marks where it moved, and the banner is gone', await page.$eval('.side-moved', x => x.textContent.includes('여기부터 B-term')).catch(() => false) && !(await page.$('.side-gone')))
await shot('moved')

// 7. ↗ sends the chat to the main conversation of its session, as one message.
await page.click('.side-panel-head .side-to-main'); await sleep(1500)
check('↗ puts one message in B with the Q&A and the last question, and nothing else reached a terminal as a prompt',
  B.got.length === 1 && A.got.length === 0 && B.got[0].text.includes('[Duet 사이드 채팅]') && B.got[0].text.includes('- 사람: 첫 질문이야') && B.got[0].text.trimEnd().endsWith('B에게 이어서'), B.got[0]?.text)

// 8. A chat deleted from 기록 stays deleted after a reload.
await page.click('.side-history-btn'); await sleep(300)
await page.hover(`.side-row[data-chat="${second}"]`)
await page.click(`.side-row[data-chat="${second}"] .side-row-del`); await sleep(300)
check('deleting asks first', Boolean(await page.$('.confirm')))
await page.click('.confirm .btn.danger-solid'); await sleep(600)
check('the chat leaves 기록', !(await page.$(`.side-row[data-chat="${second}"]`)) && Boolean(await page.$(`.side-row[data-chat="${first}"]`)))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rail-side', { timeout: 15000 }); await sleep(1200)
await page.click('.rail-side'); await sleep(300)
await page.click('.side-history-btn'); await sleep(300)
check('the rail\'s 사이드 opens the drawer too, and the chat stays deleted after a reload', (await chats()).every(c => c.id !== second) && !(await page.$(`.side-row[data-chat="${second}"]`)) && Boolean(await page.$(`.side-row[data-chat="${first}"]`)))
check('it keeps the width it was dragged to', Math.abs(await page.$eval('.side-panel', x => x.getBoundingClientRect().width) - 500) < 3)
await page.dblclick('.side-split'); await sleep(200)
check('a double-click on its edge puts the width back', Math.abs(await page.$eval('.side-panel', x => x.getBoundingClientRect().width) - 380) < 2)

// 9. A terminal whose mod cannot fork: refused out loud, nothing kept.
const C = await fakeTerminal({ port, token: T, ws, id: `side-c-${stamp}`, label: 'C-term', canAsk: false })
await sleep(800)
await page.click('.rail-btn.term'); await sleep(300)
await page.click(`.menu-item[data-terminal="${C.id}"]`); await sleep(300)
await page.click('.side-new'); await sleep(300)
const count = (await chats()).length
await page.fill(box, '못 받는 터미널에 묻기'); await page.press(box, 'Enter'); await sleep(800)
check('a terminal whose mod cannot fork is refused out loud, and nothing is kept', (await page.$eval('.toasts', t => t.textContent)).includes('곁질문을 몰라') && (await chats()).length === count && C.asked.length === 0)
check('the question stays in the box', (await page.$eval(box, x => x.value)) === '못 받는 터미널에 묻기')

// 10. esc in an empty box closes the drawer alone; ⌘J as ㅓ reopens it on the chat it showed.
await page.click('.side-history-btn'); await sleep(200)
await page.click(`.side-row[data-chat="${first}"]`); await sleep(300)
await page.focus(box); await page.keyboard.press('Escape'); await sleep(300)
check('esc in the empty box closes the drawer', !(await panel()))
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅓ', code: 'KeyJ', metaKey: true, bubbles: true })))
await sleep(400)
check('⌘J as ㅓ (Korean input source) reopens it on the chat it showed last', Boolean(await panel()) && await page.$eval('.side-panel-body', b => b.textContent.includes('B에게 이어서')))
await page.keyboard.press('Meta+j'); await sleep(300)
check('⌘J closes it again', !(await panel()))

// The refused ask shows in the console as a failed request; it is the refusal checked above.
const unexpected = errors.filter(e => !/status of 409/.test(e))
check('no page errors', unexpected.length === 0, unexpected.join('\n'))
await browser.close()
await B.stop()
await C.stop()
await clear()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
