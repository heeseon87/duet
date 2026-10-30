import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { labelOf, relationKey, stepMark, type CanvasMap } from '../../../shared/canvas.ts'
import { local } from '../state.ts'
import { flowSteps } from './flow.ts'

/**
 * A class map's flow, top left over the map and see-through until the pointer comes: a row under the pointer lights
 * its line, a click picks the step and brings it to the middle. Folded away, it stays a one-line head; remembered.
 */
export function FlowList({ map, selected, onPeek, onPick }: { map: CanvasMap; selected?: string; onPeek: (key: string | undefined) => void; onPick: (key: string) => void }) {
  const steps = useMemo(() => flowSteps(map), [map])
  const [open, setOpen] = useState(() => local.get('canvas.flow') !== '0')
  const list = useRef<HTMLOListElement>(null)
  // Walked with the keys, the picked step stays in view.
  useEffect(() => { list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  if (!steps.length) return null
  const toggle = () => setOpen(o => { local.set('canvas.flow', o ? '0' : '1'); return !o })
  return (
    <div className="flow-list" onMouseLeave={() => onPeek(undefined)}>
      <button className="flow-head" onClick={toggle} title={open ? '흐름 접기' : '흐름 펼치기'}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>흐름</span>
        <span className="muted">{steps.length}</span>
        <span className="grow" />
        <kbd title="이전 단계">[</kbd><kbd title="다음 단계">]</kbd>
      </button>
      {open && (
        <ol ref={list}>
          {steps.map(r => {
            const key = relationKey(r)
            return (
              <li key={key}>
                <button className={`flow-step${key === selected ? ' active' : ''}`} onMouseEnter={() => onPeek(key)} onClick={() => onPick(key)}>
                  <span className="flow-no">{stepMark(r.step!)}</span>
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
