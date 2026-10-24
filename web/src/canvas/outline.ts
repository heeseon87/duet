// The structure of a file for the code pane: its declarations (types, functions, members), read line by line and nested
// by indentation. No parser: formatted code nests by its indentation, and a function's body is not looked into.

import { langOf } from '../lib/highlight.ts'

export type SymbolKind =
  | 'namespace' | 'class' | 'struct' | 'interface' | 'enum' | 'object' | 'extension' | 'type' | 'table' | 'view'
  | 'function' | 'method' | 'constructor' | 'property' | 'param' | 'variable' | 'column' | 'heading'
/** A declaration: its name and kind, the lines it spans (1-based) and how deep it sits among the others. */
export type OutlineItem = { name: string; kind: SymbolKind; line: number; end: number; depth: number }

/** Kinds whose body holds members worth listing; any other declaration's body is not looked into. */
const CONTAINERS = new Set<SymbolKind>(['namespace', 'class', 'struct', 'interface', 'enum', 'object', 'extension', 'table'])

type Rule = {
  re: RegExp
  /** The kind, or a function deciding it from the match and the enclosing declaration (none at the top). */
  kind: SymbolKind | ((m: RegExpExecArray, parent?: OutlineItem) => SymbolKind | undefined)
  only?: 'top' | 'member'
  /** The name when the match has none (`constructor`, `companion object`). */
  name?: string
}
/**
 * How a language declares, comments and quotes; `keep` quotes names (Kotlin's backticks) rather than strings. Members a
 * constructor declares (`param`, with indices) are read from the parentheses that follow a declaration of a `header`
 * kind. `skip` lines are not code to nest by: preprocessor lines, C++ access labels.
 */
type Grammar = { rules: Rule[]; comment?: string; blocks: [string, string][]; quotes: string; keep?: string; header?: SymbolKind[]; param?: RegExp; skip?: RegExp }

const ID = '[A-Za-z_$][\\w$]*'
// `@field:JsonProperty("x")`: a use-site target may lead the name.
const ANNOT = '@(?:\\w+:)?[\\w.]+(?:\\((?:[^()]|\\([^()]*\\))*\\))?'
const mods = (words: string) => `^(?:(?:${ANNOT}|${words})\\s+)*`
const r = (s: string, flags = '') => new RegExp(s, flags)
const member = (inside: SymbolKind, outside: SymbolKind) => (_: RegExpExecArray, parent?: OutlineItem) => (parent ? inside : outside)

const KT = mods('public|private|protected|internal|open|final|abstract|sealed|data|enum|annotation|inner|value|inline|override|suspend|tailrec|operator|infix|external|lateinit|const|expect|actual')
const KOTLIN: Grammar = {
  comment: '//', blocks: [['/*', '*/'], ['"""', '"""']], quotes: `"'`, keep: '`',
  // The primary constructor's `val` and `var`; its plain parameters are not members.
  header: ['class', 'enum'], param: r(`${mods('public|private|protected|internal|override|open|final|vararg')}(?:val|var)\\s+(?<n>\`[^\`]+\`|${ID})`, 'd'),
  rules: [
    { re: r(`${KT}(?:companion\\s+)?object\\b\\s*(?<n>${ID})?`), kind: 'object', name: 'companion object' },
    { re: r(`${KT}(?:fun\\s+)?interface\\s+(?<n>${ID})`), kind: 'interface' },
    { re: r(`${KT}class\\s+(?<n>${ID})`), kind: m => (/\benum\s+class\b/.test(m[0]) ? 'enum' : 'class') },
    { re: r(`${KT}typealias\\s+(?<n>${ID})`), kind: 'type' },
    { re: r(`${KT}fun\\s+(?:<[^>]*>\\s*)?(?:[^(\\s][^(]*?\\.)?(?<n>\`[^\`]+\`|${ID})\\s*\\(`), kind: member('method', 'function') },
    { re: r(`${KT}constructor\\s*\\(`), only: 'member', kind: 'constructor', name: 'constructor' },
    { re: r(`${KT}(?:val|var)\\s+(?:<[^>]*>\\s*)?(?:[^=:(\\s][^=:(]*?\\.)?(?<n>\`[^\`]+\`|${ID})`), kind: member('property', 'variable') },
  ],
}

