// What the person is looking at goes along with what they type: the review on screen (even of another repo) or the
// open map shows as a chip in the composer, rides along on send, can be dismissed for that view, and stays off built-in commands.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace whose .gitignore hides worktrees/> DUET_NESTED=<git repo under it with uncommitted .kt files> node e2e/view-chips.mjs
//   (runs three short Haiku turns and a /compact; makes and removes a map named view-chips)
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_NESTED: nested, DUET_SHOTS: shots } = process.env
const model = process.env.DUET_MODEL ?? 'claude-haiku-5-5'
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }

// A map whose box points into the nested repo: it names the map chip, and makes the repo reviewable from the workspace.
const mapName = 'view-chips', title = 'View chip 지도'
await call('POST', '/api/workspaces', { path: ws })
await call('DELETE', `/api/canvas/${mapName}?ws=${encodeURIComponent(ws)}`)
await call('POST', '/api/canvas', { ws, name: mapName, diagram: 'class', title })
await call('POST', `/api/canvas/${mapName}/patch`, { ws, note: 'e2e', patch: { elements: [{ id: 'Worker', label: '썸네일 워커', files: [`${nested.slice(ws.length + 1)}/src/A.kt`] }, { id: 'Job' }], relations: [{ from: 'Worker', to: 'Job' }] } })
const s = (await call('POST', '/api/sessions', { ws, model, permissionMode: 'bypassPermissions' })).body
const featFiles = (await call('POST', '/api/review/diff', { ws: nested, source: { kind: 'working' } })).body.files.map(f => f.path)
const wsFiles = (await call('POST', '/api/review/diff', { ws, source: { kind: 'working' } })).body.files.map(f => f.path)
const only = featFiles.filter(f => !wsFiles.includes(f))

const info = async () => (await call('GET', `/api/sessions?ws=${encodeURIComponent(ws)}`)).body.find(x => x.id === s.id)
const settle = async turns => {
  const t0 = Date.now()
  for (;;) {
    await sleep(1500)
    const i = await info()
    if (i.status === 'idle' && i.turns >= turns) return i
    if (i.status === 'waiting') { console.log('FAIL the turn asked for permission'); process.exit(1) }
    if (Date.now() - t0 > 180_000) { console.log('FAIL turn timeout', i.status); process.exit(1) }
  }
}
const users = async () => (await call('GET', `/api/sessions/${s.id}`)).body.log.filter(e => e.kind === 'user')
const views = e => (e?.context ?? []).filter(c => c.kind === 'review-view' || c.kind === 'map-view')
/** What the agent read, from Claude Code's own transcript of the conversation. */
const prompts = async () => {
  const id = (await info()).claudeId
  const root = join(homedir(), '.claude/projects')
  const file = readdirSync(root).map(d => join(root, d, `${id}.jsonl`)).find(existsSync)
  if (!file) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type === 'user' && !e.isMeta)
    .map(e => (typeof e.message.content === 'string' ? e.message.content : e.message.content.map(c => c.text ?? '').join('')))
}

const { browser, page, errors } = await open({ port, token: T, ws })
await page.evaluate(([w, id, n, m]) => {
  localStorage.setItem('duet.tab', 'review'); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem('duet.focus', '0')
  localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem(`duet.review.root:${w}:${id}`, n)
  localStorage.setItem(`duet.review.source:${n}`, JSON.stringify({ kind: 'working' })); localStorage.setItem(`duet.canvas.current:${w}`, m)
}, [ws, s.id, nested, mapName])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.composer .chip.view', { timeout: 20000 }).catch(() => {})
const chip = () => page.$eval('.composer .chip.view', e => e.textContent).catch(() => '')
const label = await chip()
const name = nested.split('/').pop()
check('on the review of the nested repo, the chip names it, Changes and the file count', label.startsWith(`리뷰: ${name} · Changes · 파일 ${featFiles.length}개`), label)
if (shots) await (await page.$('.composer')).screenshot({ path: `${shots}/view-chip-review.png` })

