// The way into the review: it opens on the tree the conversation works in, a chip in the top bar names that tree,
// "파일을 바꾼 마지막 턴" skips a later turn that changed nothing, and the commit a turn started on is a base to compare from.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace whose .gitignore hides worktrees/> DUET_NESTED=<clean git repo under it> node e2e/review-entry.mjs
//   With DUET_HOME (the server's) it also plays a turn older than the per-repo snapshots, by taking its record out of the log.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_NESTED: nested, DUET_HOME: home, DUET_SHOTS: shots } = process.env
const model = process.env.DUET_MODEL ?? 'claude-haiku-5-5'
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const git = (...args) => execFileSync('git', ['-C', nested, ...args]).toString().trim()

// 1. Turn 1 writes a file in the nested repo and commits it there; turn 2 changes nothing. One file stays uncommitted there.
const stamp = `E${Date.now().toString(36)}`
writeFileSync(`${nested}/src/Wip.kt`, 'class Wip\n')
const before = git('rev-parse', 'HEAD'), beforeSubject = git('log', '-1', '--format=%s')
await call('POST', '/api/workspaces', { path: ws })
const s = (await call('POST', '/api/sessions', { ws, model, permissionMode: 'bypassPermissions' })).body
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
await call('POST', `/api/sessions/${s.id}/messages`, { text: `Use the Write tool to create ${nested}/src/${stamp}.kt containing exactly: class ${stamp}\nThen use the Bash tool to run exactly: git -C ${nested} add src/${stamp}.kt && git -C ${nested} commit -q -m "add ${stamp}"\nRun no other tools. Reply with one word: done.` })
await settle(1)
await call('POST', `/api/sessions/${s.id}/messages`, { text: 'Reply with one word: ok. Use no tools.' })
const info = await settle(2)
check('the agent committed in the nested repo', git('log', '-1', '--format=%s') === `add ${stamp}` && git('rev-parse', 'HEAD~1') === before, git('log', '-2', '--format=%h %s').replace(/\n/g, ' | '))
check('the conversation works in the nested repo', info.workTree === nested, info.workTree)
const turns = (await call('GET', `/api/sessions/${s.id}/turns?root=${encodeURIComponent(nested)}`)).body
const brief = t => `${t.n}:${t.files}:${t.wrote}:${t.base?.sha.slice(0, 7) ?? '-'}`
check('turns seen from the repo: turn 1 changed a file there from the pre-turn commit, turn 2 nothing', turns.map(brief).join(' ') === `1:1:true:${before.slice(0, 7)} 2:0:false:-`, turns.map(brief).join(' '))
const fromWs = (await call('GET', `/api/sessions/${s.id}/turns?root=${encodeURIComponent(ws)}`)).body
check('seen from the workspace, neither turn changed anything', fromWs.map(brief).join(' ') === '1:0:false:- 2:0:false:-', fromWs.map(brief).join(' '))
const count = async root => (await call('POST', '/api/review/diff', { ws: root, source: { kind: 'working' } })).body.files.length
const [featCount, wsCount] = [await count(nested), await count(ws)]
const newest = (await call('GET', `/api/sessions?ws=${encodeURIComponent(ws)}`)).body[0]?.id

