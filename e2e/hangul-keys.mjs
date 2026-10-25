// Letter shortcuts work with the Korean input source: the key arrives as its jamo ("ㅓ" for j) and is read by the key
// pressed. The events are dispatched (a real IME cannot be driven headless), with the key and code Chrome reports.
//   DUET_PORT=7981 DUET_TOKEN=... DUET_WS=... DUET_MAP=<class map> node e2e/hangul-keys.mjs
//   (the review of DUET_WS needs two changed files or more)
import { open, sleep } from './browser.mjs'
const port = Number(process.env.DUET_PORT ?? 7979)
const { DUET_TOKEN: T, DUET_WS: ws, DUET_MAP: mapName } = process.env
const { browser, page, errors } = await open({ port, token: T, ws })
let failed = 0
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra) }
await page.evaluate(([w, m]) => { localStorage.setItem('duet.tab', 'canvas'); localStorage.setItem(`duet.canvas.current:${w}`, m); localStorage.setItem('duet.sideOpen', '1'); localStorage.setItem('duet.canvas.code', '0') }, [ws, mapName])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stage-inner > svg .cv-node', { timeout: 20000 }); await sleep(800)
const press = (key, code, o = {}, target = 'body') => page.evaluate(([key, code, o, target]) => document.querySelector(target).dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...o })), [key, code, o, target])

const inspector = () => page.$('.inspector').then(Boolean)
const before = await inspector()
await press('ㅑ', 'KeyI'); await sleep(300)
check('ㅑ toggles the info card like i', (await inspector()) !== before)
const codeOn = () => page.$eval('.canvas-bar button[title^="코드 칸"]', b => b.getAttribute('aria-pressed') === 'true')
await press('ㅊ', 'KeyC'); await sleep(500)
check('ㅊ turns the code pane on like c', await codeOn())
await press('ㅊ', 'KeyC'); await sleep(500)
check('and off again', !(await codeOn()))
await press('ㅏ', 'KeyK', { metaKey: true }); await sleep(400)
check('⌘ㅏ opens the palette like ⌘K', Boolean(await page.$('.palette')))
await page.keyboard.press('Escape'); await sleep(300)

await page.keyboard.press('Meta+2'); await page.waitForSelector('.review-nav .tree-row.file', { timeout: 15000 }); await sleep(800)
const selected = () => page.$eval('.review-nav .tree-row.file.on', r => r.title).catch(() => '')
const first = await selected()
await press('ㅓ', 'KeyJ'); await sleep(300)
const next = await selected()
check('ㅓ moves to the next file like j', Boolean(first && next && next !== first), `${first} → ${next}`)
// While composing in a text field the key arrives as "Process": typing is left alone.
const box = (await page.$('.composer textarea')) ? '.composer textarea' : undefined
if (box) {
  await press('Process', 'KeyK', {}, box); await sleep(300)
  check('typing in the composer does not move the review', (await selected()) === next)
} else console.log('SKIP no composer to type in')
await press('ㅏ', 'KeyK'); await sleep(300)
check('ㅏ moves back like k', (await selected()) === first)

if (errors.length) { failed++; console.log('page errors', errors) }
await browser.close()
process.exit(failed ? 1 : 0)
