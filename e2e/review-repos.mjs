// A conversation that writes code in another repo (an ignored worktree under the workspace): each turn
// snapshots that repo, the review offers it, and the turn's link opens its changes there.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace whose .gitignore hides worktrees/> DUET_NESTED=<git repo under it, with src/A.kt saying "hello"> node e2e/review-repos.mjs
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

// 1. A turn that edits one file and writes another, both in the nested repo.
await call('POST', '/api/workspaces', { path: ws })
const s = (await call('POST', '/api/sessions', { ws, model, permissionMode: 'acceptEdits' })).body
await call('POST', `/api/sessions/${s.id}/messages`, { text: `Use the Edit tool on ${nested}/src/A.kt to change "hello" inside the quotes to "world". Then use the Write tool to create ${nested}/src/B.kt containing exactly: class B\nRun no other tools. Reply with one word: done.` })
const settle = async turns => {
  const t0 = Date.now()
  for (;;) {
    await sleep(1500)
    const i = (await call('GET', `/api/sessions?ws=${encodeURIComponent(ws)}`)).body.find(x => x.id === s.id)
    if (i.status === 'idle' && i.turns >= turns) return i
    if (i.status === 'waiting') { console.log('FAIL the turn asked for permission'); process.exit(1) }
    if (Date.now() - t0 > 180_000) { console.log('FAIL turn timeout', i.status); process.exit(1) }
  }
}
const info = await settle(1)
check('the session remembers the repo it wrote in', info.repos?.includes(nested), JSON.stringify(info.repos))
const log = (await call('GET', `/api/sessions/${s.id}`)).body.log
const end = log.filter(e => e.kind === 'turn-end').pop()
const rec = end?.repos?.find(r => r.path === nested)
const rs = end?.summary?.repos?.find(r => r.path === nested)
check('the turn kept before/after trees of that repo', Boolean(rec?.before && rec?.after && rec.before !== rec.after), JSON.stringify(rec))
check('the turn summary counts the change there', rs?.files === 2 && end.summary.changes.files >= 2, JSON.stringify(end?.summary?.changes) + ' ' + JSON.stringify(rs))

// 2. The review: the repo is offered, and its working changes and the turn's changes show.
const repos = (await call('GET', `/api/review/repos?ws=${encodeURIComponent(ws)}`)).body
const repo = repos.find(r => r.path === nested)
check('the review lists the repo with its place and branch', repo?.label === 'worktrees/feat' && repo?.branch === 'feat' && repo.sessions.includes(s.id), JSON.stringify(repo))
const paths = d => d.files.map(f => `${f.status}:${f.path}`).sort().join(' ')
const working = (await call('POST', '/api/review/diff', { ws: nested, source: { kind: 'working' } })).body
check('working changes of the repo', paths(working) === 'modified:src/A.kt untracked:src/B.kt', paths(working))
const turn = (await call('POST', '/api/review/diff', { ws: nested, source: { kind: 'turn', sessionId: s.id, turnId: end.turnId } })).body
check("the turn's changes in the repo", paths(turn) === 'added:src/B.kt modified:src/A.kt', paths(turn))
const outer = (await call('POST', '/api/review/diff', { ws, source: { kind: 'working' } })).body
check('the workspace itself does not see them (ignored)', !outer.files.some(f => f.path.includes('A.kt')), paths(outer))
const stranger = await call('POST', '/api/review/diff', { ws: '/tmp', source: { kind: 'working' } })
check('a folder no conversation wrote in is refused', stranger.status === 403, String(stranger.status))

