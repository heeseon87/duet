// Variable colors in the code pane: the palette button (Kotlin, Java, TypeScript files only) paints each variable one
// color from its declaration to every use, scope by scope, leaving members after a dot alone, a class's properties
// underlined apart from locals, and the rest of the code (keywords, types, strings) goes gray; it is remembered, follows
// the file the pane shows, and turning it off clears the colors. The grammars load on first use, as wasm.
//   DUET_PORT=7981 DUET_TOKEN=... [DUET_SCRATCH=<folder>] DUET_SHOTS=/dir node e2e/code-vars.mjs
//   (makes a repo under DUET_SCRATCH, else the temp folder, opens it as a workspace and leaves it there.)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_SHOTS: shots } = process.env
if (!T) { console.error('DUET_TOKEN is required'); process.exit(2) }
const H = { 'x-duet-token': T, 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : undefined
}
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const until = async (what, ms = 10000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await what(); if (v) return v; await sleep(150) } return v }

const ws = join(realpathSync(mkdtempSync(join(process.env.DUET_SCRATCH ?? tmpdir(), 'code-vars-'))), 'ws')
const git = (...a) => execFileSync('git', ['-c', 'user.email=t@duet', '-c', 'user.name=t', ...a], { cwd: ws }).toString().trim()
mkdirSync(join(ws, 'src'), { recursive: true })
writeFileSync(join(ws, 'src/Svc.kt'), [
  'package demo', '',
  'class Svc(private val repo: Repo) {',
  '    fun run(order: Order, n: Int): Int {',
  '        val lines = order.lines',
  '        var sum = 0',
  '        for (line in lines) sum += line.price',
  '        repo.save(order)',
  '        return sum + n',
  '    }',
  '}', '',
].join('\n'))
writeFileSync(join(ws, 'src/Svc.java'), [
  'class Svc {',
  '    int run(Order order, int n) {',
  '        var lines = order.lines;',
  '        return lines.size() + n;',
  '    }',
  '}', '',
].join('\n'))
writeFileSync(join(ws, 'src/svc.ts'), [
  'export function run(order: Order, n: number) {',
  '  const lines = order.lines',
  '  return lines.length + n',
  '}', '',
].join('\n'))
writeFileSync(join(ws, 'src/notes.py'), 'def run(order):\n    return order\n')
git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'first')
await call('POST', '/api/workspaces', { path: ws })

const name = 'code-vars'
await call('POST', '/api/canvas', { ws, name, diagram: 'class', title: '변수 색 시험' })
await call('POST', `/api/canvas/${name}/patch`, { ws, note: 'm', patch: {
  elements: [{ id: 'Kt', files: ['src/Svc.kt'] }, { id: 'Jv', files: ['src/Svc.java'] }, { id: 'Ts', files: ['src/svc.ts'] }, { id: 'Py', files: ['src/notes.py'] }],
  relations: [{ from: 'Kt', to: 'Jv' }, { from: 'Jv', to: 'Ts' }, { from: 'Ts', to: 'Py' }],
} })

// Left to its defaults the canvas opens in explore mode with the code on: a pick shows the box's file.
const { browser, page, errors } = await open({ port, token: T, ws, width: 1500, height: 940, appDefaults: true })
const shot = async n => { if (shots) await page.screenshot({ path: `${shots}/code-vars-${n}.png` }) }
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m) }, [ws, name])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target]', { state: 'attached', timeout: 15000 }); await sleep(800)
const pick = async (id, file) => {
  await page.click(`.stage-inner > svg .cv-node[data-target="${id}"]`)
  await until(() => page.$eval('.code-pane .code-pane-path .file-path', e => e.getAttribute('title') === file).catch(() => false))
  await sleep(300)
}
const button = () => page.$('.code-pane-head button[title^="변수 색"]')
/** Every painted identifier: its text, line and color. */
const painted = () => page.evaluate(() => {
  const out = []
  for (let i = 0; i < 8; i++) for (const field of [false, true]) for (const r of CSS.highlights.get(`duet-var-${i}${field ? '-f' : ''}`) ?? []) out.push({ text: r.toString(), line: Number(r.startContainer.parentElement?.closest('tr')?.dataset.line), color: i, field })
  return out
})
/** Whether the `fun` keyword on line 4 is gray (the rest of the code muted while variables are colored). */
const keywordGray = () => page.evaluate(() => {
  const span = [...document.querySelectorAll('.code-pane tr[data-line="4"] td.code span')].find(s => s.textContent === 'fun')
  // The color may come back as oklch(…): paint it to read it as pixels.
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.fillStyle = getComputedStyle(span).color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return Math.max(r, g, b) - Math.min(r, g, b) <= 3
})
const colorsOf = (marks, text) => new Set(marks.filter(m => m.text === text).map(m => m.color))
const linesOf = (marks, text) => marks.filter(m => m.text === text).map(m => m.line)

