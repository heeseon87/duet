// The terminal mod: a Claude Code session started through the Agent SDK with mod/ loaded says Duet is off while
// it finds no server, and once the server shows up registers as a terminal of the workspace, reads and changes
// a map with its tools (revisions signed by the agent from that
// terminal), shows the map in its status line, pins a map with /duet (status line, Duet's terminal list, the
// model's choice of map, again after /compact, the canvas and card in the browser, the next session in the folder), takes a canvas
// comment, a decision and a composer message sent to it from the browser, answers on their threads, and once it
// stops, leaves the menu and a send fails out loud. Asked for a new map, it makes one with duet_map_create and is pinned
// to it unless a pin is set; in a git repository no workspace holds, that map opens the repository as a workspace; in a
// folder outside every git repository, it says a git repository is needed.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_HOME=<the server's DUET_HOME> DUET_WS=<workspace> DUET_NESTED=<worktree under it> [DUET_SCRATCH=<folder>] node e2e/mod.mjs
//   (four Haiku sessions; makes and removes maps named mod-e2e*; every tool but the mod's is denied, so the trees stay as they are.
//   The mod gets a DUET_HOME of its own, empty until the server's server.json is copied in. Pins live in the mod's
//   Claude Code store under each folder's path; every session that pins ends with /duet off, which removes it.
//   It leaves, under DUET_SCRATCH (else the temp folder), a fresh git repository, which stays in Duet's workspace list,
//   and a folder outside git: both are named in the output.)
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_HOME: home, DUET_WS: ws, DUET_NESTED: nested, DUET_SHOTS: shots } = process.env
if (!T || !home || !ws || !nested) { console.error('DUET_TOKEN, DUET_HOME, DUET_WS and DUET_NESTED are required'); process.exit(2) }
const model = process.env.DUET_MODEL ?? 'claude-haiku-5-5'
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
const name = 'mod-e2e', title = '모드 시험 지도'
const pinName = 'mod-e2e-pin', pinTitle = '모드 고정 지도'
const gitStatus = () => execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' }) + execFileSync('git', ['-C', nested, 'status', '--porcelain'], { encoding: 'utf8' })
const until = async (what, fn, ms = 60_000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) { console.log('FAIL timed out:', what); return undefined }
    await sleep(500)
  }
}

await call('POST', '/api/workspaces', { path: ws })
for (const m of await call('GET', `/api/canvas?ws=${W}`)) if (m.name === name || m.name === pinName || m.name.startsWith('mod-e2e-new')) await call('DELETE', `/api/canvas/${m.name}?ws=${W}`)
// The map to pin comes first, so mod-e2e is the newest and the one the status line shows before any pin.
await call('POST', '/api/canvas', { ws, name: pinName, diagram: 'class', title: pinTitle })
await call('POST', `/api/canvas/${pinName}/patch`, { ws, note: '고정 시험 지도', patch: { elements: [{ id: 'Worker', label: '핀 워커' }] } })
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [{ id: 'ingest', kind: 'group' }, { id: 'Worker', label: '썸네일 워커', parent: 'ingest' }, { id: 'Job', parent: 'ingest' }, { id: 'Fast', decision: 'D1', option: 'D1-a' }, { id: 'Safe', decision: 'D1', option: 'D1-b' }],
  relations: [{ from: 'Worker', to: 'Job', label: 'take()' }, { from: 'Worker', to: 'Fast', decision: 'D1', option: 'D1-a' }, { from: 'Worker', to: 'Safe', decision: 'D1', option: 'D1-b' }],
  decisions: [{ id: 'D1', question: '실패하면 다시 시도할까?', options: [{ id: 'D1-a', text: '바로 끝낸다' }, { id: 'D1-b', text: '한 번 더 한다' }] }],
} })
const treeBefore = gitStatus()

const modHome = mkdtempSync(join(tmpdir(), 'duet-mod-'))
const env = { ...process.env, DUET_HOME: modHome, DUET_TOKEN: T }
delete env.CLAUDE_CODE_PLUGIN_DIRS

