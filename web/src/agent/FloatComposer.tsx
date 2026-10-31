import { useLayoutEffect, useRef, useState } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { useApp, useTranscript } from '../state.ts'
import { useCanvas } from '../canvas/store.ts'
import { Composer } from './Composer.tsx'
import { lastWords, waitLabel } from './transcript.ts'

/**
 * The conversation over the map while the panel is folded: what Claude said last (or what it waits for), a way to the
 * open decisions, and the same draft as the panel's composer. Bottom left, clear of the zoom bar; above it when narrow.
 */
export function FloatComposer() {
  const sideOpen = useApp(s => s.sideOpen)
  const sideWidth = useApp(s => s.sideWidth)
  const setSide = useApp(s => s.setSide)
  const session = useApp(s => s.sessions.find(x => x.id === s.currentSession))
  const terminal = useApp(s => s.terminals.find(x => x.id === s.currentTerminal))
  const currentTerminal = useApp(s => s.currentTerminal)
  const t = useTranscript(currentTerminal ? undefined : session?.id)
  const deciding = useCanvas(s => s.deciding)
  const preview = useCanvas(s => Boolean(s.preview))
  const open = useCanvas(s => (s.map?.decisions ?? []).filter(d => !d.chosen).length)
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ width: number; raised: boolean }>()

  // Beside the zoom bar when there is room for a usable box, otherwise the whole width above it.
  useLayoutEffect(() => {
    const el = box.current, host = el?.parentElement
    if (!el || !host) return
    const fit = () => {
      const h = host.getBoundingClientRect()
      const bar = host.querySelector('.zoom-bar')?.getBoundingClientRect()
      const beside = (bar ? bar.left : h.right) - h.left - 20 - 16
      const raised = beside < 360
      setPlace({ width: Math.min(600, raised ? h.width - 40 : beside), raised })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    const bar = host.querySelector('.zoom-bar')
    if (bar) ro.observe(bar)
    return () => ro.disconnect()
  }, [sideOpen, deciding])

  if (sideOpen || deciding) return null
  const waits = t?.waiting() ?? []
  const said = waits.length ? undefined : t && lastWords(t.blocks)
  const unfold = () => setSide(sideWidth, true)
  const status = currentTerminal ? 'terminal' : session?.status ?? 'idle'
  return (
    <div ref={box} className={`float-composer ${place?.raised ? 'raised' : ''}`} style={{ width: place?.width }}>
      <div className="float-head">
        <span className={`float-who ${status}`}>{currentTerminal ? terminal?.label ?? '터미널' : 'Claude'}</span>
        {waits.length
          ? <button className="float-said wait" title="대화를 펼쳐서 답하기 (⌘3)" onClick={unfold}>{waitLabel(waits)}</button>
          : <button className="float-said" title={said ? `${said.text}\n대화 펼치기 (⌘3)` : '대화 펼치기 (⌘3)'} onClick={unfold}>{said?.text ?? (session?.title || '새 대화')}</button>}
        {open > 0 && !preview && (
          <button className="float-turn" title="열린 결정을 하나씩 정하기" onClick={() => { useApp.getState().closeReader(); useCanvas.getState().setDeciding(true) }}>
            네 차례 · 결정 {open} →
          </button>
        )}
        <button className="iconbtn" title="대화 펼치기 (⌘3)" onClick={unfold}><PanelLeftOpen size={14} /></button>
      </div>
      {currentTerminal ? <Composer terminal floating /> : <Composer session={session} transcript={t} floating />}
    </div>
  )
}
