import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { RULES, VAR_COLORS, localMarks, varLangOf, type VarLang } from '../web/src/canvas/variables.ts'

const WASM: Record<VarLang, string> = {
  kotlin: 'node_modules/@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm',
  java: 'node_modules/tree-sitter-java/tree-sitter-java.wasm',
  typescript: 'node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm',
}
const LOCALS: Record<VarLang, string> = { kotlin: 'kotlin', java: 'java', typescript: 'typescript', tsx: 'typescript' }

beforeAll(async () => { await Parser.init() })

/** Each painted identifier as `name@line:column`, with its color. */
async function paint(lang: VarLang, src: string) {
  const language = await Language.load(WASM[lang])
  const parser = new Parser()
  parser.setLanguage(language)
  const query = new Query(language, readFileSync(`web/src/canvas/locals/${LOCALS[lang]}.scm`, 'utf8'))
  const tree = parser.parse(src)!
  const lines = src.split('\n')
  const marks = localMarks(tree.rootNode, query, RULES[lang])
  tree.delete()
  const color = new Map<string, number>()
  for (const m of marks) {
    const at = `${lines[m.line].slice(m.start, m.end)}@${m.line + 1}:${m.start}`
    expect(color.has(at), `${at} painted twice`).toBe(false)
    color.set(at, m.color)
  }
  /** The color of the n-th (from 0) occurrence of `name` on a line, or undefined when it is not painted. */
  const at = (line: number, name: string, n = 0) => {
    const col = [...lines[line - 1].matchAll(new RegExp(`(?<![\\w])${name}(?![\\w$])`, 'g'))][n]?.index
    return col === undefined ? undefined : color.get(`${name}@${line}:${col}`)
  }
  return { at, count: color.size }
}

describe('varLangOf', () => {
  it('colors Kotlin, Java and TypeScript', () => {
    expect(['a/B.kt', 'B.kts', 'B.java', 'b.ts', 'b.tsx', 'b.mts', 'b.js', 'b.py', undefined].map(varLangOf))
      .toEqual(['kotlin', 'kotlin', 'java', 'typescript', 'tsx', 'typescript', undefined, undefined, undefined])
  })
})

describe('localMarks: Kotlin', () => {
  const src = [
    /* 1 */ 'class Svc(private val repo: Repo, name: String) {',
    /* 2 */ '  fun run(order: Order, n: Int = 2): Int {',
    /* 3 */ '    val lines = order.lines',
    /* 4 */ '    var sum = 0',
    /* 5 */ '    for (line in lines) sum += line.price',
    /* 6 */ '    lines.forEach { l -> println(l) }',
    /* 7 */ '    lines.map { it.price }.filter { it > n }',
    /* 8 */ '    try { repo.save(order) } catch (e: Exception) { log(e) }',
    /* 9 */ '    f(name = sum, total)',
    /* 10 */ '    val x = 1; run { val x = 2; println(x) }; println(x)',
    /* 11 */ '    return sum + n + total',
    /* 12 */ '  }',
    /* 13 */ '  val total = 0',
    /* 14 */ '}',
  ].join('\n')

  it('gives a parameter, a local and a class property one color from declaration to every use', async () => {
    const { at } = await paint('kotlin', src)
    expect(at(2, 'order')).toBeDefined()
    expect(at(3, 'order')).toBe(at(2, 'order'))
    expect(at(8, 'order')).toBe(at(2, 'order'))
    expect(at(5, 'lines')).toBe(at(3, 'lines'))
    expect(at(11, 'sum')).toBe(at(4, 'sum'))
    expect(at(11, 'n')).toBe(at(2, 'n'))
    expect(at(8, 'repo')).toBe(at(1, 'repo'))
    // A property is seen everywhere in its class, before its declaration too.
    expect(at(11, 'total')).toBe(at(13, 'total'))
  })

  it('tells apart variables in sight of each other', async () => {
    const { at } = await paint('kotlin', src)
    // The class's repo, name and total, then the function's order, n and lines: six in sight, six colors.
    const inSight = [at(1, 'repo'), at(1, 'name'), at(13, 'total'), at(2, 'order'), at(2, 'n'), at(3, 'lines')]
    expect(new Set(inSight).size).toBe(VAR_COLORS)
  })

  it('follows scopes: loop and lambda parameters, a catch parameter, shadowing, the implicit it', async () => {
    const { at } = await paint('kotlin', src)
    expect(at(5, 'line', 1)).toBe(at(5, 'line'))
    expect(at(6, 'l', 1)).toBe(at(6, 'l'))
    expect(at(8, 'e', 1)).toBe(at(8, 'e'))
    // The inner x is its own variable; the x after the lambda is the outer one again.
    expect(at(10, 'x', 1)).not.toBe(at(10, 'x'))
    expect(at(10, 'x', 2)).toBe(at(10, 'x', 1))
    expect(at(10, 'x', 3)).toBe(at(10, 'x'))
    expect(at(7, 'it')).toBeDefined()
    expect(at(7, 'it', 1)).toBeDefined()
  })

  it('reads string templates and backticked names', async () => {
    const { at } = await paint('kotlin', [
      /* 1 */ 'class OrderTest {',
      /* 2 */ '  fun `주문을 저장하면 id가 생긴다`() {',
      /* 3 */ '    val order = Order(id = 1)',
      /* 4 */ '    log("saved $order with ${order.id}, $$order, \\$order")',
      /* 5 */ '    log("""',
      /* 6 */ '      raw $order""")',
      /* 7 */ '  }',
      /* 8 */ '}',
    ].join('\n'))
    const order = at(3, 'order')
    expect(order).toBeDefined()
    expect([at(4, 'order'), at(4, 'order', 1), at(4, 'order', 2), at(6, 'order')]).toEqual([order, order, order, order])
    // An escaped dollar is text.
    expect(at(4, 'order', 3)).toBeUndefined()
  })

  it('leaves members, named arguments, types and names of declarations alone', async () => {
    const { at } = await paint('kotlin', src)
    expect(at(3, 'lines', 1)).toBeUndefined() // order.lines
    expect(at(5, 'price')).toBeUndefined()
    expect(at(9, 'name')).toBeUndefined() // f(name = sum)
    expect(at(9, 'sum')).toBe(at(4, 'sum'))
    expect(at(2, 'Order')).toBeUndefined()
    expect(at(2, 'run')).toBeUndefined()
    expect(at(6, 'println')).toBeUndefined()
  })
})