/** A Claude Code session with the mod, in the worktree unless told: streaming input, so the mod's own prompts and ours share it, as in a terminal. */
function startSession(cwd = nested) {
  const inbox = []
  let wake
  let closed = false
  const input = { [Symbol.asyncIterator]: () => ({ next: () => (inbox.length ? Promise.resolve({ value: inbox.shift(), done: false }) : closed ? Promise.resolve({ done: true }) : new Promise(r => { wake = r })) }) }
  const say = text => {
    const m = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }
    if (wake) { const w = wake; wake = undefined; w({ value: m, done: false }) } else inbox.push(m)
  }
  const q = query({
    prompt: input,
    options: {
      cwd,
      model,
      settingSources: ['project', 'local'],
      plugins: [{ type: 'local', path: fileURLToPath(new URL('../mod', import.meta.url)) }],
      env,
      canUseTool: async (tool, input) => (tool.startsWith('mcp__duet__duet_map_') ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Only the Duet map tools are allowed in this test.' }),
    },
  })
  const s = { id: '', results: [], tools: [], uses: [], outs: new Map(), statuses: [], compactions: 0 }
  s.ended = (async () => {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') s.id = m.session_id
      if (m.type === 'system' && m.subtype === 'ui_status' && m.plugin === 'duet') s.statuses.push(m.text)
      if (m.type === 'system' && m.subtype === 'compact_boundary') s.compactions++
      if (m.type === 'assistant') for (const c of m.message.content) if (c.type === 'tool_use') { s.tools.push(c.name); s.uses.push({ id: c.id, name: c.name, input: c.input }) }
      if (m.type === 'user' && Array.isArray(m.message?.content)) for (const c of m.message.content) if (c.type === 'tool_result') s.outs.set(c.tool_use_id, typeof c.content === 'string' ? c.content : (c.content ?? []).map(b => b.text ?? '').join(''))
      if (m.type === 'result') s.results.push(String(m.result ?? ''))
    }
  })()
  s.turn = async (text, ms = 120_000) => {
    const n = s.results.length
    say(text)
    await until(`answer to: ${text.slice(0, 40)}`, () => s.results.length > n, ms)
    return s.results[n] ?? ''
  }
  s.close = async () => {
    closed = true
    if (wake) { const w = wake; wake = undefined; w({ done: true }) }
    await s.ended.catch(() => undefined)
  }
  return s
}
const terminalOf = async (id, w = W) => (await call('GET', `/api/terminals?ws=${w}`)).find(t => t.id === id)
/** What a session's calls of one tool since `from` brought back, in order. */
const outputsOf = (s, tool, from = 0) => s.uses.slice(from).filter(u => u.name === tool).map(u => s.outs.get(u.id) ?? '')
/** The names a session's model gave one tool since `from`. */
const namesOf = (s, tool, from = 0) => s.uses.slice(from).filter(u => u.name === tool).map(u => u.input?.name)
/** The reads this session's model made since `from`, by the map name it passed. */
const readsSince = (s, from) => s.uses.slice(from).filter(u => u.name === 'mcp__duet__duet_map_read').map(u => u.input?.name)
/** A session's transcript file, row by row, the hidden rows too (getSessionMessages leaves those out). */
const transcriptRows = id => {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  const dir = readdirSync(root).find(d => existsSync(join(root, d, `${id}.jsonl`)))
  return dir ? readFileSync(join(root, dir, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
}
const textOf = row => { const c = row.message?.content; return typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text ?? '').join('') : '' }

const s1 = startSession()
const { results, tools, statuses, turn } = s1
let session = ''
const transcriptHas = async part => (await getSessionMessages(session, { dir: nested })).some(m => m.type === 'user' && JSON.stringify(m.message?.content ?? '').includes(part))

// 1. No server yet: the status and the tools say Duet is off. Once it shows up, the mod registers by itself.
// A pin an earlier run left in this folder goes first: /duet off needs no server.
const reset = await turn('/duet off')
check('/duet off answers while Duet is off', reset.includes('고정된 지도 없음') || reset.includes('지도 고정을 풀었어'), reset)
const off = await turn('Call the duet_map_list tool once, then tell me in one sentence what it said.')
check('without a server the status line reads Duet 꺼짐', statuses[0] === 'Duet 꺼짐', JSON.stringify(statuses))
check('a tool says plainly that Duet is not running', tools.includes('mcp__duet__duet_map_list') && /not running|duet/i.test(off), off.slice(0, 120))
check('nothing registers while there is no server', !(await call('GET', `/api/terminals?ws=${W}`)).length)
session = s1.id
copyFileSync(join(home, 'server.json'), join(modHome, 'server.json'))
const id8 = session.slice(0, 8)
const listed = await until('terminal listed', async () => (await call('GET', `/api/terminals?ws=${W}`)).find(t => t.id === session))
const folder = nested.split('/').pop()
check('the mod registers its session as a terminal of the workspace', listed?.workspace === ws && listed.label === `${folder} · ${id8}` && listed.cwd === nested, JSON.stringify(listed))
check('the status line recovers and shows the newest map', statuses.some(s => s.startsWith(`Duet · ${title} · rev `) && s.includes('결정 0/1')), JSON.stringify(statuses))

// 2. Reading and changing the map with the mod's tools.
const read = await turn(`Use the duet_map_read tool to read the Duet map named "${name}". Then answer with only the label of the box whose id is Worker.`)
check('asked to read a map, Haiku uses duet_map_read', tools.includes('mcp__duet__duet_map_read') && read.includes('썸네일 워커'), `${tools.join(',')} | ${read.slice(0, 80)}`)
const revBefore = (await call('GET', `/api/canvas/${name}?ws=${W}`)).revision
await turn(`Use the duet_map_update tool on the Duet map "${name}" to set the label of the box with id Job to "작업 큐", with the note "Job 이름 바꿈". Then reply with the one word: done.`)
const changed = await call('GET', `/api/canvas/${name}?ws=${W}`)
const last = changed.history.at(-1)
check('asked to change a box, Haiku uses duet_map_update', tools.includes('mcp__duet__duet_map_update') && changed.map.elements.find(e => e.id === 'Job')?.label === '작업 큐', tools.join(','))
check('the new rev is the agent\'s, signed with the terminal', changed.revision === revBefore + 1 && last.by === 'agent' && last.note === `터미널 · ${folder} · ${id8} · Job 이름 바꿈`, JSON.stringify(last))
await until('status follows the change', () => statuses.some(s => s.includes(`rev ${changed.revision}`)), 10_000)
check('the status line follows the map to its new rev', statuses.some(s => s.startsWith(`Duet · ${title} · rev ${changed.revision}`)), statuses.at(-1))

// 2b. /duet pins the map this terminal works from: the status line, Duet's terminal list and the model follow it.
const listing = await turn('/duet')
check('/duet lists the maps and says none is pinned', listing.includes('고정된 지도 없음') && listing.includes(`- ${name} · ${title} · rev `) && listing.includes(`- ${pinName} · ${pinTitle} · rev `), listing.slice(0, 200))
const pinned = await turn('/duet 고정 지도')
check('/duet <part of a title> pins that map', pinned.includes(`기준 지도: ${pinTitle} (${pinName})`), pinned)
await until('status shows the pin', () => statuses.some(s => s.startsWith(`Duet · 📌 ${pinTitle} · rev `)), 10_000)
check('the status line shows the pinned map with a pin', statuses.at(-1)?.startsWith(`Duet · 📌 ${pinTitle} · rev `), statuses.at(-1))
check('Duet\'s terminal list carries the pin', (await terminalOf(session))?.map === pinName, JSON.stringify(await terminalOf(session)))
const u0 = s1.uses.length
const unnamed = await turn('Read this terminal\'s map and answer with only the label of the box whose id is Worker.')
check('asked for "this terminal\'s map", Haiku reads the pinned one', readsSince(s1, u0).includes(pinName) && unnamed.includes('핀 워커'), `${JSON.stringify(readsSince(s1, u0))} | ${unnamed.slice(0, 80)}`)
const statusBefore = statuses.at(-1)
const unclear = await turn('/duet 모드')
check('an unclear /duet lists the candidates and changes nothing', unclear.includes('맞는 지도가') && unclear.includes(`- ${name} · ${title}`) && unclear.includes(`- ${pinName} · ${pinTitle}`) && (await terminalOf(session))?.map === pinName && statuses.at(-1) === statusBefore, unclear.slice(0, 200))
const exact = await turn(`/duet ${name}`)
await until('status follows the new pin', () => statuses.at(-1)?.startsWith(`Duet · 📌 ${title} · rev `), 10_000)
check('/duet <name> pins by the exact name, though another name holds it', exact.includes(`기준 지도: ${title} (${name})`) && (await terminalOf(session))?.map === name, exact)

// 3. The browser lists the terminal; picking it shows the card instead of a transcript.
execFileSync('npm', ['run', 'build'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' })
const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/mod-${n}.png` }) }
// The canvas starts on the other map: picking the terminal brings up the one it is pinned to.
await page.evaluate(([w, m, other]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, other); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`)
  localStorage.removeItem('duet.canvas.explore'); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem(`duet.canvas.seen:${w}:${m}`, '99'); localStorage.setItem(`duet.canvas.seen:${w}:${other}`, '99')
}, [ws, name, pinName])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-node', { timeout: 20000 }); await sleep(1200)
await page.click('.session-pick'); await sleep(400)
const item = await page.$(`.menu-item[data-terminal="${session}"]`)
check('the conversation menu lists the terminal under 터미널', Boolean(item) && (await item.textContent()).includes(`${folder} · ${id8}`) && (await page.$$eval('.popover .menu-label', ls => ls.some(l => l.textContent.startsWith('터미널')))))
await item?.click(); await sleep(400)
const card = await page.$eval('.agent-panel', p => ({ card: p.querySelector('.terminal-card:not(.gone)')?.textContent ?? '', head: p.querySelector('.session-pick')?.textContent ?? '', transcript: p.querySelectorAll('.transcript .block, .transcript .turn').length })).catch(() => null)
check('picking it shows the card: label, folder, last seen, where messages go', card?.card.includes(`${folder} · ${id8}`) && card.card.includes('마지막 연락') && card.card.includes('Claude Code 세션으로 가') && card.head.includes(id8), JSON.stringify(card))
check('the card shows the map the terminal is pinned to', card?.card.includes(`기준 지도${title}`), card?.card)
const opened = await until('canvas opens the pinned map', () => page.evaluate(([w, m]) => localStorage.getItem(`duet.canvas.current:${w}`) === m && [...document.querySelectorAll('.stage-inner > svg .cv-node[data-target="Worker"]')].some(n => n.textContent.includes('썸네일 워커')), [ws, name]), 10_000)
check('picking the terminal opens its pinned map on the canvas', Boolean(opened))
await sleep(800)
const pinsShown = await page.evaluate(() => {
  const s = document.querySelector('.stage-canvas').getBoundingClientRect()
  const pins = [...document.querySelectorAll('.stage-inner > svg .cv-pin')].map(p => p.getBoundingClientRect())
  return pins.length > 0 && pins.every(r => r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom)
})
check('the map it opens is fitted: its decision pins are on screen', pinsShown)
await shot('card')