await pick('Kt', 'src/Svc.kt')
check('a Kotlin file has the palette button, off at first, and nothing painted', Boolean(await button()) && (await (await button()).getAttribute('aria-pressed')) === 'false' && !(await painted()).length)
await (await button()).click()
let kt = await until(async () => { const m = await painted(); return m.length ? m : undefined })
check('turning it on paints the variables once the grammar loads', Boolean(kt?.length), JSON.stringify(kt?.slice(0, 4)))
kt ??= []
check('the rest of the code goes gray, keeping its shade', await keywordGray())
check('a parameter keeps one color from its declaration to every use', JSON.stringify(linesOf(kt, 'order')) === '[4,5,8]' && colorsOf(kt, 'order').size === 1, JSON.stringify(linesOf(kt, 'order')))
check('…so do a local and a class property', JSON.stringify(linesOf(kt, 'lines')) === '[5,7]' && colorsOf(kt, 'lines').size === 1 && JSON.stringify(linesOf(kt, 'repo')) === '[3,8]' && colorsOf(kt, 'repo').size === 1)
check('variables in sight of each other differ', new Set(['order', 'n', 'lines', 'sum', 'repo'].map(v => [...colorsOf(kt, v)][0])).size === 5)
check('a class property is underlined at its declaration and its uses; parameters and locals are not', kt.filter(m => m.text === 'repo').every(m => m.field) && !kt.some(m => ['order', 'n', 'lines', 'sum', 'line'].includes(m.text) && m.field))
check('members after a dot and functions are left alone', !kt.some(m => ['price', 'save', 'run', 'Order'].includes(m.text)) && linesOf(kt, 'lines').filter(l => l === 5).length === 1)
const shown = await page.evaluate(() => {
  const h = CSS.highlights.get('duet-var-0') ?? CSS.highlights.get('duet-var-0-f'), r = h ? [...h][0] : undefined
  const probe = document.createElement('span'); probe.style.color = 'var(--var-0)'; document.body.appendChild(probe); const want = getComputedStyle(probe).color; probe.remove()
  return { has: Boolean(r), want }
})
check('the colors are defined', shown.has && shown.want !== '', JSON.stringify(shown))
await shot('kotlin')

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg [data-target]', { state: 'attached' }); await sleep(800)
await pick('Kt', 'src/Svc.kt')
check('it is remembered', (await (await button())?.getAttribute('aria-pressed')) === 'true' && Boolean((await until(async () => (await painted()).length)) ))

await pick('Jv', 'src/Svc.java')
const jv = await until(async () => { const m = await painted(); return linesOf(m, 'order').length ? m : undefined }) ?? []
check('it follows the file: Java', JSON.stringify(linesOf(jv, 'order')) === '[2,3]' && colorsOf(jv, 'order').size === 1 && JSON.stringify(linesOf(jv, 'lines')) === '[3,4]', JSON.stringify(jv))
await pick('Ts', 'src/svc.ts')
const ts = await until(async () => { const m = await painted(); return linesOf(m, 'order').length && linesOf(m, 'lines').includes(3) ? m : undefined }) ?? []
check('…and TypeScript', JSON.stringify(linesOf(ts, 'order')) === '[1,2]' && JSON.stringify(linesOf(ts, 'lines')) === '[2,3]' && colorsOf(ts, 'n').size === 1, JSON.stringify(ts))
await shot('typescript')
await pick('Py', 'src/notes.py')
check('a language without colors has no button and nothing painted', !(await button()) && !(await painted()).length)

await pick('Kt', 'src/Svc.kt')
await until(async () => (await painted()).length)
await (await button()).click(); await sleep(300)
check('turning it off clears the colors and brings the theme back', !(await painted()).length && (await (await button()).getAttribute('aria-pressed')) === 'false' && !(await keywordGray()))

check('no page errors', !errors.length, errors.join(' | '))
await browser.close()
await call('DELETE', `/api/canvas/${name}?ws=${encodeURIComponent(ws)}`)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
