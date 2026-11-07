import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileCode2, Loader2, Map as MapIcon, MessageSquare, Undo2, X } from 'lucide-react'
import { deliveryLabel, fileOfRef, type CanvasDecision, type CanvasMap } from '../../../shared/canvas.ts'
import { absoluteRef, refBase } from '../../../shared/mapFiles.ts'
import { api, q } from '../api.ts'
import { CodeText, Line, useTokens } from '../lib/Code.tsx'
import { isTypingTarget, shortcutKey } from '../lib/ui.tsx'
import { local, useApp } from '../state.ts'
import { useReview } from '../review/store.ts'
import { addedLines } from '../review/diffModel.ts'
import { linesOf, sourceOf, targetOf, type Source } from './codeLinks.ts'
import { chatsAbout } from '../../../shared/side.ts'
import { SideThread } from '../side/SideThread.tsx'
import { useSide } from '../side/store.ts'
import { Ask, DeliveryLine, ThreadView, WhyAsk, letterOf } from './DecisionParts.tsx'
import { MermaidStage, type StageHandle } from './MermaidStage.tsx'
import { nextDecision, optionShare } from './decisionQueue.ts'
import { pendingOf, useCanvas } from './store.ts'

/** 을/를 and 이/가 after a decision id as it is read (D1 일, D2 이, D10 십): its last digit says. */
const closed = (id: string) => /[013678]$/.test(id)
const eul = (id: string) => `${id}${closed(id) ? '을' : '를'}`
const iga = (id: string) => `${id}${closed(id) ? '이' : '가'}`

/** How long a choice can be taken back from its bar; once it is gone, what was kept for Claude goes. */
const UNDO_MS = 8000

/** The decision itself keeps at least this much room between the list and the side. */
const MAIN_MIN = 360

/**
 * A column's width, dragged by its edge (the list's right one, the side's left one) and remembered; a double click
 * gives the layout back its own width. Unset, the CSS decides, and CSS also keeps the decision its room as the window
 * narrows.
 */