// 4. A canvas comment goes to the terminal, shows where it stands, and the answer lands on its thread.
const node = await page.$eval('.stage-inner > svg .cv-node[data-target="Worker"]', n => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
await page.mouse.click(node.x, node.y, { button: 'right' }); await sleep(300)
await page.click('.ctx-menu .menu-item:has-text("에이전트에게 묻기")'); await sleep(300)
const comment = '이 상자는 무슨 일을 해? 도구는 쓰지 말고 한 문장으로 답해 줘. 답에 RETRY-OK를 넣어 줘.'
await page.fill('.ctx-ask textarea', comment)
await page.click('.ctx-ask button:has-text("에이전트에게")')
const thread = await until('comment thread', async () => (await call('GET', `/api/canvas/${name}/threads?ws=${W}`)).threads.find(t => t.target === 'Worker'), 10_000)
check('the comment is kept on the box\'s thread, sent to the terminal', thread?.items[0]?.who === 'person' && thread.items[0].terminal === session && !thread.items[0].sessionId, JSON.stringify(thread?.items[0]))
const states = []
const answered = await until('comment answered', async () => {
  const { threads, deliveries } = await call('GET', `/api/canvas/${name}/threads?ws=${W}`)
  const t = threads.find(x => x.target === 'Worker')
  const d = t && deliveries[t.items[0].id]
  if (d && states.at(-1) !== d.state) states.push(d.state)
  return d?.state === 'answered' || d?.state === 'ended' ? t : undefined
}, 150_000)
check('the thread shows where it stands: with the terminal, then answered', states.some(s => s === 'delivered' || s === 'working') && states.at(-1) === 'answered', states.join(' → '))
check('the comment arrives in the session as a user message', await transcriptHas(comment) && await transcriptHas('[캔버스 코멘트]'))
const reply = answered?.items.find(i => i.who === 'agent')
check('the answer lands on the thread, from the terminal', reply?.terminal === session && reply.text.includes('RETRY-OK'), reply?.text.slice(0, 100))
await page.keyboard.press('Escape'); await sleep(200)
await page.mouse.click(node.x, node.y); await sleep(500)
const shown = await page.$$eval('.inspector .thread .delivery', ds => ds.map(d => d.textContent)).catch(() => [])
check('the info card shows the delivery', shown.some(t => t.startsWith('답함')), JSON.stringify(shown))
await shot('comment')

// 5. A decision sent with notify goes the same way.
await page.keyboard.press('Escape'); await sleep(200)
const pin = await page.$eval('.stage-inner > svg [data-target="Fast"] .cv-pin[data-pin="D1"] rect', r => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
await page.mouse.click(pin.x, pin.y); await sleep(400)
await page.click('.inspector .decision.open .option.pickable >> nth=1'); await sleep(200)
check('choosing offers the agent notice, on by default', await page.$eval('.decide-form .toggle input', i => i.checked))
await page.click('.decide-form button:has-text("b로 결정")')
const toastSeen = await until('decision toast', () => page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('결정을 터미널에 보냈어'))), 5_000)
const decided = await until('decision answered', async () => {
  const { threads, deliveries } = await call('GET', `/api/canvas/${name}/threads?ws=${W}`)
  const t = threads.find(x => x.target === 'D1')
  return t && deliveries[t.items[0].id]?.state === 'answered' ? t : undefined
}, 150_000)
check('the decision goes to the terminal and the toast says so', decided?.items[0]?.terminal === session && decided.items[0].text.startsWith('b로 정함') && toastSeen, JSON.stringify(decided?.items[0]))
check('the decision arrives in the session as a user message', await transcriptHas('[캔버스 결정]') && await transcriptHas('D1-b'))
check('its answer lands on the decision\'s thread', decided?.items.some(i => i.who === 'agent' && i.terminal === session))
await shot('decision')

