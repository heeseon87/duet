import { memo, useEffect, useState } from 'react'
import { highlight, type TokenLines } from './highlight.ts'
import { useApp } from '../state.ts'

/** Highlighted lines for a piece of code; plain text first, colors when shiki is ready. */
export function useTokens(code: string, lang: string | undefined): TokenLines {
  const [tokens, setTokens] = useState<TokenLines>(() => code.split('\n').map(l => [{ content: l }]))
  const palette = useApp(s => s.codePalette)
  useEffect(() => {
    let live = true
    void highlight(code, lang).then(t => { if (live) setTokens(t) })
    return () => { live = false }
  }, [code, lang, palette])
  // A new text shows plain at once; colors follow.
  useEffect(() => { setTokens(code.split('\n').map(l => [{ content: l }])) }, [code])
  return tokens
}

export const Line = memo(function Line({ tokens }: { tokens: TokenLines[number] | undefined }) {
  if (!tokens) return null
  return (
    <>
      {tokens.map((t, i) => (t.style ? <span key={i} style={styleObj(t.style)}>{t.content}</span> : <span key={i}>{t.content}</span>))}
    </>
  )
})

const styleCache = new Map<string, React.CSSProperties>()
export function styleObj(s: string): React.CSSProperties {
  let o = styleCache.get(s)
  if (!o) {
    o = {}
    for (const part of s.split(';')) {
      const i = part.indexOf(':')
      if (i > 0) (o as Record<string, string>)[part.slice(0, i)] = part.slice(i + 1)
    }
    styleCache.set(s, o)
  }
  return o
}

export function CodeBlock({ code, lang, maxLines, className }: { code: string; lang?: string; maxLines?: number; className?: string }) {
  const trimmed = code.replace(/\n$/, '')
  const tokens = useTokens(trimmed, lang)
  const [expanded, setExpanded] = useState(false)
  const shown = maxLines && !expanded ? tokens.slice(0, maxLines) : tokens
  return (
    <div className={`codeblock hl ${className ?? ''}`}>
      <pre>
        {shown.map((line, i) => (
          <div key={i} className="cl"><Line tokens={line} />{'\n'}</div>
        ))}
      </pre>
      {maxLines && tokens.length > maxLines && (
        <button className="more" onClick={() => setExpanded(e => !e)}>{expanded ? '접기' : `${tokens.length - maxLines}줄 더 보기`}</button>
      )}
    </div>
  )
}

/** A run of a line's text, and whether it changed (a word-level diff). */
export type WordSeg = { text: string; changed: boolean }

/** Syntax colors and changed-word marks together: tokens are cut where the word marks start and end. */
export function CodeText({ tokens, text, words, kind }: { tokens?: TokenLines[number]; text: string; words?: WordSeg[]; kind?: 'add' | 'del' }) {
  const toks = tokens && tokens.map(t => t.content).join('') === text ? tokens : [{ content: text }]
  if (!words || !kind) return <Line tokens={toks} />
  const out: React.ReactNode[] = []
  let ti = 0, off = 0, key = 0
  for (const seg of words) {
    let left = seg.text.length
    const parts: React.ReactNode[] = []
    while (left > 0 && ti < toks.length) {
      const t = toks[ti]
      const take = Math.min(left, t.content.length - off)
      parts.push(<span key={key++} style={t.style ? styleObj(t.style) : undefined}>{t.content.slice(off, off + take)}</span>)
      off += take
      left -= take
      if (off >= t.content.length) { ti++; off = 0 }
    }
    out.push(seg.changed ? <mark key={key++} className={`w-${kind}`}>{parts}</mark> : parts)
  }
  return <>{out}</>
}