function useColumn(key: string, edge: 'right' | 'left', min: number, max: (box: DOMRect, own: HTMLElement) => number) {
  const [width, setWidth] = useState(() => Number(local.get(key)) || undefined)
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    const handle = e.currentTarget, own = handle.parentElement, box = handle.closest('.decide')?.getBoundingClientRect()
    if (!own || !box) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('dragging')
    const ownBox = own.getBoundingClientRect()
    let last: number | undefined
    const move = (m: PointerEvent) => {
      const raw = edge === 'right' ? m.clientX - ownBox.left : ownBox.right - m.clientX
      last = Math.round(Math.max(min, Math.min(raw, max(box, own))))
      setWidth(last)
    }
    const up = () => {
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      if (last !== undefined) local.set(key, String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  const reset = () => { local.set(key, ''); setWidth(undefined) }
  return { width, handle: <div className={`dm-split ${edge}`} onPointerDown={drag} onDoubleClick={reset} title="끌어서 폭 조절, 더블클릭하면 처음 폭으로" /> }
}

/**
 * Decision mode: the open decisions one after another over the canvas. Each choice lands on the map at once; what
 * Claude should hear is kept and told together when the last is made or the mode closes (`flushDecisions`).
 */
export function DecisionMode({ map, start, stageKey, onClose }: { map: CanvasMap; start?: string; stageKey: string; onClose: () => void }) {
  const decisions = map.decisions ?? []
  const decide = useCanvas(s => s.decide), undoDecide = useCanvas(s => s.undoDecide), choose = useCanvas(s => s.choose)
  const flush = useCanvas(s => s.flushDecisions)
  const threads = useCanvas(s => s.threads)
  const mapName = useCanvas(s => s.mapName)
  const chats = useSide(s => s.chats)
  const [current, setCurrent] = useState(() => (start && decisions.some(d => d.id === start && !d.chosen) ? start : nextDecision(decisions, undefined, [])))
  const [later, setLater] = useState<string[]>([])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [why, setWhy] = useState('')
  const [send, setSendRaw] = useState(() => local.get('canvas.decideSend') !== '0')
  const setSend = (on: boolean) => { local.set('canvas.decideSend', on ? '1' : '0'); setSendRaw(on) }
  const [asking, setAsking] = useState(false)
  // `moved`: the map got another revision since, so the choice is reopened instead of taken back.
  const [undo, setUndo] = useState<{ decision: string; option: string; revision: number; moved?: boolean }>()
  const [busy, setBusy] = useState(false)
  const whyInput = useRef<HTMLInputElement>(null)
  const listCol = useColumn('canvas.decideList', 'right', 180, () => 400)
  // The list, when shown, sits beside the side too; hidden, its width is 0.
  const sideCol = useColumn('canvas.decideSide', 'left', 280, (box, own) => box.width - (own.parentElement?.querySelector('.dm-list')?.getBoundingClientRect().width ?? 0) - MAIN_MIN)

  const d = decisions.find(x => x.id === current && !x.chosen)
  const pick = d ? (picks[d.id] ?? d.recommended) : undefined
  const setPick = (o: string) => d && setPicks(p => ({ ...p, [d.id]: o }))
  const made = decisions.filter(x => x.chosen).length
  const allMade = decisions.length > 0 && made === decisions.length

  const go = async () => {
    if (!d || !pick || busy) return
    setBusy(true)
    try {
      const revision = await decide(d.id, pick, why.trim() || undefined, send)
      if (revision === undefined) return
      setUndo({ decision: d.id, option: pick, revision })
      const after = decisions.map(x => (x.id === d.id ? { ...x, chosen: pick } : x))
      setLater(l => l.filter(x => x !== d.id))
      setCurrent(nextDecision(after, d.id, later.filter(x => x !== d.id)))
      setWhy('')
      setAsking(false)
    } finally { setBusy(false) }
  }
  const putOff = () => {
    if (!d) return
    const l = [...later.filter(x => x !== d.id), d.id]
    setLater(l)
    setCurrent(nextDecision(decisions, d.id, l))
    setWhy('')
    setAsking(false)
  }
  const reopen = async (id: string) => {
    await choose(id, null)
    setUndo(undefined)
    setCurrent(id)
  }
  const takeBack = async () => {
    if (!undo) return
    const ok = await undoDecide(undo.decision, undo.revision)
    if (!ok) { setUndo({ ...undo, moved: true }); return }
    setPicks(p => ({ ...p, [undo.decision]: undo.option }))
    setCurrent(undo.decision)
    setUndo(undefined)
  }

  // The undo bar goes after a while; with every decision made, that is when Claude hears of them.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(undefined), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])
  useEffect(() => { if (allMade && !undo) void flush(true) }, [allMade, undo, flush])
  // Closing the mode (or leaving for another map) tells Claude what is left of this map's.
  useEffect(() => {
    const name = useCanvas.getState().mapName
    return () => { void useCanvas.getState().flushDecisions(false, name) }
  }, [])

  const keys = useRef({ go, putOff, setPick, onClose, d, asking })
  keys.current = { go, putOff, setPick, onClose, d, asking }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useApp.getState().tab !== 'canvas' || e.metaKey || e.ctrlKey || e.altKey) return
      const k = keys.current
      const typing = isTypingTarget(e.target)
      if (e.key === 'Escape') {
        e.preventDefault()
        if (typing) (e.target as HTMLElement).blur()
        else if (k.asking) setAsking(false)
        else k.onClose()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (!typing || e.target === whyInput.current)) { e.preventDefault(); void k.go(); return }
      if (typing || !k.d) return
      const key = shortcutKey(e)
      const n = Number(key)
      if (n >= 1 && n <= k.d.options.length) { e.preventDefault(); k.setPick(k.d.options[n - 1].id) }
      else if (key === 'l') { e.preventDefault(); k.putOff() }
      else if (key === 'q') { e.preventDefault(); setAsking(a => !a) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const index = d ? decisions.findIndex(x => x.id === d.id) : -1
  const asked = d ? threads.filter(t => t.target === d.id || d.options.some(o => o.id === t.target)) : []
  const sideChats = d && mapName ? chatsAbout(chats, mapName, d) : []
  const askSide = (text: string) => (d && mapName ? useSide.getState().ask({ text, about: { map: mapName, target: pick ?? d.id } }).then(Boolean) : Promise.resolve(false))
  return (
    <div className="decide" role="dialog" aria-label="결정 모드"
      style={{ ...(listCol.width ? { '--dm-list': `${listCol.width}px` } : {}), ...(sideCol.width ? { '--dm-side': `${sideCol.width}px` } : {}) } as React.CSSProperties}>
      <aside className="dm-list">
        {listCol.handle}
        <div className="dm-head"><b>결정 {decisions.length}개</b><span className="dm-count">{made} 정함 · {decisions.length - made} 남음</span></div>
        <div className="dm-bar"><i style={{ width: `${decisions.length ? (made / decisions.length) * 100 : 0}%` }} /></div>
        <div className="dm-items">
          {decisions.map(x => {
            const chosen = x.options.find(o => o.id === x.chosen)
            return (
              <button key={x.id} className={`dm-item${x.id === d?.id ? ' on' : ''}${chosen ? ' made' : ''}`} data-decision={x.id}
                onClick={() => { if (!chosen) setCurrent(x.id) }} title={chosen ? `${x.question} → ${chosen.text}` : x.question}>
                <span className="dm-disc">{chosen ? <Check size={13} /> : x.id}</span>
                <span className="dm-item-text">
                  <b>{x.id} · {x.question}</b>
                  <small>{chosen ? `${letterOf(x, chosen.id)} · ${chosen.text}` : `${x.options.length}안${x.recommended ? ` · 추천 ${letterOf(x, x.recommended)}` : ''}${later.includes(x.id) ? ' · 나중에' : ''}`}</small>
                </span>
              </button>
            )
          })}
        </div>
        <p className="dm-note">{allMade ? '정한 결정은 오른쪽 요약에서 다시 열 수 있어.' : send ? '다 정하면 Claude가 고른 쪽으로 지도와 코드를 이어서 고쳐.' : 'Claude에게 보내기를 끄고 정하면 지도에만 남아.'}</p>
        <button className="dm-back" onClick={onClose}>지도로 돌아가기 <kbd>esc</kbd></button>
      </aside>

      <main className="dm-main">
        {d ? (
          <>
            <div className="dm-step"><span className="dm-disc big">{d.id}</span>결정 {index + 1} / {decisions.length}</div>
            <h2 className="dm-q">{d.question}</h2>
            {d.why && <WhyAsk why={d.why} />}
            <div className={`dm-options${d.options.length === 2 ? ' two' : ''}`} role="radiogroup">
              {d.options.map((o, i) => {
                const n = optionShare(map, d.id, o.id).elements.length
                return (
                  <div key={o.id} role="radio" tabIndex={0} aria-checked={pick === o.id} data-option={o.id} className={`dm-option${pick === o.id ? ' on' : ''}`}
                    onClick={() => setPick(o.id)} onKeyDown={e => { if (e.target === e.currentTarget && e.key === ' ') { e.preventDefault(); setPick(o.id) } }}>
                    <span className="dm-radio" />
                    <div className="dm-opt">
                      <div className="dm-opt-head">
                        <span className="opt-letter">{letterOf(d, o.id)}</span>
                        <span className="dm-opt-text">{o.text}</span>
                        {d.recommended === o.id && <span className="dm-rec">Claude 추천</span>}
                        <span className="grow" />
                        <kbd>{i + 1}</kbd>
                      </div>
                      {o.impact && <div className="dm-opt-impact">{o.impact}</div>}
                      {n > 0 && <div className="dm-opt-parts">지도에서 {n}곳</div>}
                    </div>
                  </div>
                )
              })}
            </div>
            {asking && (
              <div className="dm-ask">
                <div className="dm-ask-head"><MessageSquare size={13} /> {pick ? `${letterOf(d, pick)}안에 대해` : `${d.id}에 대해`} Claude에게 묻기<span className="grow" /><button className="iconbtn" title="닫기 (esc)" onClick={() => setAsking(false)}><X size={13} /></button></div>
                <div className="dm-ask-note muted">곁질문이야. 결정을 연 Claude가 하던 일을 멈추지 않고 지금까지의 대화로만 바로 답하고, 대화 기록에는 남지 않아. 결정을 보낼 때 함께 전해져.</div>
                <Ask side={askSide} target={pick ?? d.id} autoFocus placeholder="이 선택지에서 궁금한 점 적기" onSent={() => setAsking(false)} />
              </div>
            )}
            {sideChats.map(c => <SideThread key={c.id} chat={c} compact />)}
            {asked.map(t => <ThreadView key={t.id} t={t} />)}
            <input ref={whyInput} className="input dm-why" placeholder="고른 이유 (선택)" value={why} onChange={e => setWhy(e.target.value)} />
            <div className="dm-actions">
              <button className="btn primary dm-go" disabled={!pick || busy} onClick={() => void go()}>
                {!pick ? '하나 골라 줘' : pick === d.recommended ? `추천대로 ${letterOf(d, pick)}로 결정` : `${letterOf(d, pick)}로 결정`} <kbd>⏎</kbd>
              </button>
              <button className="btn dm-later" onClick={putOff}>나중에 <kbd>l</kbd></button>
              <button className="btn dm-asking" aria-pressed={asking} onClick={() => setAsking(a => !a)}>Claude에게 묻기 <kbd>q</kbd></button>
              <span className="grow" />
              <label className="toggle"><input type="checkbox" checked={send} onChange={e => setSend(e.target.checked)} /> Claude에게 보내기</label>
            </div>
          </>
        ) : (
          <Summary decisions={decisions} waiting={undo ? pendingOf(useApp.getState().workspace?.path ?? '', useCanvas.getState().mapName ?? '').ids.length : 0} onReopen={id => void reopen(id)} onClose={onClose} />
        )}
        {undo && (
          <div className="dm-undo" role="status">
            {undo.moved ? <>그 뒤로 지도가 바뀌어서 되돌릴 수 없어</> : <><Check size={14} /> {eul(undo.decision)} {undo.option.replace(`${undo.decision}-`, '')}로 정했어</>}
            {undo.moved
              ? <button className="link-btn" onClick={() => void reopen(undo.decision)}><Undo2 size={13} /> {undo.decision} 다시 열기</button>
              : <button className="link-btn" onClick={() => void takeBack()}><Undo2 size={13} /> 되돌리기</button>}
            <button className="iconbtn" title="닫기" onClick={() => setUndo(undefined)}><X size={12} /></button>
          </div>
        )}
      </main>

      <Aside map={map} d={d} pick={pick} onPick={setPick} stageKey={stageKey} split={sideCol.handle} />
    </div>
  )
}

/** Every decision made: what each became, where Claude is with them, and the way back. */
function Summary({ decisions, waiting, onReopen, onClose }: { decisions: CanvasDecision[]; waiting: number; onReopen: (id: string) => void; onClose: () => void }) {
  const threads = useCanvas(s => s.threads), deliveries = useCanvas(s => s.deliveries)
  const ids = new Set(decisions.map(x => x.id))
  // The latest choice told to Claude from this map, and where it stands.
  const told = threads.filter(t => ids.has(t.target)).flatMap(t => t.items).filter(i => deliveries[i.id]).sort((a, b) => a.ts - b.ts).pop()
  return (
    <div className="dm-summary">
      <div className="dm-step">결정 {decisions.length} / {decisions.length} · 끝</div>
      <h2 className="dm-q">{decisions.length ? `결정 ${decisions.length}개를 다 정했어` : '이 지도에는 결정이 없어'}</h2>
      {decisions.map(x => {
        const chosen = x.options.find(o => o.id === x.chosen)
        if (!chosen) return null
        return (
          <div key={x.id} className="dm-done" data-decision={x.id}>
            <span className="dm-disc made"><Check size={13} /></span>
            <div className="grow">
              <div className="dm-done-id">{x.id}</div>
              <div className="dm-done-q">{x.question}</div>
              <div className="dm-done-a">→ {letterOf(x, chosen.id)} · {chosen.text}</div>
              <div className="dm-done-why">{x.rationale ? `이유 ${x.rationale}` : '이유 없음'}</div>
              <DeliveryLine target={x.id} />
            </div>
            <button className="btn sm" onClick={() => onReopen(x.id)}>다시 열기</button>
          </div>
        )
      })}
      <div className="dm-claude">
        {waiting > 0 ? <><b>Claude에게 보낼 결정 {waiting}개</b><span>되돌리기가 사라지면 한 번에 보내.</span></>
          : told ? <><b>Claude · {deliveryLabel(deliveries[told.id])}</b><span>정한 결정을 받아서 지도와 코드를 고쳐. 끝나면 지도에 새 rev가 생기고, 바뀐 상자에 △ 표시가 붙어.</span></>
          : <><b>Claude에게 보내지 않았어</b><span>정한 결정은 지도에만 남았어. 이어서 맡기려면 터미널에서 알려 줘.</span></>}
      </div>
      <div className="dm-actions">
        <button className="btn primary" onClick={onClose}>지도로 돌아가기 <kbd>esc</kbd></button>
      </div>
    </div>
  )
}

/** Beside the decision: the map with the option's share lit, or the code it touches. */
function Aside({ map, d, pick, onPick, stageKey, split }: { map: CanvasMap; d?: CanvasDecision; pick?: string; onPick: (o: string) => void; stageKey: string; split: React.ReactNode }) {
  const [tab, setTabRaw] = useState(() => (local.get('canvas.decideTab') === 'code' ? 'code' : 'map'))
  const setTab = (t: 'map' | 'code') => { local.set('canvas.decideTab', t); setTabRaw(t) }
  return (
    <section className="dm-side">
      {split}
      <div className="dm-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}><MapIcon size={13} /> 지도</button>
        <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}><FileCode2 size={13} /> 코드</button>
        {d && (
          <span className="dm-opt-switch">
            {d.options.map(o => <button key={o.id} aria-pressed={pick === o.id} onClick={() => onPick(o.id)}>{letterOf(d, o.id)}</button>)}
          </span>
        )}
      </div>
      {tab === 'map' ? <AsideMap map={map} d={d} pick={pick} stageKey={stageKey} /> : <AsideCode map={map} d={d} pick={pick} />}
    </section>
  )
}

function AsideMap({ map, d, pick, stageKey }: { map: CanvasMap; d?: CanvasDecision; pick?: string; stageKey: string }) {
  const collapsed = useCanvas(s => s.collapsed), toggle = useCanvas(s => s.toggleCollapse)
  const stage = useRef<StageHandle>(null)
  const target = d ? (pick ?? d.id) : undefined
  const ids = useMemo(() => {
    if (!d) return []
    // The boxes the option alone brings, else all it shares with the decision; lines only when there is no box (their
    // far ends would pull the view wide). Everything it shares is lit either way.
    const s = optionShare(map, d.id, pick ?? '')
    const mine = pick ? [...s.elements.filter(e => e.option === pick).map(e => e.id), ...s.messages.filter(m => m.option === pick).map(m => m.id)] : []
    const own = [...s.elements.map(e => e.id), ...s.messages.map(m => m.id)]
    return mine.length ? mine : own.length ? own : s.relations.flatMap(r => [r.from, r.to])
  }, [map, d, pick])
  // A new option (or decision) brings its share to the middle: at once on a drawn map, else once it is drawn.
  useEffect(() => { if (ids.length) stage.current?.frame(ids, !stage.current.svg()) }, [ids.join(' ')]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="dm-map">
      <MermaidStage ref={stage} viewKey={`${stageKey}:decide`} aside map={map} collapsed={collapsed} selected={target} threads={[]}
        onSelect={() => {}} onToggleGroup={toggle} />
      <div className="dm-map-note muted">{d ? (ids.length ? `${pick ? `${letterOf(d, pick)}안이` : iga(d.id)} 만드는 곳이 밝아져` : '지도에 이 결정이 표시된 곳이 없어') : '정한 결정은 지도에서 초록 핀으로 보여'}</div>
    </div>
  )
}

/** The real code the option touches: each file its parts name, around the lines they point at. */
function AsideCode({ map, d, pick }: { map: CanvasMap; d?: CanvasDecision; pick?: string }) {
  const workspace = useApp(s => s.workspace?.path ?? '')
  const codeRoot = useCanvas(s => s.code?.root), mapName = useCanvas(s => s.mapName)
  const diff = useReview(s => s.diff), root = useReview(s => s.root), bound = useReview(s => s.bound), editing = useReview(s => s.editing)
  if (!d) {
    // Every decision made: the files the choices reach, each with the decisions that reach it.
    const byFile = new Map<string, string[]>()
    for (const x of map.decisions ?? []) {
      if (!x.chosen) continue
      for (const e of optionShare(map, x.id, x.chosen).elements) for (const f of e.files ?? []) byFile.set(fileOfRef(f), [...new Set([...(byFile.get(fileOfRef(f)) ?? []), x.id])])
    }
    if (!byFile.size) return <div className="dm-code-empty muted">정한 결정이 만든 상자에 파일이 묶이지 않았어.</div>
    return (
      <div className="dm-code">
        <div className="dm-code-head muted">정한 결정으로 바뀔 곳</div>
        {[...byFile].map(([f, ds]) => <div key={f} className="dm-file"><span className="dm-snippet-path" title={f}>{f.split('/').slice(-3).join('/')}</span><span className="muted">{ds.join('·')}</span></div>)}
      </div>
    )
  }
  const parts = optionShare(map, d.id, pick ?? '').elements.filter(e => e.files?.length)
  const refs = parts.flatMap(e => (e.files ?? []).map(ref => ({ el: e, ref })))
  if (!refs.length) return <div className="dm-code-empty muted">{pick ? `${letterOf(d, pick)}안이` : iga(d.id)} 만드는 상자에 파일이 묶이지 않았어.</div>
  return (
    <div className="dm-code">
      <div className="dm-code-head muted">{pick ? `${letterOf(d, pick)}를 고르면 바뀌는 곳` : `${iga(d.id)} 건드리는 곳`} · 저장소의 실제 코드</div>
      {refs.map(({ el, ref }) => {
        const source = sourceOf(absoluteRef(refBase(workspace, codeRoot), ref), workspace, mapName, { root, diff, bound, editing }, codeRoot)
        return <Snippet key={`${el.id}:${ref}`} label={el.label ?? el.id} names={[el.id, el.label ?? '']} refText={ref} source={source} />
      })}
    </div>
  )
}

/** Lines shown around what a reference points at, or around the declaration when it points at none. */
const AROUND = 3, SPAN_MAX = 40, PLAIN = 14

function Snippet({ label, names, refText, source }: { label: string; names: string[]; refText: string; source?: Source }) {
  const diff = useReview(s => s.diff)
  const [file, setFile] = useState<{ text?: string; missing?: boolean }>()
  const key = source ? `${source.root}\0${source.ref}\0${source.path}` : ''
  useEffect(() => {
    if (!source) return
    let live = true
    setFile(undefined)
    api.get<{ exists: boolean; text: string }>(`/api/git/file${q({ ws: source.root, ref: source.ref, path: source.path })}`)
      .then(r => { if (live) setFile({ text: r.text, missing: !r.exists }) })
      .catch(() => { if (live) setFile({ missing: true }) })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = file?.text
  const lines = useMemo(() => (text ?? '').replace(/\n$/, '').split('\n'), [text])
  const tokens = useTokens(text ?? '', source?.path)
  const span = linesOf(refText)
  const decl = text !== undefined && !span ? targetOf(lines, fileOfRef(refText), refText, { names, kind: 'type', soft: true }).rows?.[0] : undefined
  const [from, to] = span ?? (decl ? [decl, decl] : [1, 0])
  const first = Math.max(1, (span || decl ? from : 1) - (span ? AROUND : 1))
  const last = Math.min(lines.length, span ? Math.min(to + AROUND, from + SPAN_MAX) : decl ? decl + PLAIN : PLAIN)
  const changed = useMemo(() => addedLines(source?.marks ? diff?.files.find(x => x.path === source.path) : undefined), [source?.marks, source?.path, diff])
  return (
    <div className="dm-snippet">
      <div className="dm-snippet-head"><b>{label}</b><span className="dm-snippet-path" title={source?.path ?? fileOfRef(refText)}>{(source?.path ?? fileOfRef(refText)).split('/').slice(-3).join('/')}</span>
        {source && <span className="muted">{source.ref === 'WORKTREE' ? 'Working tree' : source.ref.slice(0, 7)}</span>}</div>
      {!source ? <div className="dm-code-empty muted">작업 공간 밖의 파일이라 여기서 열 수 없어.</div>
        : !file ? <div className="dm-code-empty"><Loader2 className="spin" size={14} /></div>
        : file.missing ? <div className="dm-code-empty muted">아직 없는 파일이야. 이 선택지로 새로 생길 수 있어.</div>
        : (
          <table className="diff unified hl">
            <colgroup><col className="c-no" /><col /></colgroup>
            <tbody>
              {lines.slice(first - 1, last).map((l, i) => {
                const no = first + i, words = changed.get(no)
                return (
                  <tr key={no} className={`line ctx${no >= from && no <= to ? ' target' : ''}${changed.has(no) ? ' changed' : ''}`}>
                    <td className="no">{no}</td>
                    <td className="code">{words ? <CodeText tokens={tokens[no - 1]} text={l} words={words} kind="add" /> : <Line tokens={tokens[no - 1]} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </div>
  )
}
