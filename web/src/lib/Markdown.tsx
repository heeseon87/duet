import { memo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import { MermaidBlock } from './MermaidBlock.tsx'

import { Check, Copy } from 'lucide-react'
import { CodeBlock } from './Code.tsx'

// `**굵게**로` keeps its emphasis: CommonMark alone drops it when Korean follows the closing marks.
const PLUGINS = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough]

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="copy iconbtn"
      title="복사"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

/** `path:line` in prose becomes a link the app opens in the review's file view. */
const PATH_LINE = /^([\w./@-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?$/

export type MarkdownProps = { text: string; streaming?: boolean; onOpenPath?: (path: string, line?: number) => void }

export const Markdown = memo(function Markdown({ text, streaming, onOpenPath }: MarkdownProps) {
  const components: Components = {
    code({ className, children, ...rest }) {
      const raw = String(children ?? '')
      const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1]
      const isBlock = Boolean(lang) || raw.includes('\n')
      if (!isBlock) {
        const m = PATH_LINE.exec(raw)
        if (m && onOpenPath && m[1].includes('/')) {
          return <code className="inline link" onClick={() => onOpenPath(m[1], m[2] ? Number(m[2]) : undefined)} {...rest}>{children}</code>
        }
        return <code className="inline" {...rest}>{children}</code>
      }
      if (lang === 'mermaid' && !streaming) return <MermaidBlock code={raw.replace(/\n$/, '')} />
      return (
        <div className="md-code">
          <div className="md-code-head"><span>{lang ?? 'text'}</span><CopyButton text={raw.replace(/\n$/, '')} /></div>
          <CodeBlock code={raw} lang={lang} maxLines={streaming ? undefined : 40} />
        </div>
      )
    },
    pre({ children }) {
      return <>{children}</>
    },
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    },
    table({ children }) {
      return <div className="md-table"><table>{children}</table></div>
    },
  }
  return (
    <div className={`md${streaming ? ' streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components}>{text}</ReactMarkdown>
    </div>
  )
})
