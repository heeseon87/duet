// Variable colors for the code pane: each variable (a parameter, a local, a class's property) gets a color, the same at
// its declaration and at every use that refers back to it, scope by scope. tree-sitter parses the file and a locals
// query (./locals/<lang>.scm, tree-sitter's convention) says what opens a scope, what defines a name and what refers to
// one; this module ties each reference to its definition. No parser here: variablesLoader.ts brings it.

import type { Node, Query } from 'web-tree-sitter'
import { langOf } from '../lib/highlight.ts'

/** How many colors there are for variables: those read close together differ (colorApart), others may share. */
export const VAR_COLORS = 8

export type VarLang = 'kotlin' | 'java' | 'typescript' | 'tsx'
/** A stretch of a line to paint: its 0-based line and columns in UTF-16 units. */
export type Span = { line: number; start: number; end: number }

/**
 * The keywords (`val`, `fun`, `private`, `return`…): the grammar's own words, nodes with no name of their own. They keep
 * a color of their own while the rest of the code goes gray; types and names stay gray.
 */
export function keywordMarks(root: Node): Span[] {
  const out: Span[] = []
  const c = root.walk()
  for (;;) {
    if (!c.nodeIsNamed && /^[a-z][a-z_]*$/.test(c.nodeType)) {
      const at = c.startPosition
      out.push({ line: at.row, start: at.column, end: at.column + c.endIndex - c.startIndex })
    }
    if (c.gotoFirstChild()) continue
    while (!c.gotoNextSibling()) {
      if (!c.gotoParent()) { c.delete(); return out }
    }
  }
}

/**
 * One identifier to paint: its 0-based line, its columns in UTF-16 units (as the DOM counts them), its variable's color,
 * and whether that variable is a class's property or field (drawn underlined, apart from a local of the same color).
 */
export type VarMark = { line: number; start: number; end: number; color: number; field: boolean }

const LANGS = new Set<string>(['kotlin', 'java', 'typescript', 'tsx'])

export function varLangOf(path: string | undefined): VarLang | undefined {
  const lang = path ? langOf(path) : undefined
  return lang && LANGS.has(lang) ? (lang as VarLang) : undefined
}

/** A name a language gives a block without declaring it, as Kotlin's `it` in a lambda that names no parameter. */
export type Implicit = { name: string; scope: string; unless: string }
/**
 * What a query cannot say for a language: an implicit name, the node type of a string's literal text where `$name`
 * refers to a variable (a Kotlin template; the grammar leaves `"$order"` as text, unlike `${order}`), and definitions
 * that belong further out than where they stand (`lift`: a capture name to the scope types it goes up to, hoisted
 * there), as TypeScript's `var` (its function) and a constructor's `private repo` (its class).
 */
export type Rules = { implicit?: Implicit; templateText?: string; lift?: Record<string, string[]> }
const TS_LIFT = {
  'local.definition.var': ['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function_declaration', 'generator_function'],
  'local.definition.member': ['class_body'],
}
export const RULES: Partial<Record<VarLang, Rules>> = {
  kotlin: { implicit: { name: 'it', scope: 'lambda_literal', unless: 'lambda_parameters' }, templateText: 'string_content' },
  typescript: { lift: TS_LIFT },
  tsx: { lift: TS_LIFT },
}

/** A definition seen from `at` on in its scope, or everywhere in it when hoisted (a class's properties). */
type Def = { name: string; scope: Node; at: number; hoisted: boolean; node?: Node }
/** A name used: where it stands, the node whose scopes it is looked up in, and whether it is a member (`this.x`). */
type Ref = { name: string; at: number; from: Node; line: number; col: number; member?: boolean }

const refOf = (n: Node, member = false): Ref => ({ name: n.text, at: n.startIndex, from: n, line: n.startPosition.row, col: n.startPosition.column, member })

/** The `$name`s in a string's literal text; the grammar may cut the text in pieces, so touching pieces are read as one. */
function templateRefs(str: Node, textType: string): Ref[] {
  const out: Ref[] = []
  let run: Node[] = []
  const flush = () => {
    if (!run.length) return
    const text = run.map(n => n.text).join('')
    for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const off = m.index + 1
      const before = text.slice(0, off), nl = before.lastIndexOf('\n'), start = run[0].startPosition
      out.push({ name: m[1], at: run[0].startIndex + off, from: run[0], line: start.row + before.split('\n').length - 1, col: nl < 0 ? start.column + off : off - nl - 1 })
    }
    run = []
  }
  for (const c of str.children) {
    if (c?.type !== textType || (run.length && run[run.length - 1].endIndex !== c.startIndex)) flush()
    if (c?.type === textType) run.push(c)
  }
  flush()
  return out
}

/**
 * The identifiers to paint: every definition, and every reference that resolves to one in its own or an enclosing
 * scope. A reference to nothing local (a function, a type, an import) stays as the theme colors it. Variables read
 * close together get different colors (colorApart).
 */
