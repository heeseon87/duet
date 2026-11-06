// Syntax highlighting with shiki: tokens per line, colored with the palette's light theme (CSS reads --shiki-light),
// languages loaded on first use.

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

/** Languages where `@Name` marks an annotation or a decorator. */
const ANNOTATED = new Set(['java', 'kotlin', 'groovy', 'scala', 'typescript', 'tsx', 'javascript', 'jsx', 'python', 'swift', 'dart'])
/** IntelliJ Light's annotation yellow, whatever the palette. */
export const ANNOTATION_STYLE = '--shiki-light:#9E880D'
/**
 * A theme that only tells strings and comments from the rest, run beside the palette so an `@` inside them is
 * left alone. Grammar scopes alone won't do: Kotlin's marks `val name: String` after `@field:NotBlank` as annotation.
 */
const MASK = 'duet-mask'
const MASKED = '#000001'
const maskTheme = {
  name: MASK, type: 'dark', colors: { 'editor.foreground': '#000000', 'editor.background': '#ffffff' },
  tokenColors: [{ scope: ['comment', 'string', 'meta.jsx.children'], settings: { foreground: MASKED } }],
}
// `@Name`, `@a.b.Name`, Kotlin's `@field:Name`; not `this@Outer`, `return@forEach` or Java's `@interface`.
const ANNOTATION_RE = /(?<![\w$@.])@(?!interface\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?::[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?/g

/** One line's tokens with every annotation outside strings and comments cut out and painted in its yellow. */
export function markAnnotations(line: (Token & { masked?: boolean })[]): Token[] {
  const plainLine = () => line.map(({ content, style }) => ({ content, style }))
  const text = line.map(t => t.content).join('')
  if (!text.includes('@')) return plainLine()
  const starts: number[] = []
  let at = 0
  for (const t of line) { starts.push(at); at += t.content.length }
  const ranges: [number, number][] = []
  for (const m of text.matchAll(ANNOTATION_RE)) {
    let k = 0
    while (k + 1 < line.length && starts[k + 1] <= m.index) k++
    if (!line[k].masked) ranges.push([m.index, m.index + m[0].length])
  }
  if (!ranges.length) return plainLine()
  const out: Token[] = []
  line.forEach((t, k) => {
    const end = starts[k] + t.content.length
    let cur = starts[k]
    for (const [a, b] of ranges) {
      if (b <= cur || a >= end) continue
      if (a > cur) out.push({ content: text.slice(cur, a), style: t.style })
      const stop = Math.min(b, end)
      out.push({ content: text.slice(Math.max(a, cur), stop), style: ANNOTATION_STYLE })
      cur = stop
    }
    if (cur < end) out.push({ content: text.slice(cur, end), style: t.style })
  })
  return out
}

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', kt: 'kotlin', py: 'python', yml: 'yaml', console: 'bash', text: 'text', plaintext: 'text', diff: 'diff' }

/** Code color palettes: the shiki theme each one colors the code with on Duet's light paper. */
export const PALETTES: { id: string; label: string; light: string }[] = [
  { id: 'github', label: 'GitHub', light: 'github-light' },
  { id: 'vitesse', label: 'Vitesse', light: 'vitesse-light' },
  { id: 'one', label: 'One', light: 'one-light' },
  { id: 'catppuccin', label: 'Catppuccin', light: 'catppuccin-latte' },
  { id: 'rose-pine', label: 'Rosé Pine', light: 'rose-pine-dawn' },
  { id: 'solarized', label: 'Solarized', light: 'solarized-light' },
  { id: 'everforest', label: 'Everforest', light: 'everforest-light' },
  { id: 'kanagawa', label: 'Kanagawa', light: 'kanagawa-lotus' },
  { id: 'gruvbox', label: 'Gruvbox', light: 'gruvbox-light-medium' },
  { id: 'material', label: 'Material', light: 'material-theme-lighter' },
  { id: 'night-owl', label: 'Night Owl', light: 'night-owl-light' },
  { id: 'ayu', label: 'Ayu', light: 'ayu-light' },
  { id: 'vscode', label: 'VS Code', light: 'light-plus' },
  { id: 'min', label: 'Min', light: 'min-light' },
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
      themes: [bundledThemes['github-light']().then(t => { loadedThemes.add((t as { default: { name: string } }).default.name); return t })],
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
  await ensureTheme(h, pal.light)
  const annotated = ANNOTATED.has(lang) && code.includes('@')
  if (annotated && !loadedThemes.has(MASK)) { await h.loadTheme(maskTheme as never); loadedThemes.add(MASK) }
  let tokens: ThemedToken[][]
  try {
    tokens = h.codeToTokens(code, { lang, themes: { light: pal.light, ...(annotated ? { mask: MASK } : {}) }, defaultColor: false }).tokens
  } catch {
    return plain(code)
  }
  const out: TokenLines = annotated
    ? tokens.map(line => markAnnotations(line.map(t => ({ content: t.content, style: styleOf(t), masked: (t.htmlStyle as Record<string, string> | undefined)?.['--shiki-mask']?.toLowerCase() === MASKED }))))
    : tokens.map(line => line.map(t => ({ content: t.content, style: styleOf(t) })))
  if (cache.size > 300) cache.delete(cache.keys().next().value as string)
  cache.set(key, out)
  return out
}

function styleOf(t: ThemedToken): string | undefined {
  const s = t.htmlStyle as Record<string, string> | undefined
  if (!s) return undefined
  return Object.entries(s).filter(([k]) => !k.startsWith('--shiki-mask')).map(([k, v]) => `${k}:${v}`).join(';')
}
