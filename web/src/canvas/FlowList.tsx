import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react'
import { labelOf, relationKey, type CanvasMap } from '../../../shared/canvas.ts'
import { local } from '../state.ts'
import { flowSteps } from './flow.ts'

const MIN_SCALE = 0.6
const MAX_SCALE = 1.4

/**
 * A class map's flow, top left over the map and see-through until the pointer comes: a row under the pointer lights
 * its line, a click picks the step and brings it to the middle. A step's number is in a circle, as on the line's label. Folded away, it stays a one-line head; its size is set
 * like the code's (−·+, ⌘ + wheel). Both remembered.
 */
export function FlowList({ map, selected, onPeek, onPick }: { map: CanvasMap; selected?: string; onPeek: (key: string | undefined) => void; onPick: (key: string) => void }) {
  const steps = useMemo(() => flowSteps(map), [map])
  const [open, setOpen] = useState(() => local.get('canvas.flow') !== '0')
  const [scale, setScale] = useState(() => Number(local.get('canvas.flowScale')) || 1)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const zoom = (next: number) => {
    const s = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) * 100) / 100
    setScale(s)
    local.set('canvas.flowScale', String(s))
  }
  const step = (d: 1 | -1) => zoom(Math.round(scale * 10) / 10 + d * 0.1)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  // Walked with the keys, the picked step stays in view.
  useEffect(() => { list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  // ⌘ + wheel (a pinch on a trackpad) sizes the list, as it does the code.
  const shown = steps.length > 0
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoom(scaleRef.current * Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null
  const toggle = () => setOpen(o => { local.set('canvas.flow', o ? '0' : '1'); return !o })
  return (
    <div className={`flow-list${open ? '' : ' folded'}`} ref={box} style={{ '--flow-scale': scale } as React.CSSProperties} onMouseLeave={() => onPeek(undefined)}>
      <div className="flow-head">
        <button className="flow-toggle" onClick={toggle} title={`${open ? '흐름 접기' : '흐름 펼치기'} · n 다음 단계, p 이전 단계`}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>흐름 {steps.length}</span>
        </button>
        {open && <span className="flow-keys" title="n 다음 단계, p 이전 단계">n · p</span>}
        {open && (
          <div className="flow-zoom">
            <button onClick={() => step(-1)} disabled={scale <= MIN_SCALE} title="흐름 작게 (⌘ + 휠)"><Minus size={11} /></button>
            <button onClick={() => zoom(1)} title="100%로">{Math.round(scale * 100)}%</button>
            <button onClick={() => step(1)} disabled={scale >= MAX_SCALE} title="흐름 크게 (⌘ + 휠)"><Plus size={11} /></button>
          </div>
        )}
      </div>
      {open && (
        <ol ref={list}>
          {steps.map(r => {
            const key = relationKey(r)
            return (
              <li key={key}>
                <button className={`flow-step${key === selected ? ' active' : ''}`} onMouseEnter={() => onPeek(key)} onClick={() => onPick(key)}>
                  <span className="flow-no">{r.step}</span>
                  <span className="flow-text">
                    <span className="flow-ends">{labelOf(map, r.from)} → {labelOf(map, r.to)}</span>
                    {r.label && <span className="flow-label">{r.label}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