// 6. What is typed in the composer goes there too, composed as a conversation would get it.
await page.keyboard.press('Escape'); await sleep(200)
const n = results.length
await page.fill('.composer textarea', 'COMPOSER 확인: 도구 없이 composer-ok라고만 답해 줘.')
await page.keyboard.press('Enter')
await until('composer answer', () => results.length > n, 120_000)
check('the composer\'s message reaches the session', await transcriptHas('COMPOSER 확인') && results.slice(n).some(r => r.includes('composer-ok')), results.slice(n).join(' | ').slice(0, 100))

// 7. A batch of review comments goes there too, and stays marked as sent to it.
const source = { kind: 'working' }
const kept = await call('POST', '/api/review/comments/get', { ws, source })
const note = { id: `c-mod-${Date.now()}`, path: 'README.md', side: 'new', startLine: 1, endLine: 1, excerpt: '', body: 'REVIEW 확인: 도구 없이 review-ok라고만 답해 줘.', created: Date.now(), state: 'draft' }
await call('POST', '/api/review/comments/put', { ws, source, comments: [...kept, note] })
const r0 = results.length
const sentReview = await call('POST', '/api/review/send', { ws, source, terminalId: session, ids: [note.id], header: '리뷰: e2e' })
await until('review answer', () => results.length > r0, 120_000)
const stored = (await call('POST', '/api/review/comments/get', { ws, source })).find(c => c.id === note.id)
check('review comments go to the terminal and stay marked as sent there', sentReview.terminalId === session && stored?.state === 'sent' && stored.sentTo?.terminal === session && await transcriptHas('REVIEW 확인'), JSON.stringify(stored?.sentTo))
await call('POST', '/api/review/comments/put', { ws, source, comments: kept })