// 2. A fresh browser opens the review on the repo the conversation works in.
const { browser, page, errors } = await open({ port, token: T, ws })
const missing = []
page.on('response', r => { if (r.status() === 404) missing.push(new URL(r.url()).pathname) })
await page.waitForSelector('.source-bar .ref-pick', { timeout: 15000 }).catch(() => {})
await sleep(1500)
const state = () => page.evaluate(() => ({
  root: document.querySelector('.source-bar .ref-pick')?.textContent ?? '',
  other: Boolean(document.querySelector('.ref-pick.other-root')),
  kind: document.querySelector('.seg.kinds button[aria-pressed="true"]')?.textContent ?? '',
  turn: [...document.querySelectorAll('.source-bar .ref-pick')].map(e => e.textContent).find(t => t.startsWith('대화')) ?? '',
  base: [...document.querySelectorAll('.source-bar .ref-pick')].map(e => e.textContent).find(t => t.startsWith('base')) ?? '',
  files: [...document.querySelectorAll('.tree-row.file')].map(e => e.title),
  count: document.querySelectorAll('.tabs [role=tab]')[1]?.querySelector('.count')?.textContent ?? '',
  tabTitle: document.querySelectorAll('.tabs [role=tab]')[1]?.title ?? '',
  tab: document.querySelector('.tabs [role=tab][aria-selected="true"]')?.textContent ?? '',
}))
const fresh = await state()
check('with nothing remembered, the review opens on the repo the conversation works in', newest === s.id && fresh.other && fresh.root.includes('worktrees/feat'), `${newest === s.id} ${JSON.stringify(fresh.root)}`)
check("the review tab counts that repo's changes and its title says whose", featCount !== wsCount && fresh.count === String(featCount) && fresh.tabTitle.includes('worktrees/feat'), `${fresh.count} (repo ${featCount}, workspace ${wsCount}) · ${fresh.tabTitle}`)
if (shots) await page.screenshot({ path: `${shots}/entry-fresh.png` })

const toWorkspace = async () => {
  await page.click('.source-bar .ref-pick'); await sleep(200)
  await page.click('.popover .menu-item:has-text("작업 공간")'); await sleep(1200)
}

// 3. The chip names where the conversation works, and opens the review there.
const chip = await page.$eval('.work-chip', e => ({ name: e.querySelector('b')?.textContent, title: e.title })).catch(() => ({}))
check('the top bar has a chip naming the repo', chip.name === 'feat' && chip.title?.includes(nested) && chip.title.includes('이 대화가 일하는 저장소'), JSON.stringify(chip))
await toWorkspace()
await page.keyboard.press('Meta+1'); await sleep(800)
await page.click('.work-chip'); await sleep(1500)
const viaChip = await state()
check('the chip switches to the review on that repo', viaChip.tab.includes('리뷰') && viaChip.other && viaChip.root.includes('worktrees/feat'), JSON.stringify({ tab: viaChip.tab, root: viaChip.root }))

// 4. The palette's last turn goes to the repo, and to turn 1 (turn 2 changed nothing).
await toWorkspace()
await page.keyboard.press('Meta+k'); await sleep(300)
await page.keyboard.type('마지막 턴'); await sleep(300)
const item = await page.$eval('.palette .menu-item[data-active="true"]', e => e.textContent).catch(() => '')
await page.keyboard.press('Enter'); await sleep(2000)
const viaPalette = await state()
check('palette "파일을 바꾼 마지막 턴" opens turn 1 in the repo, not turn 2', item.includes('파일을 바꾼 마지막 턴') && viaPalette.other && viaPalette.kind.includes('Turns') && viaPalette.turn.includes('턴 1') && viaPalette.files.join(' ') === `src/${stamp}.kt`, `${item} · ${JSON.stringify({ turn: viaPalette.turn, files: viaPalette.files })}`)
if (shots) await page.screenshot({ path: `${shots}/entry-turn.png` })

// 5. Branch compare from the commit turn 1 started on: the committed file shows, which the working changes miss.
await page.click('.seg.kinds button:has-text("Compare")'); await sleep(1200)
await page.click('.source-bar .ref-pick:has-text("base")'); await sleep(800)
const listed = await page.$$eval('.popover .menu-item', es => es.map(e => e.textContent))
const label = await page.$eval('.popover .menu-label', e => e.textContent).catch(() => '')
const row = listed.find(t => t.startsWith('턴 1 시작 직전'))
check('the base picker lists the commit turn 1 started on', label === '이 대화의 턴 시작 직전' && row?.includes(before.slice(0, 7)) && row.includes(beforeSubject) && !listed.some(t => t.startsWith('턴 2')), `${label} · ${row}`)
if (shots) await page.screenshot({ path: `${shots}/entry-base.png` })
await page.click('.popover .menu-item:has-text("턴 1 시작 직전")'); await sleep(1500)
const fromBase = await state()
check("picking it compares from there: the turn's committed file shows", fromBase.base.includes(`턴 1 직전 · ${before.slice(0, 7)}`) && fromBase.files.includes(`src/${stamp}.kt`), JSON.stringify({ base: fromBase.base, files: fromBase.files }))
const working = (await call('POST', '/api/review/diff', { ws: nested, source: { kind: 'working' } })).body.files.map(f => f.path)
check('(the working changes alone miss it)', !working.includes(`src/${stamp}.kt`), working.join(' '))

