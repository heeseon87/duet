import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Square, X, ListPlus, Gauge, Cpu, ShieldCheck, Eye } from 'lucide-react'
import type { ContextItem, Effort, PermissionMode, SessionInfo } from '../../../shared/protocol.ts'
import { useApp } from '../state.ts'
import { Popover, compact } from '../lib/ui.tsx'
import type { Transcript } from './transcript.ts'
import { fuzzy, repoFiles } from '../lib/files.ts'
import { sourceLabel, useReview } from '../review/store.ts'
import { listedFiles } from '../review/mapGroups.ts'
import { useCanvas } from '../canvas/store.ts'
import { mapView, reviewView, takesView } from './view.ts'

const MODELS: { id: string | null; label: string }[] = [
  { id: null, label: 'default' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
]

const MODE_LABEL: Record<PermissionMode, string> = { default: 'ask', acceptEdits: 'edit', auto: 'auto', plan: 'plan', bypassPermissions: 'bypass', dontAsk: 'dontAsk' }
// plan and bypass are not offered; a conversation the API or the agent put there still shows its mode.
const MODES: PermissionMode[] = ['default', 'acceptEdits', 'auto']

const EFFORTS: (Effort | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max']

export function modelLabel(id?: string | null): string {
  if (!id) return 'default'
  return MODELS.find(m => m.id === id)?.label ?? id.replace(/^claude-/, '')
}

export const modeLabel = (mode: string): string => MODE_LABEL[mode as PermissionMode] ?? mode

function Picker<T>({ icon, label, items, current, onPick, render }: {
  icon: React.ReactNode; label: string; items: T[]; current: T; onPick: (v: T) => void; render: (v: T) => string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} className="pick" onClick={() => setOpen(o => !o)}>{icon}<span>{label}</span><ChevronDown size={11} /></button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={250}>
          {items.map((it, i) => (
            <button key={i} className="menu-item" aria-checked={it === current} onClick={() => { onPick(it); setOpen(false) }}>
              <span className="grow">{render(it)}</span>
              {it === current && <span className="sub">✓</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

/** What the stage shows, as a context item derived live; `key` names the view (tab, tree, source, scope or map) a dismissal holds for. */
function useView(): { key?: string; item?: ContextItem } {
  const tab = useApp(s => s.tab)
  const reading = useApp(s => Boolean(s.reader))
  const root = useReview(s => s.root)
  const source = useReview(s => s.source)
  const diff = useReview(s => s.diff)
  const scope = useReview(s => s.scope)
  const filter = useReview(s => s.filter)
  const name = useCanvas(s => s.name)
  const map = useCanvas(s => s.preview?.map ?? s.map)
  const revision = useCanvas(s => s.preview?.revision ?? s.revision)
  const selected = useCanvas(s => s.selected)
  return useMemo(() => {
    if (reading) return {}
    if (tab === 'review') {
      if (!root) return {}
      const key = `review ${root} ${JSON.stringify(source)} ${scope?.target ?? ''}`
      return { key, item: diff && reviewView(diff, root, listedFiles(diff.files, root, scope, filter), sourceLabel(source), scope?.label) }
    }
    if (!name || !map) return {}
    return { key: `canvas ${name}`, item: mapView(map, name, revision, selected) }
  }, [reading, tab, root, source, diff, scope, filter, name, map, revision, selected])
}

/** `terminal`: what is typed goes to a terminal, whose model and mode are its own. */
export function Composer({ session, transcript, terminal }: { session?: SessionInfo; transcript?: Transcript; terminal?: boolean }) {
  const send = useApp(s => s.send)
  const interrupt = useApp(s => s.interrupt)
  const configure = useApp(s => s.configure)
  const toast = useApp(s => s.toast)
  const draft = useApp(s => s.draft)
  const prefs = useApp(s => s.prefs)
  // No conversation yet: the pickers show (and set) what the first one will start with.
  const model = session ? session.model ?? null : prefs.model
  const mode = session ? session.permissionMode : prefs.permissionMode
  const effort = session ? session.effort ?? null : prefs.effort
  const [text, setText] = useState('')
  const [context, setContext] = useState<ContextItem[]>([])
  const [images, setImages] = useState<{ mediaType: string; data: string; url: string; name: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const addFiles = async (files: FileList | File[]) => {
    const picked = [...files].filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type))
    if (!picked.length) return
    const big = picked.find(f => f.size > 5 * 1024 * 1024)
    if (big) { toast(`5MB가 넘어: ${big.name}`, 'error'); return }
    const read = await Promise.all(picked.map(f => new Promise<{ mediaType: string; data: string; url: string; name: string }>(resolve => {
      const r = new FileReader()
      r.onload = () => { const url = String(r.result); resolve({ mediaType: f.type, data: url.split(',')[1] ?? '', url, name: f.name || '붙인 이미지' }) }
      r.readAsDataURL(f)
    })))
    setImages(cur => [...cur, ...read].slice(0, 6))
    ref.current?.focus()
  }
  const [slashIndex, setSlashIndex] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const running = session?.status === 'running' || session?.status === 'waiting' || session?.status === 'starting'

  useEffect(() => {
    if (!draft) return
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); ref.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const commands = useMemo(() => {
    const list = (transcript?.init?.slash_commands as string[] | undefined) ?? ['compact', 'clear', 'review', 'init']
    return list
  }, [transcript?.init])
  const slash = /^\/(\S*)$/.exec(text)
  const slashMatches = slash ? commands.filter(c => c.startsWith(slash[1])).slice(0, 8) : []

  // `@part` right before the caret: offer repo files.
  const [caret, setCaret] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [dismissed, setDismissed] = useState<string | null>(null)
  const mention = dismissed === text ? null : /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  useEffect(() => {
    if (mention && session) void repoFiles(session.workspace).then(setFiles).catch(() => undefined)
  }, [Boolean(mention), session?.workspace]) // eslint-disable-line react-hooks/exhaustive-deps
  const mentionMatches = mention
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
  const menu = mentionMatches.length ? mentionMatches : slashMatches
  const menuIsFiles = mentionMatches.length > 0

  const view = useView()
  const [hidden, setHidden] = useState<string>()
  // A dismissal lasts while the same view is on screen; any other view, or another tab, brings the chip back.
  useEffect(() => { setHidden(h => (h === view.key ? h : undefined)) }, [view.key])
  const seen = view.item && hidden !== view.key && takesView(text) ? view.item : undefined

  const submit = async () => {
    const body = text.trim()
    if (!body && !images.length) return
    setText('')
    const manual = context, imgs = images
    const ctx = seen ? [...manual, seen] : manual
    setContext([])
    setImages([])
    try {
      await send(body, ctx.length ? ctx : undefined, imgs.length ? imgs.map(i => ({ mediaType: i.mediaType, data: i.data })) : undefined)
    } catch (e) {
      toast((e as Error).message, 'error')
      setText(body)
      setContext(manual)
      setImages(imgs)
    }
  }

  const used = session?.contextTokens
  const room = session?.contextWindow
  const pct = used && room ? Math.min(100, Math.round((used / room) * 100)) : undefined
  const full = Boolean(used && room && used / room > 0.8)

  return (
    <div
      className={`composer ${running ? 'running' : ''} ${dragging ? 'dropping' : ''}`}
      onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files) } }}
    >
      {images.length > 0 && (
        <div className="img-chips">
          {images.map((img, i) => (
            <span key={i} className="img-chip" title={img.name}>
              <img src={img.url} alt="" />
              <button onClick={() => setImages(cur => cur.filter((_, j) => j !== i))} title="빼기"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {(context.length > 0 || seen) && (
        <div className="ctx-chips editable">
          {context.map((c, i) => (
            <span key={i} className="chip accent">
              {c.label}
              <button onClick={() => setContext(cs => cs.filter((_, j) => j !== i))}><X size={10} /></button>
            </span>
          ))}
          {seen && (
            <span className="chip view" title={`${seen.kind === 'map-view' ? '지금 보는 지도' : '지금 보는 리뷰'} · 보내면 같이 가`}>
              <Eye size={11} /><span className="ellipsis">{seen.label}</span>
              <button onClick={() => setHidden(view.key)} title="이 화면에서는 빼기"><X size={10} /></button>
            </span>
          )}
        </div>
      )}
      {menu.length > 0 && (
        <div className="slash-menu">
          {menuIsFiles && <div className="menu-label">파일을 대화에 붙이기</div>}
          {menu.map((c, i) => (
            <button key={c} className="menu-item" data-active={i === slashIndex} onMouseDown={e => { e.preventDefault(); if (menuIsFiles) pickFile(c); else setText(`/${c} `) }}>
              {menuIsFiles ? <><span className="ellipsis grow">{c.split('/').pop()}</span><span className="sub ellipsis" style={{ maxWidth: 220 }}>{c}</span></> : `/${c}`}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder={terminal ? '터미널에 보내기…' : running ? '끝나면 이어서 보낼 말…' : '에이전트에게 말하기…  / 명령 · @ 파일'}
        onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setSlashIndex(0) }}
        onSelect={e => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onPaste={e => {
          const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'))
          if (files.length) { e.preventDefault(); void addFiles(files) }
        }}
        onKeyDown={e => {
          if (menuIsFiles) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % menu.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + menu.length) % menu.length); return }
            if ((e.key === 'Tab' || e.key === 'Enter') && !e.nativeEvent.isComposing) { e.preventDefault(); pickFile(menu[slashIndex] ?? menu[0]); return }
            if (e.key === 'Escape') { e.preventDefault(); setDismissed(text); return }
          }
          if (slashMatches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashMatches.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length); return }
            if (e.key === 'Tab') { e.preventDefault(); setText(`/${slashMatches[slashIndex]} `); return }
            // Enter on a partial command completes it; on a full one it sends.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && text !== `/${slashMatches[slashIndex]}`) { e.preventDefault(); setText(`/${slashMatches[slashIndex]} `); return }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape' && running) { e.preventDefault(); void interrupt() }
        }}
      />
      <div className="composer-bar">
        {!terminal && <>
          <Picker
            icon={<Cpu size={12} />}
            label={modelLabel(model)}
            items={MODELS.map(m => m.id)}
            current={model}
            onPick={id => void configure({ model: id }).catch(e => toast((e as Error).message, 'error'))}
            render={modelLabel}
          />
          <Picker
            icon={<ShieldCheck size={12} />}
            label={modeLabel(mode)}
            items={MODES}
            current={mode}
            onPick={id => void configure({ permissionMode: id }).catch(e => toast((e as Error).message, 'error'))}
            render={modeLabel}
          />
          <Picker
            icon={<Gauge size={12} />}
            label={effort ?? 'default'}
            items={EFFORTS}
            current={effort}
            onPick={v => void configure({ effort: v }).catch(e => toast((e as Error).message, 'error'))}
            render={v => v ?? 'default'}
          />
        </>}
        <span className="grow" />
        {used ? (
          <span
            className={`meter ${full ? 'full' : ''}`}
            title={`Context ${compact(used)}${room ? ` / ${compact(room)}` : ''} tokens${full ? '\n거의 찼어. /compact로 요약할 수 있어.' : ''}`}
          >
            {pct !== undefined && <span className="bar"><i style={{ width: `${Math.max(2, pct)}%` }} /></span>}
            {pct !== undefined ? `${pct}%` : compact(used)}
          </span>
        ) : null}
        {running && (
          <button className="send stop" title="중단 (esc)" onClick={() => void interrupt()}><Square size={11} fill="currentColor" /></button>
        )}
        <button className="send" disabled={!text.trim() && !images.length} title={running ? '대기열에 넣기 (⏎)' : '보내기 (⏎)'} onClick={() => void submit()}>
          {running ? <ListPlus size={15} /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  )
}