// 7b. /duet off unpins; pinned again, the pin outlives the session for the next one in this folder.
const off2 = await turn('/duet off')
await until('status drops the pin', () => statuses.at(-1) && !statuses.at(-1).includes('📌'), 10_000)
check('/duet off unpins: the reply, the status line and Duet\'s list', off2.includes(`지도 고정을 풀었어 (${name})`) && !statuses.at(-1).includes('📌') && (await terminalOf(session))?.map === undefined, `${off2} | ${statuses.at(-1)}`)
check('pinned again for the next session', (await turn(`/duet ${pinName}`)).includes(`기준 지도: ${pinTitle} (${pinName})`))

// 7c. After /compact, whose summary is told to drop the note, the model hears of the pin again before its next answer.
// A turn first: commands typed since the last answer reach the model with the next prompt, past a compaction.
await turn('Reply with the single word: ok')
await turn('/compact Keep the summary to one sentence. Leave out every [Duet] note, every map name and every map title.', 240_000)
await until('compact boundary', () => s1.compactions > 0, 30_000)
const u3 = s1.uses.length
const recalled = await turn('Read this terminal\'s map and answer with only the label of the box whose id is Worker.')
check('after /compact, asked for "this terminal\'s map", Haiku still reads the pinned one', readsSince(s1, u3).includes(pinName) && recalled.includes('핀 워커'), `${JSON.stringify(readsSince(s1, u3))} | ${recalled.slice(0, 80)}`)
const rows = transcriptRows(session)
const sinceCompaction = rows.slice(rows.findLastIndex(r => r.type === 'system' && r.subtype === 'compact_boundary') + 1)
const notes = sinceCompaction.flatMap((r, i) => (r.type === 'user' && r.isMeta && textOf(r).includes(`[Duet] This terminal works from the Duet map "${pinName}"`) ? [i] : []))
const answer = sinceCompaction.findIndex(r => r.type === 'assistant')
check('the session log has the pin note once after the compaction, before that answer', s1.compactions > 0 && notes.length === 1 && notes[0] < answer, JSON.stringify({ compactions: s1.compactions, notes, answer }))

