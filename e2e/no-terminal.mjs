// Duet sends only to terminals. With no terminal named, a canvas comment, a choice told to Claude, a batch of decided
// choices and a review send are each refused (409) before anything is written; with one, they go to it. A thread item
// sent to a Duet conversation (from before there were only terminals) reads as ended, a saved turn view is refused
// (410), and the conversation routes are gone.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_HOME=<the server's> DUET_WS=<scratch repo> node e2e/no-terminal.mjs
//   (makes and removes a map named no-terminal and a stand-in terminal)
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fakeTerminal } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_HOME: home } = process.env
if (!T || !ws || !home) { console.error('DUET_TOKEN, DUET_HOME and DUET_WS are required'); process.exit(2) }
const name = 'no-terminal'
const W = encodeURIComponent(ws)
const raw = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
const call = async (method, path, body) => {
  const r = await raw(method, path, body)
  if (r.status >= 400) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }
// The map's files, as the server keeps them (server/canvas/store.ts, slugOf in server/util.ts).
const slug = `${basename(ws).replace(/[^A-Za-z0-9._-]/g, '_')}-${createHash('sha1').update(ws).digest('hex').slice(0, 10)}`
const threadsFile = join(home, 'canvas', slug, `${name}.threads.json`)
const threadsNow = () => { try { return readFileSync(threadsFile, 'utf8') } catch { return '' } }

await call('POST', '/api/workspaces', { path: ws })
if ((await call('GET', `/api/terminals?ws=${W}`)).length) { console.error('a terminal is connected to this workspace: give a workspace with none'); process.exit(2) }
await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '터미널 없음 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [{ id: 'A', decision: 'D1', option: 'D1-a' }, { id: 'B', decision: 'D1', option: 'D1-b' }, { id: 'C' }],
  decisions: [{ id: 'D1', question: '어느 쪽?', options: [{ id: 'D1-a', text: 'A' }, { id: 'D1-b', text: 'B' }] }],
} })
const NO_TERMINAL = '연결된 터미널이 없어'

// 1. A comment on the map: refused, no thread written.
let before = threadsNow()
let r = await raw('POST', `/api/canvas/${name}/comment`, { ws, target: 'C', text: '이거 왜 있어?' })
check('a comment with no terminal is refused, and no thread is written', r.status === 409 && r.body?.error?.includes(NO_TERMINAL) && threadsNow() === before, `${r.status} ${JSON.stringify(r.body)}`)

// 2. A choice told to Claude: refused, the map not chosen.
const rev = (await call('GET', `/api/canvas/${name}?ws=${W}`)).revision
r = await raw('POST', `/api/canvas/${name}/choose`, { ws, decision: 'D1', option: 'D1-a', notify: true })
const after = await call('GET', `/api/canvas/${name}?ws=${W}`)
check('a choice told to Claude with no terminal is refused, and the map stays open', r.status === 409 && after.revision === rev && !after.map.decisions[0].chosen, `${r.status} rev ${rev}→${after.revision}`)

// 3. Decided in decision mode (choice made, not told), then the batch: refused, no thread written.
await call('POST', `/api/canvas/${name}/choose`, { ws, decision: 'D1', option: 'D1-a' })
before = threadsNow()
r = await raw('POST', `/api/canvas/${name}/decided`, { ws, decisions: ['D1'] })
check('a batch of decided choices with no terminal is refused, and no thread is written', r.status === 409 && threadsNow() === before, `${r.status} ${JSON.stringify(r.body)}`)

// 4. Review comments: refused, still drafts.
const source = { kind: 'working' }
const comment = { id: 'c-noterm', path: 'README.md', side: 'new', startLine: 1, endLine: 1, excerpt: '', body: '여기 고쳐 줘', created: Date.now(), state: 'draft' }
const kept = await call('POST', '/api/review/comments/get', { ws, source })
await call('POST', '/api/review/comments/put', { ws, source, comments: [...kept.filter(c => c.id !== comment.id), comment] })
r = await raw('POST', '/api/review/send', { ws, source, ids: [comment.id], header: '리뷰 코멘트' })
const still = (await call('POST', '/api/review/comments/get', { ws, source })).find(c => c.id === comment.id)
check('a review send with no terminal is refused, and the comment stays a draft', r.status === 409 && still?.state === 'draft' && !still.sentTo, `${r.status} ${JSON.stringify(still)}`)

// 5. With a terminal named, the same go out to it.
const term = await fakeTerminal({ port, token: T, ws, label: 'no-terminal' })
const sent = await call('POST', `/api/canvas/${name}/comment`, { ws, target: 'C', text: '이거 왜 있어?', terminalId: term.id })
const batch = await call('POST', `/api/canvas/${name}/decided`, { ws, decisions: ['D1'], terminalId: term.id })
const review = await call('POST', '/api/review/send', { ws, source, ids: [comment.id], header: '리뷰 코멘트', terminalId: term.id })
for (let i = 0; i < 40 && term.got.length < 3; i++) await new Promise(res => setTimeout(res, 250))
const sentNow = (await call('POST', '/api/review/comments/get', { ws, source })).find(c => c.id === comment.id)
check('named, a comment, a batch and a review send all reach the terminal', sent.terminalId === term.id && batch.terminalId === term.id && review.terminalId === term.id && term.got.length === 3 && sentNow?.sentTo?.terminal === term.id, `${term.got.length} · ${JSON.stringify(sentNow?.sentTo)}`)
await term.stop()
await call('POST', '/api/review/comments/put', { ws, source, comments: kept.filter(c => c.id !== comment.id) })

// 6. Old data: an item sent to a Duet conversation reads as ended; a saved turn view is refused; the routes are gone.
const threads = JSON.parse(threadsNow())
threads.push({ id: 't-old', target: 'C', targetLabel: 'C', revision: 1, state: 'open', created: Date.now(), items: [{ id: 'i-old', who: 'person', text: '옛 대화로 보낸 말', ts: Date.now(), sessionId: 's-gone', messageId: 'm-old' }] })
writeFileSync(threadsFile, JSON.stringify(threads))
const read = await call('GET', `/api/canvas/${name}?ws=${W}`)
check('an item sent to a Duet conversation reads as ended', read.deliveries['i-old']?.state === 'ended', JSON.stringify(read.deliveries['i-old']))
r = await raw('POST', '/api/review/diff', { ws, source: { kind: 'turn', sessionId: 's-gone' } })
check('a saved turn view is refused with 410', r.status === 410, `${r.status} ${JSON.stringify(r.body)}`)
const gone = [await raw('GET', `/api/sessions?ws=${W}`), await raw('POST', '/api/sessions', { ws }), await raw('GET', `/api/claude-sessions?ws=${W}`)]
check('the conversation routes are gone', gone.every(g => g.status === 404), gone.map(g => g.status).join())
const health = await call('GET', '/api/health')
check('health counts what terminals have not finished', health.running === 0, JSON.stringify(health))

await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
