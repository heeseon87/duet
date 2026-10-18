// Decisions on the canvas: pins on what each decision shaped (open and made), a pin picks its decision and
// lights its parts, a folded package carries its children's pins, the card's links frame the parts, made
// decisions sit one per line and open in full, the bar's chip counts them, a choice sent to a busy agent shows
// where it stands (대기열 → 작업 중 → 답함) and keeps its tags, and an old revision offers no choosing.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=<scratch repo> DUET_SHOTS=/dir node e2e/decisions.mjs   (runs one Haiku conversation)
import { execFileSync } from 'node:child_process'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_SHOTS: shots } = process.env
if (!T || !ws) { console.error('DUET_TOKEN and DUET_WS are required'); process.exit(2) }
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
const name = 'decisions-e2e'
const gitStatus = () => execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' })

await call('POST', '/api/workspaces', { path: ws })
if ((await call('GET', `/api/canvas?ws=${W}`)).some(m => m.name === name)) await call('DELETE', `/api/canvas/${name}?ws=${W}`)
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '결정 시험 지도' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: '시험 지도', patch: {
  elements: [
    { id: 'ingest', kind: 'group' },
    { id: 'render', kind: 'group' },
    { id: 'Resolver', parent: 'ingest', decision: 'D1', option: 'D1-a' },
    { id: 'Fetcher', parent: 'ingest', decision: 'D1', option: 'D1-b' },
    { id: 'Queue', parent: 'ingest' },
    { id: 'Encoder', parent: 'render', decision: 'D2', option: 'D2-a' },
    { id: 'Packer', parent: 'render', decision: 'D2', option: 'D2-b' },
    { id: 'Uploader', parent: 'render' },
    { id: 'Store', kind: 'resource' },
  ],
  relations: [
    { from: 'Queue', to: 'Resolver', label: 'resolve' },
    { from: 'Queue', to: 'Fetcher', label: 'fetch' },
    { from: 'Resolver', to: 'Encoder', label: 'source', decision: 'D1', option: 'D1-a' },
    { from: 'Encoder', to: 'Uploader', label: 'clip' },
    { from: 'Packer', to: 'Uploader', label: 'pack' },
    { from: 'Uploader', to: 'Store', label: 'put' },
  ],
  decisions: [
    { id: 'D1', question: '원본 영상을 어디서 가져올까?', options: [{ id: 'D1-a', text: '이벤트 경로에서 바로 푼다' }, { id: 'D1-b', text: '따로 내려받는다' }] },
    { id: 'D2', question: '썸네일은 어떻게 만들까?', options: [{ id: 'D2-a', text: '인코더 하나로 만든다', impact: '단계가 하나라 빠르다' }, { id: 'D2-b', text: '여러 장을 묶어서 만든다', rejected: '묶는 단계가 느리다' }] },
    { id: 'D3', question: '실패하면 다시 시도할까?', options: [{ id: 'D3-a', text: '한 번 더 한다' }, { id: 'D3-b', text: '바로 끝낸다' }] },
  ],
} })
await call('POST', `/api/canvas/${name}/choose`, { ws, decision: 'D2', option: 'D2-a', rationale: '단계가 적어서' })
const s = await call('POST', '/api/sessions', { ws, model: process.env.DUET_MODEL ?? 'claude-haiku-5-5', permissionMode: 'bypassPermissions' })
const treeBefore = gitStatus()

