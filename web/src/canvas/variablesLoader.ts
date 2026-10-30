// tree-sitter for the code pane's variable colors, loaded on first use: the grammars are megabytes, so only the
// language a file needs, and only once variable colors are on.

import type { Parser, Query } from 'web-tree-sitter'
import { RULES, localMarks, varLangOf, type VarLang, type VarMark } from './variables.ts'

type Url = Promise<{ default: string }>
const GRAMMARS: Record<VarLang, { wasm: () => Url; locals: () => Url }> = {
  kotlin: { wasm: () => import('@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm?url'), locals: () => import('./locals/kotlin.scm?raw') },
  java: { wasm: () => import('tree-sitter-java/tree-sitter-java.wasm?url'), locals: () => import('./locals/java.scm?raw') },
  typescript: { wasm: () => import('tree-sitter-typescript/tree-sitter-typescript.wasm?url'), locals: () => import('./locals/typescript.scm?raw') },
  tsx: { wasm: () => import('tree-sitter-typescript/tree-sitter-tsx.wasm?url'), locals: () => import('./locals/typescript.scm?raw') },
}

let runtime: Promise<typeof import('web-tree-sitter')> | undefined
const loaded = new Map<VarLang, Promise<{ parser: Parser; query: Query }>>()

function load(lang: VarLang) {
  let p = loaded.get(lang)
  if (p) return p
  p = (async () => {
    runtime ??= (async () => {
      const [ts, { default: url }] = await Promise.all([import('web-tree-sitter'), import('web-tree-sitter/tree-sitter.wasm?url')])
      await ts.Parser.init({ locateFile: () => url })
      return ts
    })()
    const ts = await runtime
    const g = GRAMMARS[lang]
    const [{ default: wasm }, { default: locals }] = await Promise.all([g.wasm(), g.locals()])
    const language = await ts.Language.load(wasm)
    const parser = new ts.Parser()
    parser.setLanguage(language)
    return { parser, query: new ts.Query(language, locals) }
  })()
  // A failed load (the server restarting) is tried again next time.
  p.catch(() => { loaded.delete(lang); runtime = undefined })
  loaded.set(lang, p)
  return p
}

/** The identifiers to paint in a file, or undefined for a language without variable colors. */
export async function variableMarks(text: string, path: string): Promise<VarMark[] | undefined> {
  const lang = varLangOf(path)
  if (!lang) return undefined
  const { parser, query } = await load(lang)
  const tree = parser.parse(text)
  if (!tree) return []
  try {
    return localMarks(tree.rootNode, query, RULES[lang])
  } finally {
    tree.delete()
  }
}