const JV = mods('public|private|protected|static|final|abstract|sealed|non-sealed|strictfp|default|synchronized|native|transient|volatile')
const JTYPE = '[\\w$.]+(?:<.*>)?(?:\\[\\])*'
/** Words that start a statement where a member's type would stand. */
const STATEMENT = /^(?:return|throw|new|else|case|default|package|import|yield|assert|break|continue|do|if|for|while|switch|try|catch|finally)$/
const JAVA_TYPES: Record<string, SymbolKind> = { class: 'class', record: 'class', interface: 'interface', '@interface': 'interface', enum: 'enum' }
const JAVA: Grammar = {
  comment: '//', blocks: [['/*', '*/'], ['"""', '"""']], quotes: `"'`,
  // A record's components.
  header: ['class'], param: r(`${mods('final')}${JTYPE}\\s+(?<n>${ID})$`, 'd'),
  rules: [
    { re: r(`${JV}(?<k>class|interface|enum|record|@interface)\\s+(?<n>${ID})`), kind: m => JAVA_TYPES[m.groups!.k] },
    { re: r(`${JV}(?:<[^>]*>\\s*)?(?<n>${ID})\\s*\\(`), only: 'member', kind: (m, parent) => (m.groups!.n === parent?.name ? 'constructor' : undefined) },
    { re: r(`${JV}(?:<[^>]*>\\s*)?(?<t>${JTYPE})\\s+(?<n>${ID})\\s*\\(`), only: 'member', kind: m => (STATEMENT.test(m.groups!.t) ? undefined : 'method') },
    { re: r(`${JV}(?<t>${JTYPE})\\s+(?<n>${ID})\\s*(?:[=;,]|$)`), only: 'member', kind: m => (STATEMENT.test(m.groups!.t) ? undefined : 'property') },
  ],
}

const TSM = mods('export|default|declare|abstract|async|public|private|protected|static|readonly|override|accessor')
/** What follows a name when its value is a function: `= (a) => …`, `= async x => …`, `= function …`. */
const ARROW = /^\s*=\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>)/
const fnOr = (fn: SymbolKind, value: SymbolKind) => (m: RegExpExecArray) => (ARROW.test(m.groups!.rest) ? fn : value)
const TS: Grammar = {
  comment: '//', blocks: [['/*', '*/'], ['`', '`']], quotes: `"'`,
  // Parameter properties: a constructor's parameters marked `private`, `readonly`…
  header: ['constructor'], param: r(`^(?:${ANNOT}\\s+)*(?:(?:public|private|protected|readonly|override)\\s+)+(?<n>${ID})`, 'd'),
  rules: [
    { re: r(`${TSM}class\\s+(?<n>${ID})`), kind: 'class' },
    { re: r(`${TSM}interface\\s+(?<n>${ID})`), kind: 'interface' },
    { re: r(`${TSM}(?:const\\s+)?enum\\s+(?<n>${ID})`), kind: 'enum' },
    { re: r(`${TSM}type\\s+(?<n>${ID})`), only: 'top', kind: 'type' },
    { re: r(`${TSM}function\\s*\\*?\\s*(?<n>${ID})`), only: 'top', kind: 'function' },
    { re: r(`${TSM}(?:const|let|var)\\s+(?<n>${ID})\\s*(?::[^=]*)?(?<rest>.*)`), only: 'top', kind: fnOr('function', 'variable') },
    { re: r(`${TSM}constructor(?=\\s*\\()`), only: 'member', kind: 'constructor', name: 'constructor' },
    { re: r(`${TSM}(?:get\\s+|set\\s+)?\\*?\\s*(?<n>#?${ID})\\s*\\??\\s*(?:<[^>]*>)?\\s*\\(`), only: 'member', kind: 'method' },
    { re: r(`${TSM}(?<n>#?${ID})\\s*[?!]?\\s*(?::[^=]*)?(?<rest>[=;,].*|$)`), only: 'member', kind: fnOr('method', 'property') },
  ],
}

