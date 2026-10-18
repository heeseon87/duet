import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

type Options = { title: string; body?: string; ok?: string; danger?: boolean }

function Dialog({ o, done }: { o: Options; done: (v: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [done])
  return (
    <>
      <div className="overlay" onClick={() => done(false)} />
      <div className="confirm" role="alertdialog" aria-modal="true">
        <h3>{o.title}</h3>
        {o.body && <p>{o.body}</p>}
        <div className="row">
          <span className="grow" />
          <button className="btn ghost" onClick={() => done(false)}>취소</button>
          <button ref={okRef} className={`btn ${o.danger ? 'danger-solid' : 'primary'}`} onClick={() => done(true)}>{o.ok ?? '확인'}</button>
        </div>
      </div>
    </>
  )
}

/** An in-app confirm: same look as the rest of Duet, Escape cancels, Enter confirms. */
export function confirmDialog(o: Options): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v: boolean) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<Dialog o={o} done={done} />)
  })
}
