import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => unknown

function registry(): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null
}

/** Every match of `query` in the code cells under `root`, as ranges (case-insensitive unless the query has capitals). */
function findRanges(root: HTMLElement, query: string): Range[] {
  if (!query) return []
  const smart = query !== query.toLowerCase()
  const needle = smart ? query : query.toLowerCase()
  const out: Range[] = []
  for (const cell of root.querySelectorAll<HTMLElement>('td.code')) {
    // Join the cell's text nodes, find matches, then map offsets back to nodes.
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let text = ''
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if ((n.parentElement?.closest('.sign, .add-comment'))) continue
      nodes.push(n as Text)
      text += (n as Text).data
    }
    const hay = smart ? text : text.toLowerCase()
    let from = 0
    while (from <= hay.length - needle.length) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      const range = document.createRange()
      let pos = 0, started = false
      for (const node of nodes) {
        const len = node.data.length
        if (!started && at < pos + len) { range.setStart(node, at - pos); started = true }
        if (started && at + needle.length <= pos + len) { range.setEnd(node, at + needle.length - pos); break }
        pos += len
      }
      out.push(range)
      from = at + Math.max(1, needle.length)
      if (out.length > 2000) return out
    }
  }
  return out
}

/** Find in the open file: highlights every match without touching the DOM, steps with ⏎ / ⇧⏎. */
export function FindBar({ scope, onClose }: { scope: () => HTMLElement | null; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const ranges = useRef<Range[]>([])
  const input = useRef<HTMLInputElement>(null)
  // Held, not called per render: the clean-up below is keyed on it and would wipe the marks on every render.
  const [reg] = useState(registry)

  const paint = useCallback((i: number) => {
    if (!reg) return
    reg.highlights.set('duet-find', new reg.Highlight(...ranges.current))
    const cur = ranges.current[i]
    if (cur) {
      reg.highlights.set('duet-find-current', new reg.Highlight(cur))
      const el = cur.startContainer.parentElement?.closest('tr')
      el?.scrollIntoView({ block: 'center' })
    } else reg.highlights.delete('duet-find-current')
  }, [reg])

  const search = useCallback((keepIndex = false) => {
    const root = scope()
    ranges.current = root ? findRanges(root, query) : []
    setCount(ranges.current.length)
    const i = keepIndex ? Math.min(index, Math.max(0, ranges.current.length - 1)) : 0
    setIndex(i)
    paint(i)
  }, [scope, query, index, paint])

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { search() }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  // The diff redraws (highlighting arrives, a gap opens): search again in place.
  useEffect(() => {
    const root = scope()
    if (!root) return
    let t: ReturnType<typeof setTimeout>
    const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => search(true), 120) })
    obs.observe(root, { childList: true, subtree: true })
    return () => { obs.disconnect(); clearTimeout(t) }
  }, [scope, search])
  useEffect(() => () => { reg?.highlights.delete('duet-find'); reg?.highlights.delete('duet-find-current') }, [reg])

  const step = (d: number) => {
    if (!count) return
    const i = (index + d + count) % count
    setIndex(i)
    paint(i)
  }

  return (
    <div className="find-bar fade-in">
      <Search size={13} />
      <input
        ref={input}
        value={query}
        placeholder="이 파일에서 찾기"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        }}
      />
      <span className="find-count">{query ? (count ? `${index + 1}/${count}` : '없음') : ''}</span>
      <button className="iconbtn" title="이전 (⇧⏎)" onClick={() => step(-1)}><ChevronUp size={14} /></button>
      <button className="iconbtn" title="다음 (⏎)" onClick={() => step(1)}><ChevronDown size={14} /></button>
      <button className="iconbtn" title="닫기 (esc)" onClick={onClose}><X size={14} /></button>
      {!reg && <span className="muted small">이 브라우저는 강조를 지원하지 않아</span>}
    </div>
  )
}
