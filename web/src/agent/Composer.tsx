import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ArrowUp, X } from 'lucide-react'
import type { ContextItem } from '../../../shared/protocol.ts'
import { useApp } from '../state.ts'
import { shortcutKey } from '../lib/ui.tsx'
import { fuzzy, repoFiles } from '../lib/files.ts'

type Typed = { text: string; context: ContextItem[] }
/** What is being typed, apart from the box: it outlives the box while the box is away (decision mode, put away). */
const useTyped = create<Typed>(() => ({ text: '', context: [] }))
function setter<K extends keyof Typed>(k: K) {
  return (v: Typed[K] | ((cur: Typed[K]) => Typed[K])) =>
    useTyped.setState(s => ({ [k]: typeof v === 'function' ? (v as (cur: Typed[K]) => Typed[K])(s[k]) : v }) as Pick<Typed, K>)
}
const setText = setter('text'), setContext = setter('context')
// The last draft taken in: a box mounting later must not take it again.
let takenDraft = 0

/** What goes to the terminal picked on the rail: words, and files picked with `@`. `floating`: the box over the map. */
export function Composer({ floating }: { floating?: boolean }) {
  const send = useApp(s => s.send)
  const toast = useApp(s => s.toast)
  const draft = useApp(s => s.draft)
  const workspace = useApp(s => s.workspace?.path)
  const text = useTyped(s => s.text)
  const context = useTyped(s => s.context)
  const [menuIndex, setMenuIndex] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!draft || draft.nonce === takenDraft) return
    takenDraft = draft.nonce
    setText(t => (t.trim() ? `${t}\n${draft.text}` : draft.text))
    if (draft.context?.length) setContext(c => [...c, ...draft.context!])
    requestAnimationFrame(() => {
      ref.current?.focus()
      const el = ref.current
      if (el) el.selectionStart = el.selectionEnd = el.value.length
    })
  }, [draft])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, Math.max(160, window.innerHeight * 0.4))}px`
  }, [text])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && shortcutKey(e).toLowerCase() === 'l') { e.preventDefault(); ref.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // `@part` right before the caret: offer repo files.
  const [caret, setCaret] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [dismissed, setDismissed] = useState<string | null>(null)
  const mention = dismissed === text ? null : /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  useEffect(() => {
    if (mention && workspace) void repoFiles(workspace).then(setFiles).catch(() => undefined)
  }, [Boolean(mention), workspace]) // eslint-disable-line react-hooks/exhaustive-deps
  const menu = mention
    ? files.map(p => ({ p, s: fuzzy(p, mention[2]) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.p)
    : []
  const pickFile = (path: string) => {
    if (!mention) return
    const start = caret - mention[2].length - 1
    const next = `${text.slice(0, start)}@${path} ${text.slice(caret)}`
    setText(next)
    setContext(c => (c.some(x => x.kind === 'file' && x.path === path) ? c : [...c, { kind: 'file', path, label: path.split('/').pop() ?? path }]))
    const pos = start + path.length + 2
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = pos; setCaret(pos) } })
  }

  const submit = async () => {
    const body = text.trim()
    if (!body) return
    setText('')
    const ctx = context
    setContext([])
    try {
      await send(body, ctx.length ? ctx : undefined)
    } catch (e) {
      toast((e as Error).message, 'error')
      setText(body)
      setContext(ctx)
    }
  }

  return (
    <div className={`composer ${floating ? 'floating' : ''}`}>
      {context.length > 0 && (
        <div className="ctx-chips editable">
          {context.map((c, i) => (
            <span key={i} className="chip accent">
              {c.label}
              <button onClick={() => setContext(cs => cs.filter((_, j) => j !== i))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {menu.length > 0 && (
        <div className="slash-menu">
          <div className="menu-label">파일을 붙이기</div>
          {menu.map((c, i) => (
            <button key={c} className="menu-item" data-active={i === menuIndex} onMouseDown={e => { e.preventDefault(); pickFile(c) }}>
              <span className="ellipsis grow">{c.split('/').pop()}</span><span className="sub ellipsis" style={{ maxWidth: 220 }}>{c}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder="터미널에 보내기…  @ 파일"
        onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setMenuIndex(0) }}
        onSelect={e => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={e => {
          if (menu.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex(i => (i + 1) % menu.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex(i => (i - 1 + menu.length) % menu.length); return }
            if ((e.key === 'Tab' || e.key === 'Enter') && !e.nativeEvent.isComposing) { e.preventDefault(); pickFile(menu[menuIndex] ?? menu[0]); return }
            if (e.key === 'Escape') { e.preventDefault(); setDismissed(text); return }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="composer-bar">
        <button className="send" disabled={!text.trim()} title="보내기 (⏎)" onClick={() => void submit()}>
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  )
}
