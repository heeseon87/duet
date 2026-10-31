// The composer floats over the map while the agent panel is folded: one box at a time, one draft across fold and
// unfold (a draft set once is not taken again on the next mount), it makes way for decision mode (the rail's 결정),
// keeps clear of the zoom bar as the window narrows, and can be put away: it stays away through a reload and the panel
// opening and closing, and ⌘L brings it back to be typed in. With DUET_WAIT=1 one Haiku turn asks for an approval (ask
// mode, a shell command that writes stamp.txt, never approved): the box says so and leads to the panel.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<a scratch repo with README.md> DUET_SHOTS=/dir node e2e/float-composer.mjs
//   (makes and removes a map named float-composer and a conversation)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const name = 'float-composer'
const W = encodeURIComponent(ws)
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}

await call('POST', '/api/workspaces', { path: ws })
await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '떠 있는 입력창 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [{ id: 'api', kind: 'group' }, { id: 'Ctl', parent: 'api', decision: 'D1' }, { id: 'Svc', parent: 'api' }],
  relations: [{ from: 'Ctl', to: 'Svc', label: 'create' }],
  decisions: [{ id: 'D1', question: 'URL을 어떤 모양으로 할까?', why: { tags: ['convention'], text: '관례가 둘이야.' },
    options: [{ id: 'D1-a', text: 'POST /groups' }, { id: 'D1-b', text: 'POST /users/{id}/groups' }] }],
} })
const session = await call('POST', '/api/sessions', { ws, model: process.env.DUET_MODEL ?? 'claude-haiku-5-5', permissionMode: 'default' })

const { browser, page, errors } = await open({ port, token: T, ws })
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }
await page.evaluate(([w, id, n]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem('duet.sideOpen', '1')
  localStorage.setItem(`duet.canvas.current:${w}`, n); localStorage.removeItem('duet.float.hidden')
}, [ws, session.id, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node', { timeout: 20000 }); await sleep(800)

const composers = () => page.$$eval('.composer', a => a.length)
const value = sel => page.$eval(sel, e => e.value).catch(() => null)
const fold = async () => { await page.keyboard.press('Meta+3'); await sleep(400) }
const clear = () => page.evaluate(() => {
  const f = document.querySelector('.float-composer')?.getBoundingClientRect(), z = document.querySelector('.zoom-bar')?.getBoundingClientRect()
  if (!f || !z) return { ok: false }
  const raised = document.querySelector('.float-composer').classList.contains('raised')
  return { ok: raised ? f.bottom <= z.top : f.right <= z.left, raised, right: Math.round(f.right), bottom: Math.round(f.bottom), zLeft: Math.round(z.left), zTop: Math.round(z.top) }
})

// 1. A draft set once (a suggestion goes through setDraft) is not taken again by the next box that mounts.
await page.click('.suggestions button'); await sleep(300)
check('a suggestion fills the panel\'s box', (await value('.side .composer textarea'))?.length > 10)
await page.fill('.side .composer textarea', '')
await fold()
check('folded, the box floats over the map, the only one', Boolean(await page.$('.canvas-main .float-composer')) && await composers() === 1)
check('the cleared draft does not come back in it', await value('.float-composer textarea') === '', await value('.float-composer textarea'))
await fold()
check('nor in the panel when it opens again', await value('.side .composer textarea') === '' && !(await page.$('.float-composer')))

// 2. One draft across the two places.
await fold()
await page.fill('.float-composer textarea', '접어 둔 채 쓴 말')
await fold()
check('what is typed folded is in the panel once it opens', await value('.side .composer textarea') === '접어 둔 채 쓴 말' && await composers() === 1)
await fold()
check('and back in the floating box', await value('.float-composer textarea') === '접어 둔 채 쓴 말')
await page.fill('.float-composer textarea', '')
check('the head names Claude', (await page.$eval('.float-head .float-who', e => e.textContent)) === 'Claude')
if (shots) await page.screenshot({ path: `${shots}/float-composer.png` })

// 3. The rail's 결정 opens decision mode; the box makes way, esc brings it back.
check('the rail\'s 결정 counts the open decision', (await page.$eval('.rail-btn.rail-decide .badge', e => e.textContent).catch(() => '')) === '1')
await page.click('.rail-btn.rail-decide'); await sleep(500)
check('it opens decision mode, without the box', Boolean(await page.$('.decide')) && !(await page.$('.float-composer')))
await page.keyboard.press('Escape'); await sleep(400)
check('esc closes the mode and the box is back', !(await page.$('.decide')) && Boolean(await page.$('.float-composer')))

// 4. Clear of the zoom bar: wide, and in a narrow window.
let c = await clear()
check('beside the zoom bar', c.ok && !c.raised, JSON.stringify(c))
await page.setViewportSize({ width: 620, height: 800 }); await sleep(500)
c = await clear()
check('a narrow window puts it above the zoom bar', c.ok && c.raised, JSON.stringify(c))
await page.setViewportSize({ width: 1480, height: 920 }); await sleep(500)

// 5. @ offers files above the box, inside the window.
await page.type('.float-composer textarea', '@READ'); await sleep(800)
const menu = await page.evaluate(() => { const m = document.querySelector('.float-composer .slash-menu')?.getBoundingClientRect(); return m && { top: m.top, bottom: m.bottom } })
const box = await page.$eval('.float-composer', e => e.getBoundingClientRect().top)
check('@ opens the file menu upward, in the window', Boolean(menu) && menu.top >= 0 && menu.bottom <= box + 60, JSON.stringify(menu))
await page.fill('.float-composer textarea', '')

// 6. Put away: gone, and it stays so through a reload and the panel opening and closing; ⌘L brings it back, focused.
await page.click('.float-head button[title^="입력창 숨기기"]'); await sleep(300)
check('the hide button puts the box away', !(await page.$('.float-composer')) && await composers() === 0)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node', { timeout: 20000 }); await sleep(800)
check('it stays away after a reload', !(await page.$('.float-composer')))
await fold(); await fold()
check('and after the panel opens and closes', !(await page.$('.float-composer')) && !(await page.$('.side')))
await page.keyboard.press('Meta+l'); await sleep(400)
check('⌘L brings it back, ready to type in', Boolean(await page.$('.float-composer')) && await page.evaluate(() => document.activeElement === document.querySelector('.float-composer textarea')))

// 7. A wait shows in the head and leads to the panel, where the card is.
if (process.env.DUET_WAIT === '1') {
  await call('POST', `/api/sessions/${session.id}/messages`, { text: 'Run exactly this shell command with the Bash tool: date > stamp.txt. Then reply "done".' })
  let wait = null
  for (let i = 0; i < 60 && !wait; i++) { await sleep(1000); wait = await page.$eval('.float-said.wait', e => e.textContent).catch(() => null) }
  check('an approval shows in the head', wait === '승인 1개 · 보기', String(wait))
  if (shots) await page.screenshot({ path: `${shots}/float-composer-wait.png` })
  if (wait) {
    await page.click('.float-said.wait'); await sleep(600)
    check('a click opens the panel on the card', Boolean(await page.$('.side .perm-card')) && !(await page.$('.float-composer')))
  }
  await call('POST', `/api/sessions/${session.id}/interrupt`).catch(() => {})
  await sleep(1000)
}

await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
await call('DELETE', `/api/sessions/${session.id}`).catch(() => {})
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
