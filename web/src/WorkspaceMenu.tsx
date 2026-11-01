import { useRef, useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { useApp } from './state.ts'
import { Popover } from './lib/ui.tsx'
import { RepoPicker } from './lib/RepoPicker.tsx'
import { useReview } from './review/store.ts'

/** The workspace (repo · branch) at the start of the canvas's and the review's head line: a click picks another. */
export function WorkspaceMenu() {
  const { workspace, workspaces, openWorkspace, toast } = useApp()
  const info = useReview(s => s.homeInfo)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!workspace) return null
  const go = async (p: string) => {
    try { await openWorkspace(p); setOpen(false) } catch (e) { toast((e as Error).message, 'error') }
  }
  const worktrees = info?.worktrees.filter(w => !w.bare) ?? []
  return (
    <>
      <button ref={ref} className="ws-pick" onClick={() => setOpen(o => !o)} title={workspace.path}>
        {workspace.name.includes(' / ')
          ? <span className="ws-name"><span className="repo">{workspace.name.split(' / ')[0]}</span><span className="slash">/</span><b>{workspace.name.split(' / ')[1]}</b></span>
          : <span className="ws-name"><b>{workspace.name}</b></span>}
        {info?.branch && <span className="branch"><GitBranch size={12} />{info.branch}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={Math.min(620, window.innerWidth - 16)} className="ws-popover">
          <RepoPicker recents={workspaces} current={workspace.path} worktrees={worktrees} onOpen={go} autoFocus listHeight="min(62vh, 600px)" />
        </Popover>
      )}
    </>
  )
}
