// Shared helpers for driving Duet in a headless browser (screens and flows).
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Playwright's own browser if installed, else any chromium build already in the cache. */
function executable() {
  if (process.env.DUET_CHROMIUM) return process.env.DUET_CHROMIUM
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return undefined
  const shells = readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
  for (const d of shells) {
    for (const sub of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = join(cache, d, sub)
      if (existsSync(p)) return p
    }
  }
  return undefined
}

export async function open({ port = 7981, token, ws, width = 1480, height = 920, appDefaults = false } = {}) {
  let browser
  try {
    browser = await chromium.launch()
  } catch {
    browser = await chromium.launch({ executablePath: executable() })
  }
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  // The canvas opens with the code pane; the scripts were written against it off, so they start there unless they
  // set it (or ask for the app's own defaults).
  if (!appDefaults) await page.addInitScript(() => { try { if (localStorage.getItem('duet.canvas.code') === null) localStorage.setItem('duet.canvas.code', '0') } catch {} })
  await page.goto(`http://127.0.0.1:${port}/?t=${token}${ws ? `&ws=${encodeURIComponent(ws)}` : ''}`, { waitUntil: 'domcontentloaded' })
  return { browser, page, errors }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Folds or unfolds this package with the button on its frame's top right corner. */
export async function toggleFold(page, id) {
  await page.click(`.stage-fold[data-group="${id}"]`, { timeout: 3000 })
}

/**
 * A stand-in for a Claude Code terminal running the Duet mod: it registers in `ws`, keeps polling so the server
 * keeps it, and finishes each message Duet sends it (with `answer(message)`'s text as its answer, when given),
 * `workMs` after starting on it. `got` holds what arrived; `hold()` keeps the next message unfinished until `release()`.
 */
export async function fakeTerminal({ port = 7981, token, ws, id = `e2e-${Date.now().toString(36)}`, label = 'e2e', answer, workMs = 0 } = {}) {
  const H = { 'x-duet-token': token, 'content-type': 'application/json' }
  const url = p => `http://127.0.0.1:${port}${p}`
  const post = (p, body) => fetch(url(p), { method: 'POST', headers: H, body: JSON.stringify(body) })
  const r = await post('/api/terminals', { id, workspace: ws, cwd: ws, label })
  if (!r.ok) throw new Error(`terminal register ${r.status} ${await r.text()}`)
  const got = []
  let on = true, hold = false, held
  const finish = async m => {
    await post(`/api/terminals/${id}/messages/${m.id}`, { state: 'working' })
    if (workMs) await sleep(workMs)
    await post(`/api/terminals/${id}/messages/${m.id}`, { state: 'done', answer: answer?.(m) })
  }
  const loop = (async () => {
    while (on) {
      const p = await fetch(url(`/api/terminals/${id}/poll?wait=1500`), { headers: H }).then(x => (x.ok ? x.json() : undefined)).catch(() => undefined)
      if (!on) break
      if (!p) { await sleep(300); continue }
      if (!p.message || p.message.id === held?.id) continue
      got.push(p.message)
      if (hold) held = p.message
      else await finish(p.message)
    }
  })()
  return {
    id, got,
    hold: () => { hold = true },
    release: async () => { hold = false; const m = held; held = undefined; if (m) await finish(m) },
    stop: async () => { on = false; await loop; await fetch(url(`/api/terminals/${id}`), { method: 'DELETE', headers: H }) },
  }
}