// 8. The session stops: the terminal leaves the menu, and a send to it fails with a toast.
await s1.close()
const gone = await until('terminal gone', async () => !(await call('GET', `/api/terminals?ws=${W}`)).some(t => t.id === session), 60_000)
check('stopping the session takes the terminal off the list', Boolean(gone))
await sleep(500)
const goneCard = await page.$eval('.agent-panel .terminal-card', c => c.classList.contains('gone') && c.textContent.includes('닫혔어')).catch(() => false)
await page.click('.session-pick'); await sleep(400)
check('the menu no longer lists it, and the card says it closed', !(await page.$(`.menu-item[data-terminal="${session}"]`)) && goneCard)
await page.keyboard.press('Escape'); await sleep(200)
await page.mouse.click(node.x, node.y, { button: 'right' }); await sleep(300)
await page.click('.ctx-menu .menu-item:has-text("에이전트에게 묻기")'); await sleep(300)
await page.fill('.ctx-ask textarea', '아직 거기 있어?')
await page.click('.ctx-ask button:has-text("에이전트에게")')
const failToast = await until('send-fails toast', () => page.evaluate(() => [...document.querySelectorAll('.toast')].find(t => t.textContent.includes('닫혔어'))?.textContent), 5_000)
const after = (await call('GET', `/api/canvas/${name}/threads?ws=${W}`)).threads.find(t => t.target === 'Worker')
check('a send to the closed terminal fails with a toast, and nothing is kept', Boolean(failToast) && after.items.length === answered.items.length && Boolean(await page.$('.ctx-ask textarea')), failToast)
await shot('gone')

// 9. A new session in the same folder starts pinned: its status line, Duet's list, and its model, told without a turn.
const s2 = startSession()
const s2Pinned = await until('new session shows the pin', () => s2.statuses.some(s => s.startsWith(`Duet · 📌 ${pinTitle} · rev `)), 60_000)
const u2 = s2.uses.length
const fresh = await s2.turn('Read this terminal\'s map and answer with only the label of the box whose id is Worker.')
check('a new session in the folder starts pinned to the map', Boolean(s2Pinned) && (await terminalOf(s2.id))?.map === pinName, JSON.stringify(s2.statuses))
check('its model reads the pinned map when asked for this terminal\'s map', readsSince(s2, u2).includes(pinName) && fresh.includes('핀 워커'), `${JSON.stringify(readsSince(s2, u2))} | ${fresh.slice(0, 80)}`)
check('/duet off in the new session unpins it', (await s2.turn('/duet off')).includes(`지도 고정을 풀었어 (${pinName})`) && (await terminalOf(s2.id))?.map === undefined)