describe('localMarks: Java', () => {
  const src = [
    /* 1 */ 'class Svc {',
    /* 2 */ '  private final Repo repo;',
    /* 3 */ '  Svc(Repo repo) { this.repo = repo; }',
    /* 4 */ '  int run(Order order, int n) {',
    /* 5 */ '    var lines = order.lines;',
    /* 6 */ '    int sum = 0;',
    /* 7 */ '    for (Line line : lines) sum += line.price;',
    /* 8 */ '    lines.forEach(l -> log(l));',
    /* 9 */ '    try { repo.save(order); } catch (Exception e) { log(e); }',
    /* 10 */ '    if (order instanceof Big big) big.ship();',
    /* 11 */ '    return sum + n + total;',
    /* 12 */ '  }',
    /* 13 */ '  int total;',
    /* 14 */ '}',
  ].join('\n')

  it('ties uses to parameters, locals and fields, scope by scope', async () => {
    const { at } = await paint('java', src)
    expect(at(5, 'order')).toBe(at(4, 'order'))
    expect(at(7, 'lines')).toBe(at(5, 'lines'))
    expect(at(11, 'sum')).toBe(at(6, 'sum'))
    expect(at(7, 'line', 1)).toBe(at(7, 'line'))
    expect(at(8, 'l', 1)).toBe(at(8, 'l'))
    expect(at(9, 'e', 1)).toBe(at(9, 'e'))
    expect(at(10, 'big', 1)).toBe(at(10, 'big'))
    // The field, used in the method before it is declared; the constructor's parameter of the same name is another variable.
    expect(at(9, 'repo')).toBe(at(2, 'repo'))
    expect(at(11, 'total')).toBe(at(13, 'total'))
    expect(at(3, 'repo', 2)).toBe(at(3, 'repo'))
    expect(at(3, 'repo')).not.toBe(at(2, 'repo'))
  })

  it('leaves fields after a dot and method names alone', async () => {
    const { at } = await paint('java', src)
    expect(at(3, 'repo', 1)).toBeUndefined() // this.repo
    expect(at(5, 'lines', 1)).toBeUndefined() // order.lines
    expect(at(9, 'save')).toBeUndefined()
    expect(at(4, 'run')).toBeUndefined()
  })
})

describe('localMarks: TypeScript', () => {
  const src = [
    /* 1 */ 'export function total(order: Order, n = 2) {',
    /* 2 */ '  const lines = order.lines',
    /* 3 */ '  let sum = 0',
    /* 4 */ '  for (const line of lines) sum += line.price',
    /* 5 */ '  lines.forEach(l => log(l))',
    /* 6 */ '  const { a, b: c } = pair',
    /* 7 */ '  sum = a + c',
    /* 8 */ '  try { save({ sum }) } catch (e) { log(e) }',
    /* 9 */ '  return sum + n',
    /* 10 */ '}',
  ].join('\n')

  it('ties uses to parameters, locals and destructured names; reassigning keeps the variable', async () => {
    const { at } = await paint('typescript', src)
    expect(at(2, 'order')).toBe(at(1, 'order'))
    expect(at(4, 'lines')).toBe(at(2, 'lines'))
    expect(at(4, 'line', 1)).toBe(at(4, 'line'))
    expect(at(5, 'l', 1)).toBe(at(5, 'l'))
    expect(at(7, 'a')).toBe(at(6, 'a'))
    expect(at(7, 'c')).toBe(at(6, 'c'))
    expect(at(7, 'sum')).toBe(at(3, 'sum'))
    expect(at(8, 'sum')).toBe(at(3, 'sum'))
    expect(at(8, 'e', 1)).toBe(at(8, 'e'))
    expect(at(9, 'n')).toBe(at(1, 'n'))
  })

  it('leaves members, object keys and the function name alone', async () => {
    const { at } = await paint('typescript', src)
    expect(at(2, 'lines', 1)).toBeUndefined()
    expect(at(6, 'b')).toBeUndefined()
    expect(at(1, 'total')).toBeUndefined()
  })

  it('reads TSX with the same query', async () => {
    const { at } = await paint('tsx', 'function View({ name }: P) {\n  const label = name.trim()\n  return <b title={label}>{name}</b>\n}')
    expect(at(2, 'name')).toBe(at(1, 'name'))
    expect(at(3, 'label')).toBe(at(2, 'label'))
    expect(at(3, 'name')).toBe(at(1, 'name'))
  })
})

describe('localMarks: colors', () => {
  it('takes turns among VAR_COLORS colors', async () => {
    const names = Array.from({ length: VAR_COLORS + 2 }, (_, i) => `v${i}`)
    const { at } = await paint('typescript', `function f() {\n${names.map(v => `  const ${v} = 0`).join('\n')}\n}`)
    expect(names.map((v, i) => at(i + 2, v))).toEqual(names.map((_, i) => i % VAR_COLORS))
  })
})
