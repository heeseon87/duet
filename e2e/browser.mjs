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

export async function open({ port = 7981, token, ws, width = 1480, height = 920, theme = 'light', appDefaults = false } = {}) {
  let browser
  try {
    browser = await chromium.launch()
  } catch {
    browser = await chromium.launch({ executablePath: executable() })
  }
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.addInitScript(t => { try { localStorage.setItem('duet.theme', t) } catch {} }, theme)
  // The canvas opens in explore mode with the code pane; the scripts were written against both off, so they start
  // there unless they set them (or ask for the app's own defaults).
  if (!appDefaults) await page.addInitScript(() => { try { for (const k of ['duet.canvas.explore', 'duet.canvas.code']) if (localStorage.getItem(k) === null) localStorage.setItem(k, '0') } catch {} })
  await page.goto(`http://127.0.0.1:${port}/?t=${token}${ws ? `&ws=${encodeURIComponent(ws)}` : ''}`, { waitUntil: 'domcontentloaded' })
  return { browser, page, errors }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Folds or unfolds this package with the button on its frame's top right corner. */
export async function toggleFold(page, id) {
  await page.click(`.stage-fold[data-group="${id}"]`, { timeout: 3000 })
}