// 10. Asked for a new map with no pin set, Haiku makes it and draws on it; the terminal is pinned to it. A second new map leaves the pin.
const stamp = Date.now().toString(36)
const made = `mod-e2e-new-${stamp}`, madeTitle = '모드 새 지도'
const made2 = `mod-e2e-new2-${stamp}`, made2Title = '모드 둘째 지도'
const s2id8 = s2.id.slice(0, 8)
const c0 = s2.uses.length
await s2.turn(`Create a new class map named "${made}", titled "${madeTitle}", with one box. Then reply with the one word: done.`)
const createdAt = s2.uses.findIndex((u, i) => i >= c0 && u.name === 'mcp__duet__duet_map_create' && u.input?.name === made)
const drawnAt = s2.uses.findIndex((u, i) => i > createdAt && u.name === 'mcp__duet__duet_map_update' && u.input?.name === made)
check('asked for a new map, Haiku calls duet_map_create and then duet_map_update', createdAt >= 0 && drawnAt > createdAt, s2.uses.slice(c0).map(u => u.name).join(','))
const madeMap = await call('GET', `/api/canvas/${made}?ws=${W}`).catch(() => undefined)
const signedBy = `터미널 · ${folder} · ${s2id8} · `
check('the map is in Duet, every rev the agent\'s and signed with the terminal, the first one too', madeMap?.history[0]?.by === 'agent' && madeMap.history[0].note === `${signedBy}새 지도` && madeMap.history.length > 1 && madeMap.history.every(r => r.by === 'agent' && r.note.startsWith(signedBy)) && madeMap.map.elements.length > 0, JSON.stringify(madeMap?.history.map(r => [r.by, r.note])))
check('the create result carries the drawing guide and tells the model of the pin', (outputsOf(s2, 'mcp__duet__duet_map_create', c0)[0] ?? '').startsWith('Duet canvas:') && outputsOf(s2, 'mcp__duet__duet_map_create', c0)[0].includes(`[Duet] This terminal works from the Duet map "${made}"`), outputsOf(s2, 'mcp__duet__duet_map_create', c0)[0]?.slice(-200))
await until('status shows the new pin', () => s2.statuses.at(-1)?.startsWith(`Duet · 📌 ${madeTitle} · rev `), 10_000)
check('the terminal is pinned to the new map: the status line and Duet\'s list', s2.statuses.at(-1)?.startsWith(`Duet · 📌 ${madeTitle} · rev `) && (await terminalOf(s2.id))?.map === made, `${s2.statuses.at(-1)} | ${JSON.stringify(await terminalOf(s2.id))}`)
const c1 = s2.uses.length
await s2.turn(`Create another new class map named "${made2}", titled "${made2Title}", with one box. Then reply with the one word: done.`)
await sleep(1500)
const made2Map = await call('GET', `/api/canvas/${made2}?ws=${W}`).catch(() => undefined)
check('with a pin set, a second new map leaves the pin', namesOf(s2, 'mcp__duet__duet_map_create', c1).includes(made2) && made2Map?.history[0]?.note === `${signedBy}새 지도` && (await terminalOf(s2.id))?.map === made && s2.statuses.at(-1)?.startsWith(`Duet · 📌 ${madeTitle} · rev `) && !outputsOf(s2, 'mcp__duet__duet_map_create', c1).some(o => o.includes('[Duet]')), `${s2.statuses.at(-1)} | ${JSON.stringify(await terminalOf(s2.id))}`)
check('/duet off unpins the new map', (await s2.turn('/duet off')).includes(`지도 고정을 풀었어 (${made})`))
await s2.close()

