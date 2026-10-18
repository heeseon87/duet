import { useEffect, useRef, useState } from 'react'
import { Code2, Image } from 'lucide-react'

let seq = 0

/** A ```mermaid block drawn as a diagram, with the source one click away. */
export function MermaidBlock({ code }: { code: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [showCode, setShowCode] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (showCode) return
    let live = true
    void (async () => {
      const mermaid = (await import('mermaid')).default
      const dark = document.documentElement.dataset.theme === 'dark'
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', suppressErrorRendering: true } as never)
      const id = `mdm${++seq}`
      try {
        await document.fonts.ready
        const { svg } = await mermaid.render(id, code)
        if (live && box.current) { box.current.innerHTML = svg; setFailed(false) }
      } catch {
        document.getElementById(`d${id}`)?.remove()
        if (live) setFailed(true)
      }
    })()
    return () => { live = false }
  }, [code, showCode])
  return (
    <div className="md-code mermaid-block">
      <div className="md-code-head">
        <span>mermaid</span>
        <button className="copy iconbtn" title={showCode ? '그림으로' : '코드 보기'} onClick={() => setShowCode(s => !s)}>{showCode ? <Image size={13} /> : <Code2 size={13} />}</button>
      </div>
      {showCode || failed ? <pre className="mermaid-src">{code}</pre> : <div className="mermaid-svg" ref={box} />}
    </div>
  )
}