const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940 })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/decisions-${n}.png` }) }
await page.evaluate(([w, m, id]) => {
  localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.removeItem(`duet.canvas.collapsed:${w}:${m}`)
  localStorage.removeItem('duet.canvas.explore'); localStorage.setItem(`duet.session:${w}`, id); localStorage.setItem('duet.sideOpen', '0')
}, [ws, name, s.id])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-canvas svg .cv-cluster', { timeout: 20000 }); await sleep(1200)
await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(700)

const pinsOf = id => page.$$eval(`.stage-inner > svg [data-target="${id}"]:is(.cv-node, .cv-cluster) > .cv-pins .cv-pin`, ps => ps.map(p => `${p.getAttribute('data-pin')}:${p.classList.contains('open') ? 'open' : p.classList.contains('made') ? 'made' : '?'}`))
const pins = { Resolver: await pinsOf('Resolver'), Fetcher: await pinsOf('Fetcher'), Encoder: await pinsOf('Encoder'), Queue: await pinsOf('Queue'), Uploader: await pinsOf('Uploader') }
check('pins: open D1 on its two boxes, made D2 on the kept one, none on untagged boxes',
  pins.Resolver.join() === 'D1:open' && pins.Fetcher.join() === 'D1:open' && pins.Encoder.join() === 'D2:made' && !pins.Queue.length && !pins.Uploader.length, JSON.stringify(pins))
const looks = await page.evaluate(() => {
  const fill = sel => { const r = document.querySelector(sel); return r ? getComputedStyle(r).fill : null }
  return { open: fill('.cv-pin.open rect'), made: fill('.cv-pin.made rect'), packer: Boolean(document.querySelector('.stage-inner > svg [data-target="Packer"]')) }
})
check('open and made pins are drawn differently; the lost option is gone', looks.open && looks.made && looks.open !== looks.made && !looks.packer, JSON.stringify(looks))
const chip = () => page.$eval('.canvas-bar .dec-chip', b => ({ text: b.textContent.trim(), accent: b.classList.contains('accent') })).catch(() => null)
const chip1 = await chip()
check('the bar counts decisions: 결정 1/3, accent while some are open', chip1?.text === '결정 1/3' && chip1.accent, JSON.stringify(chip1))
await shot('pins')

// A pin picks its decision: what it shaped stays lit, the rest steps back.
const pinAt = await page.$eval('.stage-inner > svg [data-target="Resolver"] .cv-pin[data-pin="D1"] rect', r => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
await page.mouse.click(pinAt.x, pinAt.y); await sleep(500)
const lit = await page.evaluate(() => {
  const svg = document.querySelector('.stage-inner > svg')
  const cls = id => [...(svg.querySelector(`[data-target="${id}"]:is(.cv-node, .cv-cluster)`)?.classList ?? [])].filter(c => /^cv-(sel|in|rel|ctx|dim)$/.test(c)).join(' ')
  const op = id => Number(getComputedStyle(svg.querySelector(`.cv-node[data-target="${id}"]`)).opacity)
  return { Resolver: cls('Resolver'), Fetcher: cls('Fetcher'), Store: cls('Store'), Uploader: cls('Uploader'), opResolver: op('Resolver'), opStore: op('Store'), card: document.querySelector('.inspector')?.textContent ?? '' }
})
check('a pin click selects the decision and the info card shows it', lit.card.includes('D1') && lit.card.includes('원본 영상을 어디서 가져올까?') && !lit.card.includes('결정할 것'), lit.card.slice(0, 80))
check('its tagged parts stay lit while the rest dims', lit.Resolver === 'cv-sel' && lit.Fetcher === 'cv-sel' && lit.Store === 'cv-dim' && lit.Uploader === 'cv-dim' && lit.opResolver === 1 && lit.opStore < 1, JSON.stringify(lit, (k, v) => (k === 'card' ? undefined : v)))
await shot('pin-selected')

// Folded, a package carries the pins of what is inside it, once each, and stands lit for them.
await page.click('button:has-text("Collapse all")'); await sleep(1300)
const folded = { ingest: await pinsOf('ingest'), render: await pinsOf('render'), litIngest: await page.$eval('.stage-inner > svg .cv-node[data-target="ingest"]', n => n.classList.contains('cv-sel')) }
check('a folded package shows its children\'s pins, deduplicated', folded.ingest.join() === 'D1:open' && folded.render.join() === 'D2:made' && folded.litIngest, JSON.stringify(folded))
await shot('folded')
await page.click('button:has-text("Expand all")'); await sleep(1300)

// The card's id frames the parts: zoom far away first, then follow the link.
await page.keyboard.press('Escape'); await sleep(200)
for (let i = 0; i < 8; i++) await page.keyboard.press('=')
await sleep(500)
await page.mouse.move(400, 500); await page.mouse.down(); await page.mouse.move(1400, 900, { steps: 8 }); await page.mouse.up(); await sleep(300)
await page.keyboard.press('i'); await sleep(400)
const d3 = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.inspector .decision.open')].find(c => c.textContent.includes('D3'))
  return card ? { link: Boolean(card.querySelector('button.decision-id')), counts: card.querySelectorAll('.option-count').length } : null
})
check('an untagged decision shows no map link', d3 && !d3.link && d3.counts === 0, JSON.stringify(d3))
const inView = ids => page.evaluate(ids => {
  const stage = document.querySelector('.stage-canvas').getBoundingClientRect()
  const insp = document.querySelector('.inspector')?.getBoundingClientRect()
  const right = insp ? insp.left : stage.right
  return ids.map(id => { const r = document.querySelector(`.stage-inner > svg .cv-node[data-target="${id}"]`)?.getBoundingClientRect(); return Boolean(r && r.left >= stage.left - 1 && r.right <= right + 1 && r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1) })
}, ids)
const before = await inView(['Resolver', 'Fetcher'])
await page.click('.inspector .decision.open button.decision-id:has-text("D1")'); await sleep(900)
const after = await inView(['Resolver', 'Fetcher'])
const picked = await page.$eval('.inspector', e => e.textContent.includes('원본 영상을 어디서 가져올까?') && !e.textContent.includes('결정할 것'))
check('the card\'s id link frames the decision\'s parts and selects it', !before.every(Boolean) && after.every(Boolean) && picked, JSON.stringify({ before, after, picked }))
await page.keyboard.press('Escape'); await page.keyboard.press('f'); await sleep(600)
await page.keyboard.press('i'); await sleep(400)
await page.click('.inspector .decision.open:has-text("D1") .option-count >> nth=0'); await sleep(900)
check('an option\'s part count frames that option\'s parts', (await inView(['Resolver']))[0] && (await page.$eval('.stage-inner > svg .cv-node[data-target="Resolver"]', n => n.classList.contains('cv-sel'))))
await page.keyboard.press('Escape'); await sleep(200)

// Made decisions: one line each, opening in full.
await page.click('.canvas-bar .dec-chip'); await sleep(700)
const rows = await page.$$eval('.inspector .made-list .made', ms => ms.map(m => { const r = m.querySelector('.made-row'); const t = r.querySelector('.made-text'); return { id: m.getAttribute('data-decision'), h: Math.round(r.getBoundingClientRect().height), oneLine: t.scrollHeight <= t.clientHeight + 1, text: r.textContent } }))
check('the chip opens the info card on the decisions; a made one is one line', rows.length === 1 && rows[0].id === 'D2' && rows[0].h <= 32 && rows[0].oneLine && rows[0].text.includes('→'), JSON.stringify(rows))
await page.click('.inspector .made[data-decision="D2"] .made-row'); await sleep(300)
const full = await page.$eval('.inspector .made[data-decision="D2"]', m => ({ q: Boolean(m.querySelector('.decision-q')), why: m.querySelector('.decision-why')?.textContent ?? '', lost: m.querySelector('.option-rejected')?.textContent ?? '', reopen: Boolean(m.querySelector('.reopen')) }))
check('opened: question, pick, reason, the lost option and why, reopen', full.q && full.why.includes('단계가 적어서') && full.lost.includes('묶는 단계가 느리다') && full.reopen, JSON.stringify(full))
await shot('made-open')
await page.click('.inspector .made[data-decision="D2"] button[title="한 줄로 접기"]'); await sleep(200)

// Choosing D1 with the agent told, while the agent is busy: the decision shows where it stands.
await call('POST', `/api/sessions/${s.id}/messages`, { text: 'Run `sleep 20` with Bash, then reply with the one word "done". From then on, answer every message in this conversation with one short sentence and use no tools at all.' })
for (let i = 0; i < 120; i++) {
  await sleep(500)
  const log = (await call('GET', `/api/sessions/${s.id}`)).log
  if (log.some(e => e.kind === 'sdk' && e.msg.type === 'assistant' && (e.msg.message?.content ?? []).some(c => c.type === 'tool_use' && c.name === 'Bash'))) break
}
await sleep(1500)
const pinD1 = await page.$eval('.stage-inner > svg [data-target="Resolver"] .cv-pin[data-pin="D1"] rect', r => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
await page.mouse.click(pinD1.x, pinD1.y); await sleep(400)
await page.click('.inspector .decision.open .option.pickable >> nth=0'); await sleep(200)
check('choosing offers the agent notice, on by default', await page.$eval('.decide-form .toggle input', i => i.checked))
const revBefore = (await call('GET', `/api/canvas/${name}?ws=${W}`)).revision
await page.click('.decide-form button:has-text("a로 결정")')
const seen = []
const ui = { side: false, toast: false }
const t0 = Date.now()
while (Date.now() - t0 < 180_000) {
  const now = await page.evaluate(() => ({
    text: document.querySelector('.inspector .made[data-decision="D1"] .delivery')?.textContent,
    side: Boolean(document.querySelector('.side')),
    toast: [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('결정을 보냈어')),
  }))
  ui.side ||= now.side; ui.toast ||= now.toast
  if (now.text && seen[seen.length - 1] !== now.text) seen.push(now.text)
  if (now.text?.startsWith('답함') || now.text?.startsWith('끝남')) break
  await sleep(200)
}
const at = p => seen.findIndex(t => t.startsWith(p))
check('the decision shows 대기열, then 작업 중, then 답함', at('대기열') >= 0 && at('작업 중') > at('대기열') && at('답함') > at('작업 중'), seen.join(' → '))
check('sending opens the agent panel and says so', ui.side && ui.toast, JSON.stringify(ui))
await shot('answered')
const saved = await call('GET', `/api/canvas/${name}?ws=${W}`)
const thread = saved.threads.find(t => t.target === 'D1')
check('the answer landed on the decision\'s thread', thread?.items[0]?.who === 'person' && thread.items[0].text.startsWith('a로 정함') && thread.items.some(i => i.who === 'agent'), JSON.stringify(thread?.items.map(i => `${i.who}: ${i.text.slice(0, 30)}`)))
const el = id => saved.map.elements.find(e => e.id === id)
const rel = saved.map.relations.find(r => r.from === 'Resolver' && r.to === 'Encoder')
check('the saved map keeps the chosen option\'s tags and drops the other option',
  saved.map.decisions.find(d => d.id === 'D1')?.chosen === 'D1-a' && el('Resolver')?.decision === 'D1' && el('Resolver')?.option === 'D1-a' && !el('Fetcher') && rel?.decision === 'D1' && rel?.option === 'D1-a' && el('Encoder')?.option === 'D2-a',
  JSON.stringify({ Resolver: el('Resolver'), Fetcher: el('Fetcher') ?? null, rel }))
const chip2 = await chip()
check('the chip now reads 결정 2/3', chip2?.text === '결정 2/3' && chip2.accent, JSON.stringify(chip2))

// An old revision is only looked at: no choosing, no reopening.
await page.keyboard.press('Escape'); await sleep(200)
await page.click('.rev-chip'); await sleep(300)
await page.click(`.timeline .tl-item:has(b:text-is("rev ${revBefore}")) .tl-main`); await sleep(1500)
await page.waitForSelector('.preview-banner')
const oldPin = await page.$eval('.stage-inner > svg [data-target="Resolver"] .cv-pin[data-pin="D1"]', p => { const b = p.querySelector('rect').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, open: p.classList.contains('open') } })
await page.mouse.click(oldPin.x, oldPin.y); await sleep(400)
await page.click('.inspector .decision.open .option >> nth=0'); await sleep(300)
const ro = await page.evaluate(() => ({
  pickable: document.querySelectorAll('.inspector .option.pickable').length,
  form: Boolean(document.querySelector('.decide-form')),
  decide: [...document.querySelectorAll('.inspector button')].some(b => b.textContent.includes('로 결정')),
}))
await page.keyboard.press('Escape'); await page.keyboard.press('i'); await sleep(300)
await page.click('.inspector .made[data-decision="D2"] .made-row').catch(() => {}); await sleep(200)
const reopen = await page.$('.inspector .reopen')
check('in an old-rev preview there is no decide button and no reopen', oldPin.open && !ro.pickable && !ro.form && !ro.decide && !reopen, JSON.stringify({ ...ro, reopen: Boolean(reopen) }))
await page.click('.preview-banner button:has-text("최신으로")'); await sleep(300)

check('the agent left the scratch repo as it was', gitStatus() === treeBefore)
await call('DELETE', `/api/sessions/${s.id}`)
if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