// `class func` and `class var` are members, so `class` is a modifier too; a type's name is never one of those words.
const SW = mods('public|private|fileprivate|internal|open|package|final|static|class|override|mutating|nonmutating|convenience|required|lazy|weak|unowned|dynamic|optional|indirect|nonisolated|isolated|distributed|(?:public|private|fileprivate|internal|open)\\(set\\)')
const SWIFT_TYPES: Record<string, SymbolKind> = { class: 'class', actor: 'class', struct: 'struct', enum: 'enum', protocol: 'interface', extension: 'extension' }
const SWIFT: Grammar = {
  comment: '//', blocks: [['/*', '*/'], ['"""', '"""']], quotes: '"',
  skip: /^#(?:if|elseif|else|endif)\b/,
  rules: [
    { re: r(`${SW}(?<k>class|actor|struct|enum|protocol|extension)\\s+(?!(?:func|var|let|subscript|init)\\b)(?<n>${ID}(?:\\.${ID})*)`), kind: m => SWIFT_TYPES[m.groups!.k] },
    { re: r(`${SW}(?:typealias|associatedtype)\\s+(?<n>${ID})`), kind: 'type' },
    { re: r(`${SW}func\\s+(?<n>${ID})`), kind: member('method', 'function') },
    { re: r(`${SW}init[?!]?\\s*[(<]`), only: 'member', kind: 'constructor', name: 'init' },
    { re: r(`${SW}deinit\\b`), only: 'member', kind: 'method', name: 'deinit' },
    { re: r(`${SW}subscript\\s*[(<]`), only: 'member', kind: 'method', name: 'subscript' },
    { re: r(`${SW}(?:var|let)\\s+(?<n>${ID})`), kind: member('property', 'variable') },
  ],
}

const CS_ATTR = '\\[[^\\]]*\\]'
const CS = mods(`${CS_ATTR}|public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new|file|required|virtual|override|async|extern|volatile|const|event|ref`)
const CS_TYPE = '(?:\\([^()]*\\)|[\\w.]+(?:<.*>)?)\\??(?:\\[[,\\s]*\\])*\\??'
const CS_TYPES: Record<string, SymbolKind> = { class: 'class', record: 'class', struct: 'struct', interface: 'interface', enum: 'enum' }
const CSHARP: Grammar = {
  comment: '//', blocks: [['/*', '*/'], ['"""', '"""']], quotes: `"'`,
  skip: /^#(?:if|elif|else|endif|region|endregion|pragma|define|undef|line|nullable|warning|error)\b/,
  // A record's or a primary constructor's parameters, which the whole type sees.
  header: ['class', 'struct'], param: r(`${mods(`${CS_ATTR}|ref|out|in|params|scoped`)}${CS_TYPE}\\s+(?<n>${ID})(?:\\s*=.*)?$`, 'd'),
  rules: [
    { re: r(`${CS}namespace\\s+(?<n>[\\w.]+)`), kind: 'namespace' },
    { re: r(`${CS}(?:record\\s+)?(?<k>class|struct|interface|enum|record)\\s+(?<n>${ID})`), kind: m => CS_TYPES[m.groups!.k] },
    { re: r(`${CS}(?<n>${ID})\\s*\\(`), only: 'member', kind: (m, parent) => (m.groups!.n === parent?.name ? 'constructor' : undefined) },
    { re: r(`${CS}(?<t>${CS_TYPE})\\s+(?<n>${ID})\\s*(?:<[^>]*>)?\\s*\\(`), only: 'member', kind: m => (STATEMENT.test(m.groups!.t) ? undefined : 'method') },
    { re: r(`${CS}(?<t>${CS_TYPE})\\s+(?<n>${ID})\\s*(?:\\{|=>|[=;,]|$)`), only: 'member', kind: m => (STATEMENT.test(m.groups!.t) ? undefined : 'property') },
  ],
}