// 11. In a git repository no workspace holds, the status says so, and a new map opens the repository as a Duet workspace.
const scratch = process.env.DUET_SCRATCH ?? tmpdir()
const freshRepo = join(scratch, `fresh-ws-${stamp}`)
mkdirSync(freshRepo)
const git = (...a) => execFileSync('git', ['-c', 'user.email=e2e@duet', '-c', 'user.name=e2e', ...a], { cwd: freshRepo, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
writeFileSync(join(freshRepo, 'README.md'), '# fresh\n')
git('add', '-A')
git('commit', '-qm', 'first')
const freshWs = realpathSync(freshRepo), FW = encodeURIComponent(freshWs)
const freshMap = `mod-e2e-fresh-${stamp}`, freshTitle = '새 작업 공간 지도'
const s3 = startSession(freshRepo)
const s3Off = await until('no-workspace status', () => s3.statuses.includes('Duet 작업 공간 없음'), 60_000)
check('in a repository no workspace holds, the status line reads Duet 작업 공간 없음', Boolean(s3Off) && !(await call('GET', '/api/workspaces')).some(w => w.path === freshWs), JSON.stringify(s3.statuses))
await s3.turn(`Create a new class map named "${freshMap}", titled "${freshTitle}", with one box. Then reply with the one word: done.`)
check('the new map opens the repository as a Duet workspace', (await call('GET', '/api/workspaces')).some(w => w.path === freshWs), freshWs)
const freshCanvas = await call('GET', `/api/canvas/${freshMap}?ws=${FW}`).catch(() => undefined)
check('the map is there, drawn by the terminal', s3.tools.includes('mcp__duet__duet_map_create') && freshCanvas?.map.elements.length > 0 && freshCanvas.history[0].note === `터미널 · ${freshRepo.split('/').pop()} · ${s3.id.slice(0, 8)} · 새 지도`, JSON.stringify(freshCanvas?.history.map(r => r.note)))
await until('status shows the map', () => s3.statuses.at(-1)?.startsWith(`Duet · 📌 ${freshTitle} · rev `), 10_000)
check('the status line shows the map, and the terminal is in the new workspace', s3.statuses.at(-1)?.startsWith(`Duet · 📌 ${freshTitle} · rev `) && (await terminalOf(s3.id, FW))?.map === freshMap, JSON.stringify(s3.statuses))
check('/duet off unpins it', (await s3.turn('/duet off')).includes(`지도 고정을 풀었어 (${freshMap})`))
await s3.close()
await call('DELETE', `/api/canvas/${freshMap}?ws=${FW}`)

// 12. In a folder outside every git repository, the tools point to duet_map_create, which says a git repository is needed.
const loose = join(scratch, `no-git-${stamp}`)
mkdirSync(loose)
const looseWs = realpathSync(loose)
const s4 = startSession(loose)
await until('no-workspace status', () => s4.statuses.includes('Duet 작업 공간 없음'), 60_000)
await s4.turn('Call the duet_map_list tool once, then tell me in one sentence what it said.')
check('outside every workspace the other tools refuse, pointing to duet_map_create', outputsOf(s4, 'mcp__duet__duet_map_list').some(o => o.includes('duet_map_create')), outputsOf(s4, 'mcp__duet__duet_map_list')[0])
await s4.turn(`Create a new class map named "mod-e2e-nogit-${stamp}", titled "깃 없는 지도", with one box. If it fails, reply with what the tool said.`)
const nogit = outputsOf(s4, 'mcp__duet__duet_map_create')
check('there duet_map_create says a git repository is needed, and opens nothing', nogit.length > 0 && nogit.every(o => o.includes('git repository') && o.includes(loose)) && !(await call('GET', '/api/workspaces')).some(w => w.path === looseWs) && s4.statuses.at(-1) === 'Duet 작업 공간 없음', nogit[0])
await s4.close()
console.log('left behind:', freshRepo, loose)

check('nothing outside the map changed in the trees', gitStatus() === treeBefore)
await call('DELETE', `/api/canvas/${name}?ws=${W}`)
await call('DELETE', `/api/canvas/${pinName}?ws=${W}`)
for (const m of [made, made2]) await call('DELETE', `/api/canvas/${m}?ws=${W}`).catch(() => undefined)
// The send to the closed terminal is meant to fail; the browser logs its 410.
const unexpected = errors.filter(e => !e.includes('status of 410'))
if (unexpected.length) { failed++; console.log('page errors', unexpected) }
await browser.close()
process.exit(failed ? 1 : 0)