export function localMarks(root: Node, query: Query, rules: Rules = {}): VarMark[] {
  const scopes = new Set<number>([root.id])
  const defNodes = new Map<number, { node: Node; hoisted: boolean; lift?: string[] }>()
  const refs: Ref[] = []
  const ignored = new Set<number>()
  for (const { name, node } of query.captures(root)) {
    if (name === 'local.scope') scopes.add(node.id)
    else if (name === 'local.definition' || name === 'local.definition.hoisted' || rules.lift?.[name]) {
      const was = defNodes.get(node.id), lift = was?.lift ?? rules.lift?.[name]
      defNodes.set(node.id, { node, hoisted: Boolean(lift) || name.endsWith('hoisted') || Boolean(was?.hoisted), lift })
    }
    else if (name === 'local.reference') refs.push(refOf(node))
    // A member through `this`: it refers to a class's property or field, whatever a local of that name.
    else if (name === 'local.reference.member') refs.push(refOf(node, true))
    else if (name === 'local.template') { if (rules.templateText) refs.push(...templateRefs(node, rules.templateText)) }
    else if (name === 'ignore') ignored.add(node.id)
  }
  const scopeOf = (n: Node): Node | undefined => {
    if (n.id === root.id) return undefined
    for (let p = n.parent; p; p = p.parent) if (scopes.has(p.id)) return p
    return root
  }

  // Every scope's definitions by name, for looking a reference up.
  const byName = new Map<string, Def[]>()
  const all: Def[] = []
  const define = (d: Def) => {
    const key = `${d.scope.id}\0${d.name}`
    const n = byName.get(key)
    if (n) n.push(d)
    else byName.set(key, [d])
    all.push(d)
  }
  const liftedTo = (n: Node, types: string[]): Node => {
    for (let p = n.parent; p; p = p.parent) if (scopes.has(p.id) && types.includes(p.type)) return p
    return root
  }
  for (const { node, hoisted, lift } of [...defNodes.values()].sort((a, b) => a.node.startIndex - b.node.startIndex)) {
    define({ name: node.text, scope: lift ? liftedTo(node, lift) : scopeOf(node) ?? root, at: node.startIndex, hoisted, node })
  }

  // The implicit name belongs to the nearest block that gives it, made the first time something uses it.
  const implicitIn = new Map<number, Def>()
  const implied = (ref: Ref): Def | undefined => {
    const im = rules.implicit
    if (!im || ref.name !== im.name) return undefined
    for (let p = ref.from.parent; p; p = p.parent) {
      if (p.type !== im.scope || p.children.some(c => c?.type === im.unless)) continue
      let d = implicitIn.get(p.id)
      if (!d) { d = { name: im.name, scope: p, at: p.startIndex, hoisted: false }; implicitIn.set(p.id, d); define(d) }
      return d
    }
    return undefined
  }
  const resolve = (ref: Ref): Def | undefined => {
    // A member sees only class properties and fields (hoisted); a name, those and what was defined before it.
    const sees = (d: Def) => (ref.member ? d.hoisted : d.hoisted || d.at < ref.at)
    for (let s = scopeOf(ref.from); s; s = scopeOf(s)) {
      let found: Def | undefined
      for (const d of byName.get(`${s.id}\0${ref.name}`) ?? []) if (sees(d) && (!found || d.at > found.at)) found = d
      if (found) return found
    }
    return ref.member ? undefined : implied(ref)
  }
  const uses: [Ref, Def][] = []
  for (const ref of refs) {
    if ((ignored.has(ref.from.id) && !ref.member) || (ref.from.text === ref.name && defNodes.has(ref.from.id))) continue
    const d = resolve(ref)
    if (d) uses.push([ref, d])
  }

  const hits: (Span & { d: Def })[] = []
  for (const d of all) if (d.node) hits.push({ d, line: d.node.startPosition.row, start: d.node.startPosition.column, end: d.node.startPosition.column + d.node.endIndex - d.node.startIndex })
  for (const [ref, d] of uses) hits.push({ d, line: ref.line, start: ref.col, end: ref.col + ref.name.length })
  const color = colorApart(hits)
  return hits.map(({ d, ...at }) => ({ ...at, color: color.get(d)!, field: d.hoisted }))
}

/** Lines within which two variables count as read together. */
const NEAR = 3

/**
 * Each variable's color: those read together (a use or a declaration of each within NEAR lines) must differ, those far
 * apart may share. A greedy graph coloring, the most entangled variable first, each taking the color the fewest of its
 * colored neighbors have (the lowest such). Far fewer close pairs share a color than handing colors out by count.
 */
function colorApart<T>(hits: { d: T; line: number }[]): Map<T, number> {
  const byLine = new Map<number, T[]>()
  for (const h of hits) {
    const at = byLine.get(h.line)
    if (at) at.push(h.d)
    else byLine.set(h.line, [h.d])
  }
  const near = new Map<T, Set<T>>()
  for (const h of hits) if (!near.has(h.d)) near.set(h.d, new Set())
  for (const [line, ds] of byLine) {
    for (let l = line; l <= line + NEAR; l++) {
      for (const b of byLine.get(l) ?? []) for (const a of ds) if (a !== b) { near.get(a)!.add(b); near.get(b)!.add(a) }
    }
  }
  const color = new Map<T, number>()
  // Stable on ties: the variables in the order they first come.
  for (const d of [...near.keys()].sort((x, y) => near.get(y)!.size - near.get(x)!.size)) {
    const taken = new Array<number>(VAR_COLORS).fill(0)
    for (const n of near.get(d)!) { const c = color.get(n); if (c !== undefined) taken[c]++ }
    color.set(d, taken.indexOf(Math.min(...taken)))
  }
  return color
}