const CPP_MODS = mods('template\\s*<[^;{]*?>|static|inline|virtual|explicit|constexpr|consteval|constinit|extern|friend|mutable|thread_local|volatile|typename|\\[\\[[^\\]]*\\]\\]|[A-Z][A-Z0-9_]*_EXPORT|Q_INVOKABLE')
/** Words that cannot be a C++ declaration's type or name. */
const CPP_NOT = /^(?:template|return|delete|new|throw|else|case|goto|co_return|co_await|co_yield|using|typedef|namespace|class|struct|union|enum|operator|public|private|protected|if|for|while|switch|catch|sizeof|alignof|decltype|static_assert|do)$/
const notCpp = (m: RegExpExecArray) => CPP_NOT.test(m.groups!.t.trim().split(/\s+/)[0]) || CPP_NOT.test(m.groups!.n)
const CPP_TYPES: Record<string, SymbolKind> = { class: 'class', struct: 'struct', union: 'struct', enum: 'enum' }
/** Inside a class or struct, not merely inside a namespace. */
const inType = (parent?: OutlineItem) => Boolean(parent && parent.kind !== 'namespace')
// A return or variable type as one lazy run: a repeated group here would backtrack without end on long lines.
const CPP_TYPE = '[\\w:<>,*&\\s]+?'
const CPP: Grammar = {
  comment: '//', blocks: [['/*', '*/']], quotes: `"'`,
  skip: /^(?:#|(?:public|private|protected|signals|Q_SIGNALS|Q_SLOTS|(?:public|private|protected)\s+(?:slots|Q_SLOTS))\s*:(?!:))/,
  rules: [
    { re: r(`^(?:inline\\s+)?namespace\\b\\s*(?<n>[\\w:]+)?`), kind: 'namespace', name: '(익명)' },
    // `class Foo;` only declares it ahead.
    { re: r(`${CPP_MODS}(?<k>class|struct|union|enum)(?:\\s+(?:class|struct))?\\s+(?:[A-Z][A-Z0-9_]*\\s+)?(?<n>${ID})`), kind: m => (/;\s*$/.test(m.input) && !m.input.includes('{') ? undefined : CPP_TYPES[m.groups!.k]) },
    { re: r(`^using\\s+(?<n>${ID})\\s*=`), kind: 'type' },
    { re: r(`^typedef\\b[^;]*?(?<n>${ID})\\s*(?:\\[[^\\]]*\\])?\\s*;`), kind: 'type' },
    { re: r(`${CPP_MODS}(?<n>~?${ID})\\s*\\(`), only: 'member', kind: (m, parent) => (m.groups!.n === parent?.name ? 'constructor' : m.groups!.n === `~${parent?.name}` ? 'method' : undefined) },
    // Defined outside its class: `Foo::Foo(…)`, `Foo::~Foo()`.
    { re: r(`${CPP_MODS}(?<n>(?:${ID}::)+~?${ID})\\s*\\(`), kind: (_, parent) => (inType(parent) ? undefined : 'method') },
    { re: r(`${CPP_MODS}(?<t>${CPP_TYPE})[\\s*&]+(?<n>(?:${ID}::)*~?${ID})\\s*\\(`), kind: (m, parent) => (notCpp(m) ? undefined : inType(parent) || m.groups!.n.includes('::') ? 'method' : 'function') },
    // A field ends its line with `;`, `=` or `{`: a comma or nothing means a header running on (`Base<K, V>, Hash,`).
    { re: r(`${CPP_MODS}(?<t>${CPP_TYPE})[\\s*&]+(?<n>${ID})\\s*(?:\\[[^\\]]*\\]\\s*)?[=;{]`), kind: (m, parent) => (notCpp(m) ? undefined : inType(parent) ? 'property' : 'variable') },
  ],
}

const PYTHON: Grammar = {
  comment: '#', blocks: [['"""', '"""'], ["'''", "'''"]], quotes: `"'`,
  rules: [
    { re: r(`^class\\s+(?<n>${ID})`), kind: 'class' },
    { re: r(`^(?:async\\s+)?def\\s+(?<n>${ID})`), kind: member('method', 'function') },
    { re: r(`^(?<n>${ID})\\s*(?::[^=]*)?=(?!=)`), kind: member('property', 'variable') },
    { re: r(`^(?<n>${ID})\\s*:\\s*[^=]+$`), only: 'member', kind: 'property' },
  ],
}

const SQL_TYPES: Record<string, SymbolKind> = { table: 'table', view: 'view', function: 'function', procedure: 'function', trigger: 'function', type: 'type' }
/** Lines in a table's body that are not columns. */
const SQL_CONSTRAINT = /^(?:primary|foreign|constraint|unique|key|index|check|exclude|period|like|fulltext|spatial)$/i
const SQL: Grammar = {
  comment: '--', blocks: [['/*', '*/']], quotes: `'`,
  rules: [
    {
      re: /^create\s+(?:or\s+replace\s+)?(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?(?:materialized\s+)?(?<k>table|view|function|procedure|trigger|type)\s+(?:if\s+not\s+exists\s+)?(?<n>[\w.`"[\]]+)/i,
      kind: m => SQL_TYPES[m.groups!.k.toLowerCase()],
    },
    { re: /^(?<n>[`"[]?[A-Za-z_]\w*[`"\]]?)\s+[A-Za-z]/, only: 'member', kind: m => (SQL_CONSTRAINT.test(m.groups!.n) ? undefined : 'column') },
  ],
}

/** What may stand between a declaration's name and its constructor's parentheses: type parameters, `@Inject constructor`. */
const HEADER = /^\s*(?:<(?:[^<>]|<[^<>]*>)*>)?[\w@\s]*\(/

const GRAMMARS: Record<string, Grammar> = {
  kotlin: KOTLIN, java: JAVA, swift: SWIFT, csharp: CSHARP, c: CPP, cpp: CPP,
  typescript: TS, tsx: TS, javascript: TS, jsx: TS, python: PYTHON, sql: SQL,
}
/** Longer lines (minified code, data) are not read for declarations: some rules would take too long on them. */
const LONGEST = 500

/** The file's declarations in order, or undefined for a language it cannot read. */
export function outlineOf(lines: string[], path: string): OutlineItem[] | undefined {
  const lang = langOf(path)
  if (lang === 'markdown' || lang === 'mdx') return headings(lines)
  const g = lang ? GRAMMARS[lang] : undefined
  if (!g) return undefined
  const out: OutlineItem[] = []
  // Every line that could hold members (the top, a type's body) opens an entry; deeper lines belong to it.
  const stack: { indent: number; item?: OutlineItem }[] = []
  const state: { close?: string } = {}
  let last = 0
  const close = (indent: number, end: number) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      const { item } = stack.pop()!
      if (item) item.end = end
    }
  }
  // A constructor's parentheses being read, perhaps over several lines: each top-level comma ends a parameter, and the
  // parameter is placed on the line of its name (not of an annotation above it).
  let header: { owner: OutlineItem; indent: number; level: number; text: string; lines: { at: number; no: number }[] } | undefined
  const param = (no: number) => {
    const h = header!, text = h.text.trimStart(), lead = h.text.length - text.length
    const at = text.trim() ? g.param!.exec(text.trimEnd())?.indices?.groups?.n : undefined
    if (at) {
      const line = h.lines.findLast(l => l.at <= lead + at[0])?.no ?? no
      out.push({ name: text.slice(at[0], at[1]).replace(/`/g, ''), kind: 'param', line, end: no, depth: h.owner.kind === 'constructor' ? h.owner.depth : h.owner.depth + 1 })
    }
    h.text = ''
    h.lines = [{ at: 0, no }]
  }
  const feed = (text: string, no: number) => {
    header!.lines.push({ at: header!.text.length, no })
    for (const c of text) {
      const h = header!
      if ('([{'.includes(c) && ++h.level === 1) continue
      if (')]}'.includes(c) && --h.level === 0) { param(no); header = undefined; return }
      if (c === ',' && h.level === 1) { param(no); continue }
      h.text += c
    }
    header!.text += ' '
  }
  // A skipped preprocessor line ending in a backslash runs on into the next.
  let runOn = false
  lines.forEach((line, i) => {
    const text = code(line, g, state).trim()
    if (runOn) { runOn = line.trimEnd().endsWith('\\'); return }
    if (!text) return
    if (g.skip?.test(text)) { runOn = line.trimEnd().endsWith('\\'); return }
    const no = i + 1, indent = indentOf(line)
    // The parameters sit deeper than their declaration, or close on its indent; anything else means they were misread.
    if (header && (indent > header.indent || text[0] === ')')) { feed(text, no); last = no; return }
    header = undefined
    // A closing brace ends what was opened at its indent (with it) and anything deeper (before it).
    if (text[0] === '}') { close(indent + 1, last); close(indent, no); last = no; return }
    // A header's continuation: an Allman brace, a parameter list closing below its declaration, supertypes or an
    // initializer list on the next line.
    if ('{()]:'.includes(text[0])) return
    close(indent, last)
    last = no
    const parent = stack[stack.length - 1]
    if (parent && !(parent.item && CONTAINERS.has(parent.item.kind))) return
    const found = text.length <= LONGEST ? declaration(text, g, parent?.item) : undefined
    const item = found && { name: found.name, kind: found.kind, line: no, end: no, depth: stack.filter(e => e.item).length }
    if (item) out.push(item)
    stack.push({ indent, item })
    const open = item && g.header?.includes(item.kind) ? HEADER.exec(found.rest) : null
    if (item && open) {
      header = { owner: item, indent, level: 0, text: '', lines: [] }
      feed(found.rest.slice(open[0].length - 1), no)
    }
  })
  close(-1, last)
  return out
}

/** The innermost declaration holding the line. */
export function activeAt(items: OutlineItem[], line: number): OutlineItem | undefined {
  let found: OutlineItem | undefined
  for (const it of items) if (it.line <= line && line <= it.end) found = it
  return found
}

/** The declaration a line starts with, and the text after its name. */
function declaration(text: string, g: Grammar, parent?: OutlineItem): { name: string; kind: SymbolKind; rest: string } | undefined {
  for (const rule of g.rules) {
    if (rule.only === 'top' ? parent : rule.only === 'member' ? !parent : false) continue
    const m = rule.re.exec(text)
    if (!m) continue
    const kind = typeof rule.kind === 'function' ? rule.kind(m, parent) : rule.kind
    const name = (m.groups?.n ?? rule.name ?? '').replace(/[`"[\]]/g, '')
    if (kind && name) return { name, kind, rest: text.slice(m.index + m[0].length) }
  }
  return undefined
}

/** A tab runs to the next multiple of four. */
function indentOf(line: string): number {
  let n = 0
  for (const c of line) {
    if (c === ' ') n++
    else if (c === '\t') n += 4 - (n % 4)
    else break
  }
  return n
}

/** The line's code with comments and string contents taken out; `state` carries a comment or string left open across lines. */
function code(line: string, g: Grammar, state: { close?: string }): string {
  const special = specialOf(g)
  let out = ''
  for (let i = 0; i < line.length;) {
    if (state.close) {
      const j = line.indexOf(state.close, i)
      if (j < 0) return out
      i = j + state.close.length
      state.close = undefined
      continue
    }
    // Jump to the next comment, block or quote; long minified lines have few.
    special.lastIndex = i
    const m = special.exec(line)
    if (!m) return out + line.slice(i)
    out += line.slice(i, m.index)
    const t = m[0]
    i = m.index
    if (t === g.comment) break
    const block = g.blocks.find(([open]) => open === t)
    if (block) { state.close = block[1]; i += t.length; out += ' '; continue }
    if (g.keep?.includes(t)) {
      const j = line.indexOf(t, i + 1)
      const end = j < 0 ? line.length : j + 1
      out += line.slice(i, end)
      i = end
    } else {
      let j = i + 1
      while (j < line.length && line[j] !== t) j += line[j] === '\\' ? 2 : 1
      out += t + t
      i = j + 1
    }
  }
  return out
}

const specials = new Map<Grammar, RegExp>()
/** What `code` stops at in a grammar: its comment, block openers and quotes, longest first. */
function specialOf(g: Grammar): RegExp {
  let re = specials.get(g)
  if (!re) {
    const tokens = [g.comment ?? '', ...g.blocks.map(([open]) => open), ...(g.keep ?? ''), ...g.quotes].filter(Boolean)
    re = new RegExp(tokens.sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    specials.set(g, re)
  }
  return re
}

/** Markdown: the headings, nested by level, each spanning its section; fenced code is skipped. */
function headings(lines: string[]): OutlineItem[] {
  const out: OutlineItem[] = []
  let fence: string | undefined
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = undefined
      return
    }
    const h = !fence && /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
    if (h && h[2]) out.push({ name: h[2].replace(/`/g, ''), kind: 'heading', line: i + 1, end: lines.length, depth: h[1].length })
  })
  out.forEach((o, k) => {
    const next = out.slice(k + 1).find(p => p.depth <= o.depth)
    if (next) o.end = next.line - 1
  })
  const top = Math.min(...out.map(o => o.depth))
  for (const o of out) o.depth -= top
  return out
}