// 6. A pick of the workspace for this conversation outlives a reload.
await toWorkspace()
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500)
const reloaded = await state()
check('the workspace picked for this conversation is still under review after a reload', !reloaded.other && reloaded.root.length > 0, reloaded.root)

// 7. A turn older than the per-repo snapshots: no record of the repo, so the commit it started on stands in.
if (home) {
  const lastTurn = async () => {
    await page.keyboard.press('Meta+k'); await sleep(300)
    await page.keyboard.type('마지막 턴'); await sleep(300)
    await page.keyboard.press('Enter'); await sleep(1500)
  }
  await lastTurn()
  const path = `${home}/sessions/${s.id}.jsonl`
  const t1 = turns[0].turnId
  const lines = readFileSync(path, 'utf8').split('\n').map(l => {
    if (!l.includes('"turn-end"') || !l.includes(t1)) return l
    const e = JSON.parse(l)
    delete e.repos
    if (e.summary) delete e.summary.repos
    return JSON.stringify(e)
  })
  writeFileSync(path, lines.join('\n'))
  const old = (await call('GET', `/api/sessions/${s.id}/turns?root=${encodeURIComponent(nested)}`)).body
  check('without a record, turn 1 counts no files there but still wrote there', old.map(brief).join(' ') === `1:undefined:true:${before.slice(0, 7)} 2:0:false:-`, old.map(brief).join(' '))
  const [mark, seen] = [errors.length, missing.length]
  await page.click('.source-bar .iconbtn[title^="Refresh"]'); await sleep(1500)
  const button = await page.$eval('.empty .btn.primary', e => e.textContent).catch(() => '')
  const said = await page.$eval('.empty p', e => e.textContent).catch(() => '')
  const answered = missing.slice(seen)
  check('that turn now says it has no record here (the diff answers 404), and offers its start commit', said.includes('턴 1에는 이 저장소의 변경 기록이 없어') && button === '턴 1 시작 직전 커밋부터 지금까지 보기' && answered.join() === '/api/review/diff', `${said} · ${button} · ${answered.join()}`)
  // That 404 is the answer the check above wants, not a page error.
  errors.splice(mark, errors.length - mark, ...errors.slice(mark).filter(e => !/status of 404/.test(e)))
  if (shots) await page.screenshot({ path: `${shots}/entry-norecord.png` })
  await page.click('.empty .btn.primary'); await sleep(1200)
  const offered = await state()
  const toast1 = await page.$$eval('.toast', es => es.map(e => e.textContent).join(' | '))
  check('the offer opens the compare from that commit, said to be an estimate', offered.kind.includes('Compare') && offered.base.includes(`턴 1 직전 · ${before.slice(0, 7)}`) && offered.files.includes(`src/${stamp}.kt`) && toast1.includes('추정'), `${JSON.stringify({ kind: offered.kind, base: offered.base })} · ${toast1}`)
  await page.click('.seg.kinds button:has-text("Changes")'); await sleep(3500)
  await lastTurn()
  const est = await state()
  const toast2 = await page.$$eval('.toast', es => es.map(e => e.textContent).join(' | '))
  check('palette: the last turn with no record opens the same compare, said to be an estimate', est.kind.includes('Compare') && est.base.includes(`턴 1 직전 · ${before.slice(0, 7)}`) && toast2.includes('추정'), `${JSON.stringify({ kind: est.kind, base: est.base })} · ${toast2}`)
}

if (errors.length) { failed++; console.log('page errors', errors, missing) }
await browser.close()
process.exit(failed ? 1 : 0)