// 1. Sent along: the agent reads the repo, the command for its diff, and the files, and answers from that repo.
const say = async text => { await page.fill('.composer textarea', text); await page.press('.composer textarea', 'Enter') }
await say("list the files I'm looking at, names only")
const after1 = await settle(1)
const sent1 = (await users()).pop()
check('the message carries the review it was sent from', views(sent1).length === 1 && views(sent1)[0].root === nested && views(sent1)[0].files.length === featFiles.length, JSON.stringify(views(sent1)))
const read1 = (await prompts()).find(p => p.startsWith("list the files I'm looking at")) ?? ''
check('the agent reads the context block with git -C <repo> and the files', read1.includes('<context from Duet>') && read1.includes(`git -C ${nested} diff`) && featFiles.every(f => read1.includes(f)), read1.slice(0, 600))
const answer = (await call('GET', `/api/sessions/${s.id}`)).body.log.filter(e => e.kind === 'turn-end').pop()?.summary?.result ?? ''
check('the answer names a file only the nested repo has', only.some(f => answer.includes(f.split('/').pop())), `${JSON.stringify(only)} · ${answer.slice(0, 300)}`)
check('the sent message shows the chip like the others', Boolean(await page.$('.msg-user .ctx-chips .chip:has-text("리뷰:")')))

// 2. × takes it off for this view: a send then carries none, and it stays off; another source brings it back.
await page.click('.composer .chip.view button'); await sleep(200)
check('× removes the chip', !(await page.$('.composer .chip.view')))
await say('Reply with one word: ok. Use no tools.')
await settle(after1.turns + 1)
check('a send after × carries no view', views((await users()).pop()).length === 0)
check('sending keeps the dismissal for the same view', !(await page.$('.composer .chip.view')))
await page.click('.seg.kinds button:has-text("Compare")'); await sleep(1500)
const compared = await chip()
check('switching the source brings the chip back, for the new source', compared.includes('Working tree ←'), compared)
await page.click('.seg.kinds button:has-text("Changes")'); await sleep(1500)
check('back on Changes the chip is there too', (await chip()).includes('Changes'), await chip())

// 3. The canvas: the chip names the open map and what is selected; the agent is told to read it with canvas_read.
await page.click('.tabs [role=tab]:has-text("캔버스")')
await page.waitForSelector('.stage-inner > svg .cv-node[data-target="Worker"]', { timeout: 20000 }).catch(() => {})
await sleep(800)
check('on the canvas the chip names the map', (await chip()) === `지도: ${title}`, await chip())
const box = await page.$eval('.stage-inner > svg .cv-node[data-target="Worker"]', e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 } }).catch(() => null)
if (box) { await page.mouse.click(box.x, box.y); await sleep(400) }
check('a selected box joins the map chip', (await chip()) === `지도: ${title} · 썸네일 워커`, await chip())
if (shots) await (await page.$('.composer')).screenshot({ path: `${shots}/view-chip-map.png` })
await page.click('.composer .chip.view button'); await sleep(200)
check('× removes the map chip', !(await page.$('.composer .chip.view')))
await page.click('.tabs [role=tab]:has-text("리뷰")'); await sleep(800)
await page.click('.tabs [role=tab]:has-text("캔버스")'); await sleep(1200)
check('another tab and back brings it back', (await chip()).startsWith(`지도: ${title}`), await chip())
const before = (await info()).turns
await say('In one sentence, what is this map about? Use no tools.')
await settle(before + 1)
const read3 = (await prompts()).find(p => p.startsWith('In one sentence, what is this map about?')) ?? ''
check('the agent reads the map name, title and canvas_read', read3.includes(`canvas map "${mapName}"`) && read3.includes(title) && read3.includes('mcp__duet__canvas_read') && read3.includes('Worker (썸네일 워커)'), read3.slice(-400))

// 4. Built-in commands go alone: the chip steps aside while one is typed, and /compact carries no view.
await page.fill('.composer textarea', '/review medium'); await sleep(200)
check('a skill command keeps the chip', Boolean(await page.$('.composer .chip.view')))
await page.fill('.composer textarea', '/compact'); await sleep(200)
check('a built-in command hides it', !(await page.$('.composer .chip.view')))
await page.press('.composer textarea', 'Enter'); await sleep(300)
if (await page.inputValue('.composer textarea')) await page.press('.composer textarea', 'Enter')
const t0 = Date.now()
let compact
while (!compact && Date.now() - t0 < 20_000) { await sleep(500); compact = (await users()).find(e => e.text === '/compact') }
check('/compact is sent with no view', Boolean(compact) && views(compact).length === 0, JSON.stringify(compact?.context))
while (Date.now() - t0 < 150_000 && (await info()).status !== 'idle') await sleep(1500)

if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
await call('DELETE', `/api/canvas/${mapName}?ws=${encodeURIComponent(ws)}`)
process.exit(failed ? 1 : 0)
