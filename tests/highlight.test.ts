import { describe, expect, it } from 'vitest'
import { ANNOTATION_STYLE, highlight, markAnnotations } from '../web/src/lib/highlight.ts'

/** The text painted in the annotation yellow, one entry per run of yellow tokens. */
const yellow = async (code: string, path: string) => {
  const out: string[] = []
  for (const line of await highlight(code, path)) {
    let run = ''
    for (const t of line) {
      if (t.style === ANNOTATION_STYLE) run += t.content
      else if (run) { out.push(run); run = '' }
    }
    if (run) out.push(run)
  }
  return out
}

describe('annotations', () => {
  it('Kotlin: names and use-site targets go yellow, not what follows them, labels, strings or comments', async () => {
    const code = [
      '@Service',
      'class Svc(@Value("\\${x}") val x: String) {',
      '  @field:NotBlank val name: String = ""',
      '  @Transactional(readOnly = true)',
      '  fun f() = list.forEach { return@forEach }',
      '  val mail = "a@b.com" // @NotThis',
      '  /** KDoc @param name */',
      '  val o = this@Svc',
      '}',
    ].join('\n')
    expect(await yellow(code, 'Svc.kt')).toEqual(['@Service', '@Value', '@field:NotBlank', '@Transactional'])
  })

  it('Java: qualified annotations whole, @interface and Javadoc tags left alone', async () => {
    const code = ['@RestController', 'public @interface Tag {}', '/** @param x */', 'class A { @org.springframework.lang.Nullable String x; }'].join('\n')
    expect(await yellow(code, 'A.java')).toEqual(['@RestController', '@org.springframework.lang.Nullable'])
  })

  it('TypeScript decorators and Python decorators; JSDoc and the matrix operator are not', async () => {
    expect(await yellow("/** @param x */\n@Component({ selector: 'x@y' })\nclass A { @Input() name = 'a' }", 'a.ts')).toEqual(['@Component', '@Input'])
    expect(await yellow('@app.route("/x")\ndef f(a, b): return a @ b', 'a.py')).toEqual(['@app.route'])
  })

  it('leaves other languages as their palette paints them', async () => {
    expect(await yellow('@media screen { a { color: red } }', 'a.css')).toEqual([])
  })

  it('cuts a yellow run out of the middle of a token, keeping the rest of it', () => {
    expect(markAnnotations([{ content: '  @Ann(x) ', style: 's' }])).toEqual([
      { content: '  ', style: 's' }, { content: '@Ann', style: ANNOTATION_STYLE }, { content: '(x) ', style: 's' },
    ])
  })
})
