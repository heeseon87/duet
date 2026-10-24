// Syntax highlighting with shiki: tokens per line, colored for both themes at once
// (CSS picks --shiki-light or --shiki-dark), languages loaded on first use.

import type { HighlighterCore, ThemedToken } from 'shiki/core'

export type Token = { content: string; style?: string }
export type TokenLines = Token[][]

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  kt: 'kotlin', kts: 'kotlin', java: 'java', swift: 'swift', go: 'go', rs: 'rust', py: 'python', rb: 'ruby',
  json: 'json', jsonc: 'jsonc', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
  md: 'markdown', mdx: 'mdx', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', gradle: 'groovy', groovy: 'groovy',
  dockerfile: 'dockerfile', properties: 'properties', graphql: 'graphql', proto: 'proto', vue: 'vue', svelte: 'svelte',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', hh: 'cpp', hxx: 'cpp', cs: 'csharp', mts: 'typescript', cts: 'typescript', pyi: 'python', php: 'php', lua: 'lua', ini: 'ini', mmd: 'mermaid',
}

export function langOf(path: string): string | undefined {
  const base = path.split('/').pop() ?? ''
  if (/^Dockerfile/i.test(base)) return 'dockerfile'
  if (/^Jenkinsfile/.test(base)) return 'groovy'
  if (base === 'Makefile') return 'make'
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return EXT[ext]
}

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', kt: 'kotlin', py: 'python', yml: 'yaml', console: 'bash', text: 'text', plaintext: 'text', diff: 'diff' }

/** Code color palettes: a light and a dark theme each, so the page's own light/dark switch keeps working. */
export const PALETTES: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'github', label: 'GitHub', light: 'github-light', dark: 'github-dark-dimmed' },
  { id: 'vitesse', label: 'Vitesse', light: 'vitesse-light', dark: 'vitesse-dark' },
  { id: 'one', label: 'One', light: 'one-light', dark: 'one-dark-pro' },
  { id: 'catppuccin', label: 'Catppuccin', light: 'catppuccin-latte', dark: 'catppuccin-mocha' },
  { id: 'rose-pine', label: 'Rosé Pine', light: 'rose-pine-dawn', dark: 'rose-pine-moon' },
  { id: 'solarized', label: 'Solarized', light: 'solarized-light', dark: 'solarized-dark' },
  { id: 'everforest', label: 'Everforest', light: 'everforest-light', dark: 'everforest-dark' },
  { id: 'kanagawa', label: 'Kanagawa', light: 'kanagawa-lotus', dark: 'kanagawa-wave' },
  { id: 'gruvbox', label: 'Gruvbox', light: 'gruvbox-light-medium', dark: 'gruvbox-dark-medium' },
  { id: 'material', label: 'Material', light: 'material-theme-lighter', dark: 'material-theme-palenight' },
  { id: 'night-owl', label: 'Night Owl', light: 'night-owl-light', dark: 'night-owl' },
  { id: 'ayu', label: 'Ayu', light: 'ayu-light', dark: 'ayu-dark' },
  { id: 'vscode', label: 'VS Code', light: 'light-plus', dark: 'dark-plus' },
  { id: 'min', label: 'Min', light: 'min-light', dark: 'min-dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', light: 'github-light', dark: 'tokyo-night' },
  { id: 'nord', label: 'Nord', light: 'min-light', dark: 'nord' },
  { id: 'dracula', label: 'Dracula', light: 'github-light', dark: 'dracula' },
  { id: 'monokai', label: 'Monokai', light: 'snazzy-light', dark: 'monokai' },
]

let palette = PALETTES[0]
export function setPalette(id: string) {
  palette = PALETTES.find(p => p.id === id) ?? PALETTES[0]
}

let core: Promise<HighlighterCore> | undefined
const loadedThemes = new Set<string>()

async function ensureTheme(h: HighlighterCore, name: string) {
  if (loadedThemes.has(name)) return
  const { bundledThemes } = await import('shiki/themes')
  const loader = (bundledThemes as Record<string, () => Promise<unknown>>)[name]
  if (loader) await h.loadTheme(loader as never)
  loadedThemes.add(name)
}
const loaded = new Set<string>()
const failed = new Set<string>()

async function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { bundledThemes }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes'),
    ])
    return createHighlighterCore({
      themes: [bundledThemes['github-light'](), bundledThemes['github-dark-dimmed']()].map(p => p.then(t => { loadedThemes.add((t as { default: { name: string } }).default.name); return t })),
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return core
}

async function ensureLang(h: HighlighterCore, lang: string): Promise<boolean> {
  if (loaded.has(lang)) return true
  if (failed.has(lang)) return false
  try {
    const { bundledLanguages } = await import('shiki/langs')
    const loader = (bundledLanguages as Record<string, () => Promise<unknown>>)[lang]
    if (!loader) { failed.add(lang); return false }
    await h.loadLanguage(loader as never)
    loaded.add(lang)
    return true
  } catch {
    failed.add(lang)
    return false
  }
}

const cache = new Map<string, TokenLines>()

function plain(code: string): TokenLines {
  return code.split('\n').map(l => [{ content: l }])
}

/** Highlights whole text and returns one token list per line. Falls back to plain text. */
export async function highlight(code: string, langOrPath: string | undefined): Promise<TokenLines> {
  let lang = langOrPath ? (langOrPath.includes('.') || langOrPath.includes('/') ? langOf(langOrPath) : (ALIASES[langOrPath] ?? langOrPath)) : undefined
  if (!lang || lang === 'text' || code.length > 400_000) return plain(code)
  const key = `${palette.id}\0${lang}\0${code.length}\0${code.slice(0, 200)}\0${code.slice(-200)}`
  const hit = cache.get(key)
  if (hit) return hit
  const h = await highlighter()
  if (!(await ensureLang(h, lang))) return plain(code)
  const pal = palette
  await Promise.all([ensureTheme(h, pal.light), ensureTheme(h, pal.dark)])
  let tokens: ThemedToken[][]
  try {
    tokens = h.codeToTokens(code, { lang, themes: { light: pal.light, dark: pal.dark }, defaultColor: false }).tokens
  } catch {
    return plain(code)
  }
  const out: TokenLines = tokens.map(line => line.map(t => ({ content: t.content, style: styleOf(t) })))
  if (cache.size > 300) cache.delete(cache.keys().next().value as string)
  cache.set(key, out)
  return out
}

function styleOf(t: ThemedToken): string | undefined {
  const s = t.htmlStyle as Record<string, string> | undefined
  if (!s) return undefined
  return Object.entries(s).map(([k, v]) => `${k}:${v}`).join(';')
}
