// A comment, a reply or a closed thread adds no revision: the map stays drawn as it is, with no new Mermaid render
// (each one ran Mermaid and ELK over the whole map again). A new revision still redraws once.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<workspace> node e2e/comment-redraw.mjs
//   (makes and removes a map named redraw-check)
import { fakeTerminal, open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
const W = encodeURIComponent(ws)
const name = 'redraw-check'
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-duet-token': T, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label, extra) }

await call('POST', '/api/workspaces', { path: ws })
await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '다시 그리기 시험 지도' })
const parts = ['Controller', 'Request', 'Service', 'HostCheck', 'MemberCheck', 'MemberRepo', 'GroupRepo', 'Group', 'Member', 'Role', 'Type', 'Pay']
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [{ id: 'api', kind: 'group' }, { id: 'domain', kind: 'group' }, ...parts.map((id, i) => ({ id, parent: i < 7 ? 'api' : 'domain', members: ['+id: Long', '+run(): Unit'] }))],
  relations: parts.slice(1).map((id, i) => ({ from: parts[i], to: id, kind: 'dependency', label: `call${i}()`, step: i + 1 })),
} })

const term = await fakeTerminal({ port, token: T, ws })
const { browser, page, errors } = await open({ port, token: T, ws })
try {
  await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m) }, [ws, name])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.stage-inner > svg', { timeout: 15000 })
  await sleep(1500)
  // Every drawing replaces the stage's svg; count those, with when each landed.
  await page.evaluate(() => {
    window.__draws = []
    new MutationObserver(ms => { if (ms.some(m => [...m.addedNodes].some(n => n.nodeName === 'svg'))) window.__draws.push(performance.now()) })
      .observe(document.querySelector('.stage-inner'), { childList: true })
  })
  const draws = () => page.evaluate(() => window.__draws.length)
  const t0 = await page.evaluate(() => performance.now())

  const { thread } = await call('POST', `/api/canvas/${name}/comment`, { ws, target: 'Service', text: '여기 왜 두 번 불러?', terminalId: term.id })
  await sleep(2500)
  await call('POST', `/api/canvas/${name}/threads/${thread.id}`, { ws, state: 'resolved' })
  await sleep(1500)
  check('a comment, its delivery and a closed thread leave the drawing as it is', (await draws()) === 0, `draws ${await draws()}`)

  await call('POST', `/api/canvas/${name}/patch`, { ws, note: '하나 더', patch: { elements: [{ id: 'Audit', parent: 'domain' }], relations: [{ from: 'Service', to: 'Audit' }] } })
  await sleep(2500)
  const n = await draws()
  const took = await page.evaluate(t => window.__draws.map(x => Math.round(x - t)), t0)
  check('a new revision redraws it once', n === 1, `draws ${n} at ${took.join(', ')} ms`)

  // Comparing with the previous revision draws its ghosts once; a comment then keeps them as they are.
  await page.click('.map-head-tools button[title="Compare with previous"]')
  await sleep(2000)
  const compared = await draws()
  const ghosts = await page.evaluate(() => document.querySelectorAll('.stage-inner > svg .cv-node.cv-new').length)
  await call('POST', `/api/canvas/${name}/comment`, { ws, target: 'Audit', text: '이건 왜 생겼어?', terminalId: term.id })
  await sleep(2500)
  const after = await draws()
  const still = await page.evaluate(() => document.querySelectorAll('.stage-inner > svg .cv-node.cv-new').length)
  check('a comment while comparing keeps the compared drawing', compared === n + 1 && after === compared && ghosts > 0 && still === ghosts, `draws ${n}→${compared}→${after}, new marks ${ghosts}→${still}`)
  check('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  await term.stop()
  await call('DELETE', `/api/canvas/${name}?ws=${W}`).catch(() => {})
}
process.exit(failed ? 1 : 0)