// 3. In the browser: the hint, the picker, and the turn's link. The conversation works in the repo, so the
// workspace is picked for it to start there.
const { browser, page, errors } = await open({ port, token: T, ws })
await page.evaluate(([w, id]) => { localStorage.setItem('duet.tab', 'review'); localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem(`duet.review.root:${w}:${id}`, w); localStorage.removeItem(`duet.review.repoHint:${w}`); localStorage.setItem('duet.sideOpen', '1') }, [ws, s.id])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.repo-hint', { timeout: 15000 }).catch(() => {})
const hint = await page.$eval('.repo-hint', e => e.textContent).catch(() => '')
check('on the workspace, a hint points at the repo', hint.includes('worktrees/feat'), hint)
if (shots) await page.screenshot({ path: `${shots}/repo-hint.png` })
await page.click('.repo-hint .btn'); await sleep(1500)
const shown = await page.evaluate(() => ({ pick: document.querySelector('.ref-pick.other-root')?.textContent, files: [...document.querySelectorAll('.tree-row.file')].map(e => e.textContent.trim()), branch: document.querySelector('.branch')?.textContent }))
check("the top bar keeps the workspace's own branch", shown.branch === 'main', shown.branch)
check('one click reviews the repo: the picker names it, its files list', shown.pick?.includes('worktrees/feat') && shown.files.some(f => f.includes('A.kt')) && shown.files.some(f => f.includes('B.kt')), JSON.stringify(shown))
if (shots) await page.screenshot({ path: `${shots}/repo-review.png` })
// Back to the workspace, then the turn's link in the conversation opens the repo again, on that turn.
await page.click('.ref-pick.other-root'); await sleep(200)
await page.click('.popover .menu-item:has-text("작업 공간")'); await sleep(1200)
const back = await page.evaluate(() => !document.querySelector('.ref-pick.other-root'))
const link = await page.waitForSelector('.turn-foot .link-btn', { timeout: 10000 }).catch(() => null)
const linkText = link ? await link.textContent() : ''
await link?.click(); await sleep(1800)
const viaTurn = await page.evaluate(() => ({ pick: document.querySelector('.ref-pick.other-root')?.textContent, kind: document.querySelector('.seg.kinds button[aria-pressed="true"]')?.textContent, files: [...document.querySelectorAll('.tree-row.file')].map(e => e.textContent.trim()) }))
check("the turn's link (files counted across repos) opens the repo on that turn", back && /파일 2개/.test(linkText) && viaTurn.pick?.includes('worktrees/feat') && viaTurn.kind?.includes('Turns') && viaTurn.files.length === 2, `${linkText} · ${JSON.stringify(viaTurn)}`)
// A path in the conversation (relative to the workspace) opens that file in the repo under review.
await page.click('.tree-row.file:has-text("B.kt")'); await sleep(300)
await page.click('code.path:has-text("worktrees/feat/src/A.kt")'); await sleep(600)
const opened = await page.$eval('.tree-row.file.on', e => e.textContent).catch(() => '')
check("a workspace path from the conversation opens the file in the repo", opened.includes('A.kt') && Boolean(await page.$('.ref-pick.other-root')), opened)

// A turn that writes in both: its link opens where it wrote more (here, the repo: 2 files to 1).
await call('POST', `/api/sessions/${s.id}/messages`, { text: `Use the Write tool to create ${ws}/notes/log.md containing exactly: run ${Date.now()}\nUse the Write tool to create ${nested}/src/C.kt containing exactly: class C\nUse the Edit tool on ${nested}/src/B.kt to change "class B" to "class B2". Run no other tools. Reply with one word: done.` })
await settle(2)
await page.click('.ref-pick.other-root'); await sleep(200)
await page.click('.popover .menu-item:has-text("작업 공간")'); await sleep(1200)
await sleep(1500)
const links = await page.$$('.turn-foot .link-btn')
const last = links[links.length - 1]
const lastText = last ? await last.textContent() : ''
await last?.click(); await sleep(1800)
const mixed = await page.evaluate(() => ({ pick: document.querySelector('.ref-pick.other-root')?.textContent, files: [...document.querySelectorAll('.tree-row.file')].map(e => e.textContent.trim()) }))
check('a turn that wrote in both opens where it wrote more', /파일 3개/.test(lastText) && mixed.pick?.includes('worktrees/feat') && mixed.files.length === 2 && mixed.files.some(f => f.includes('C.kt')), `${lastText} · ${JSON.stringify(mixed)}`)

// Remembered: a reload comes back to the repo.
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500)
check('the repo under review is remembered', Boolean(await page.$('.ref-pick.other-root')))
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
