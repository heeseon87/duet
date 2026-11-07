import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { DECISION_WHY_TAGS, fileOfRef, RELATION_RULES, toMermaid, type CanvasPatch } from '../../shared/canvas.ts'
import { refBase } from '../../shared/mapFiles.ts'
import { describeSource } from '../../shared/protocol.ts'
import type { CanvasStore } from '../canvas/store.ts'
import { codeHere, codeSourceOf, listFilesSync, missingRefs } from '../git/repo.ts'

const change = z.enum(['keep', 'result', 'modify', 'delete', 'add'])
const member = z.object({ text: z.string(), change: z.enum(['add', 'modify', 'delete']).optional() })
const element = z.object({
  id: z.string().describe('ASCII id, unique on the map'),
  label: z.string().nullable().optional(),
  kind: z.enum(['group', 'class', 'interface', 'enum', 'table', 'resource', 'external', 'actor']).nullable().optional(),
  parent: z.string().nullable().optional().describe('id of a group element'),
  change: change.nullable().optional(),
  members: z.array(member).nullable().optional(),
  note: z.string().nullable().optional(),
  files: z.array(z.string()).nullable().optional().describe('paths relative to the folder canvas_create and canvas_read name for the map\'s files, or absolute'),
  decision: z.string().nullable().optional().describe('the decision that shapes this part (D1). Tag every part a decision shapes, and keep the tag after the person chooses: the map shows what each decision shaped'),
  option: z.string().nullable().optional().describe('the option this part belongs to (D1-a); for a made decision, its chosen option. Leave it out when the part stands whichever way the decision goes'),
  before: z.string().optional().describe('move this element right before this sibling (same parent). Top-level groups are drawn in map order: left to right within a row (top to bottom when direction is LR); boxes tied by lines go where the lines put them. Keep an order the person set unless asked'),
  after: z.string().optional().describe('move this element right after this sibling (same parent)'),
})
const rules = Object.entries(RELATION_RULES).map(([kind, r]) => `${kind}${kind === 'association' ? ' (the default)' : ''}: ${r.when}`).join('; ')
const viaWords = [...new Set(Object.values(RELATION_RULES).flatMap(r => r.via))].join(', ')
const relation = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['association', 'dependency', 'inheritance', 'realization', 'composition', 'aggregation']).optional().describe(`how from is tied to to in the code; give that code in via. ${rules}. Composition and aggregation draw the diamond at from, the whole`),
  via: z.string().nullable().optional().describe(`the code that ties from to to: one of ${viaWords} then its name, e.g. "field userRepository", "param request", "extends AuditEntity". A via that is evidence for another kind gets a note`),
  label: z.string().optional().describe('what passes along this line, e.g. "upload(location, files)"'),
  step: z.number().int().positive().optional().describe('order in a flow; drawn as ①②③'),
  change: z.enum(['add', 'delete']).optional(),
  decision: z.string().nullable().optional().describe('the decision that shapes this line (D1); keep it after the choice'),
  option: z.string().nullable().optional().describe('the option this line belongs to (D1-a)'),
  remove: z.boolean().optional().describe('true removes the relation with this from/to/kind'),
})
const message = z.object({
  id: z.string(),
  from: z.string().optional(),
  to: z.string().nullable().optional(),
  kind: z.enum(['call', 'reply', 'async', 'note']).nullable().optional(),
  label: z.string().nullable().optional(),
  change: change.nullable().optional(),
  after: z.string().optional().describe('insert after this message id (new messages only)'),
})
const decision = z.object({
  id: z.string().describe('D1, D2, ...'),
  question: z.string().optional(),
  options: z.array(z.object({ id: z.string().describe('D1-a'), text: z.string(), impact: z.string().optional(), rejected: z.string().optional() })).optional(),
  why: z.object({
    text: z.string().describe('one or two sentences on what keeps you from settling it yourself, with the facts you found (the two conventions, the other maps it reaches)'),
    tags: z.array(z.enum(DECISION_WHY_TAGS)).min(1).describe('convention: the code or the maps follow more than one convention and nothing says which. scope: it reaches past this task (an API others call, another map, shared code). irreversible: costly to undo once it ships. context: it turns on what only the person knows (plans, priorities). tie: the options weigh the same on everything you can check'),
  }).optional().describe('why you ask instead of going on; give it with every decision'),
  recommended: z.string().nullable().optional().describe('the option you lean to (D1-a), when one fits better on what you found; leave it out on a tie. The person still chooses'),
})

export const INSTRUCTIONS = `Duet canvas: design maps the person reviews with you in the browser, beside this chat.
- A class map shows groups (packages), classes and labelled relations. Use it to discuss structure: who depends on whom, and what passes along each line.
- Label every relation with what it carries ("upload(location, files)"), and number the steps of a flow with "step".
- Pick each relation's kind from the code that ties the two and give that code in via ("field userRepository"): a field, an injected one included, is an association, not a dependency.
- Mark how each element touches the code with "change": add (new), modify, delete, result (data that comes out); leave it out for a part the work keeps as it is.
- Leave out what goes without saying: an element's kind class, a relation's kind association, a label the same as the id.
- When a design fork needs the person's choice, add a decision (D1 with options D1-a, D1-b) and tag the elements and relations of each option with decision/option. Never choose for them; they choose in the browser.
- Give every decision a why: what keeps you from settling it from the code and the request, with its tags (convention, scope, irreversible, context, tie). If no tag fits, it is not the person's decision: pick yourself and say in chat what you picked and why.
- When one option fits better on what you found, name it in recommended (and say why in its impact); leave it out on a tie. The person sees it as your pick and still decides.
- Tag everything a decision shapes: the parts each option adds or changes get decision + option, and a part the decision touches whichever way it goes gets decision alone. The person sees these tags as pins on the map.
- When the person chooses, the other options' parts are removed and the chosen ones keep their tags. Keep those tags in every later update; never clear them because the decision is made.
- When asked to tag existing decisions, read the map, find the parts each decision shaped, and add decision (and, for a made decision, its chosen option) to them.
- The person's canvas comments arrive as prompts that name the map and the target. Answer in chat, and update the map so the drawing matches what you said.
- Keep the map and the code in step: when you change the code's structure, update the map in the same turn.
- Each map is bound to the code it is about, and the person reviews that code beside it. When you build or change the code of a part, set the part's files (relative to the folder canvas_read names for them) in the same turn: the review lists each changed file under the part that names it, and the map marks which parts are built.
- The person can also edit the map directly (labels, status, notes, removals). Read the map before you change it, and keep their edits.`

/** The canvas tools, written once: the terminal mod relays its calls to the server. */
export const CANVAS_TOOLS = {
  canvas_list: { description: 'List the design maps of this workspace.', shape: {} },
  canvas_read: { description: 'Read a map: its JSON, the Mermaid it draws, and open comment threads.', shape: { name: z.string() } },
  canvas_create: {
    description: 'Create a new design map and draw its first version in the same call: elements, relations (messages for a sequence map) and decisions take the same shape as in canvas_update. Leave them out to start empty. Change the map later with canvas_update.',
    shape: {
      name: z.string().describe('lowercase file name, e.g. thumbnail-worker'),
      diagram: z.enum(['class', 'sequence']),
      title: z.string(),
      context: z.string().optional().describe('one or two sentences: what this map is for'),
      note: z.string().optional().describe('one short line for the revision timeline when you draw here'),
      direction: z.enum(['TB', 'LR', 'BT', 'RL']).optional(),
      elements: z.array(element).optional(),
      relations: z.array(relation).optional(),
      messages: z.array(message).optional(),
      decisions: z.array(decision).optional(),
      code: z.string().optional().describe('only for a map made to review code that exists: what it reviews, "pr" (the PR of the checked-out branch), "pr:123", "branch:main...feature" or "commits:abc..def". Leave it out for a design map: it is bound to this tree from its current commit, so the code built from it shows in the review'),
      repo: z.string().optional().describe('a folder of the git repository the code is in, absolute or relative to this folder; for code built in a worktree, that worktree (a design map follows its uncommitted changes). Leave it out when that is this folder\'s tree. In another repository outside the workspace, the map\'s files are relative to its root'),
    },
  },
  canvas_update: {
    description: `Change a map. Elements, messages and decisions upsert by id (null clears a field); relations upsert by from/to/kind ("remove": true deletes one). Removing an element removes its relations. Every successful call makes a new revision the person can compare.`,
    shape: {
      name: z.string(),
      note: z.string().describe('one short line: why this change (shown in the revision timeline)'),
      baseRevision: z.number().int().optional(),
      title: z.string().optional(),
      context: z.string().nullable().optional(),
      direction: z.enum(['TB', 'LR', 'BT', 'RL']).nullable().optional(),
      elements: z.array(element).optional(),
      relations: z.array(relation).optional(),
      messages: z.array(message).optional(),
      decisions: z.array(decision).optional(),
      remove: z.object({
        elements: z.array(z.string()).optional(),
        messages: z.array(z.string()).optional(),
        fragments: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
      }).optional(),
    },
  },
  canvas_reply: {
    description: 'Pin a short reply to a comment thread on the canvas (your chat answer is also shown there). Use it to close the loop on a thread you resolved.',
    shape: { name: z.string(), threadId: z.string(), text: z.string() },
  },
} as const

export type CanvasToolName = keyof typeof CANVAS_TOOLS

/** Where a bound map's relative part files start: the workspace, or the root of another repository outside it. */
const filesFrom = (workspace: string, root: string) => ` Its parts' files are relative to ${refBase(workspace, root)}.`

/**
 * Part files made relative to where the map's files start (`base`). The agent may write a path from its own folder or
 * from the code's repository, an absolute one inside the base, or the end of a path (a file name alone) that only one
 * file of those trees has. A path found nowhere stays as written: a planned file need not exist yet. An end that
 * several files share stays too, with a note naming them.
 */
export function rebaseFiles(patch: CanvasPatch, base: string, roots: string[], list: (root: string) => string[] = listFilesSync): { patch: CanvasPatch; notes: string[] } {
  const notes: string[] = []
  if (!patch.elements?.some(e => e.files?.length)) return { patch, notes }
  const trees = [...new Set([...roots, base])]
  const listed = new Map<string, string[]>()
  const filesOf = (root: string) => { let l = listed.get(root); if (!l) listed.set(root, l = list(root)); return l }
  const fix = (ref: string) => {
    const file = fileOfRef(ref), span = ref.slice(file.length)
    const inBase = (abs: string) => { const rel = relative(base, abs); return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel + span : undefined }
    const at = (abs: string) => inBase(abs) ?? abs + span
    if (isAbsolute(file)) return inBase(file) ?? ref
    if (existsSync(resolve(base, file))) return ref
    for (const root of roots) if (root !== base && existsSync(resolve(root, file))) return at(resolve(root, file))
    const end = file.replace(/^\.\//, '')
    for (const root of trees) {
      const hits = filesOf(root).filter(p => p === end || p.endsWith(`/${end}`))
      if (hits.length === 1) return at(resolve(root, hits[0]))
      if (hits.length > 1) {
        notes.push(`files "${end}": ${hits.length} files end so in ${root} (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}); give more of the path`)
        return ref
      }
    }
    return ref
  }
  return { patch: { ...patch, elements: patch.elements.map(e => (e.files?.length ? { ...e, files: e.files.map(fix) } : e)) }, notes }
}

/** A terminal signs its revisions (in the note, and by its id) and replies; its `cwd` is where a new map's code is. */
export type Caller = { terminal?: { id: string; label: string; cwd?: string } }

/** One canvas tool call on arguments its shape already checked; the text is what the agent reads. */
export function runCanvasTool(store: CanvasStore, workspace: string, name: CanvasToolName, args: Record<string, unknown>, caller: Caller = {}): { text: string; isError?: boolean } {
  const signed = (note: string) => (caller.terminal ? `터미널 · ${caller.terminal.label} · ${note}` : note)
  try {
    switch (name) {
      case 'canvas_list': {
        const maps = store.list(workspace)
        if (!maps.length) return { text: caller.terminal ? 'No maps yet in this workspace. Create one with duet_map_create.' : 'No maps yet. Create one with canvas_create.' }
        return { text: maps.map(m => `- ${m.name} (${m.diagram}, rev ${m.revision}): ${m.title}; ${m.elements} elements, ${m.openDecisions} open decisions, ${m.openThreads} open comment threads${m.code ? `; its code: ${describeSource(m.code.source)} in ${m.code.root}` : ''}`).join('\n') }
      }
      case 'canvas_read': {
        const map = String(args.name)
        const cur = store.get(workspace, map)
        const threads = store.threads(workspace, map).filter(t => t.state === 'open')
        const parts = [
          `rev ${cur.revision}`,
          ...(cur.code ? [`Its code (what the person reviews beside it): ${describeSource(cur.code.source)} in ${cur.code.root}.${filesFrom(workspace, cur.code.root)}`] : []),
          '```json', JSON.stringify(cur.map, null, 1), '```',
          '```mermaid', toMermaid(cur.map).text, '```',
        ]
        if (threads.length) {
          parts.push('Open threads:')
          for (const t of threads) parts.push(`- [${t.id}] on ${t.targetLabel}: ${t.items.map(i => `${i.who}: ${i.text}`).join(' / ')}`)
        }
        return { text: parts.join('\n') }
      }
      case 'canvas_create': {
        const { name: map, diagram, title, context, code: asked, repo, note, ...drawing } = args as { name: string; diagram: 'class' | 'sequence'; title: string; context?: string; code?: string; repo?: string; note?: string } & CanvasPatch
        const from = caller.terminal?.cwd || workspace
        const here = codeHere(repo ? resolve(from, repo) : from, workspace)
        const source = asked ? codeSourceOf(asked) : undefined
        if (asked && !source) return { isError: true, text: `Nothing was made: code "${asked}" is not one of pr, pr:<number>, branch:<base>...<compare>, commits:<from>..<to>.` }
        if (repo && !here) return { isError: true, text: `Nothing was made: repo "${repo}" is not a folder inside a git repository.` }
        if (asked && !here) return { isError: true, text: 'Nothing was made: a map that reviews code needs a folder inside a git repository.' }
        const missing = here && source ? missingRefs(here.root, source) : []
        if (missing.length) return { isError: true, text: `Nothing was made: ${missing.join(', ')} is not a commit in ${here!.root}. Pass repo: a folder of the repository the code is in.` }
        const code = here && source ? { ...here, source } : here
        const roots = [from, ...(code ? [code.root] : [])]
        const files = rebaseFiles(drawing, refBase(workspace, code?.root), roots)
        const made = store.createDrawn(workspace, map, diagram, title, context, 'agent', signed(note || '새 지도'), code, files.patch, caller.terminal?.id)
        const notes = [...files.notes, ...made.notes]
        if (!made.ok) return { isError: true, text: ['Nothing was made. Fix these and call again:', ...made.errors.map(e => `- ${e}`), ...notes.map(n => `note: ${n}`)].join('\n') }
        const bound = code ? ` Its review shows ${describeSource(code.source)} in ${code.root}.${filesFrom(workspace, code.root)}` : ''
        return { text: [`Created ${map} (rev ${made.cur.revision}). The person sees it on the Canvas tab.${bound}`, ...made.changes.map(c => `  ${c}`), ...notes.map(n => `note: ${n}`)].join('\n') }
      }
      case 'canvas_update': {
        const { name: map, note, baseRevision, ...rest } = args as { name: string; note: string; baseRevision?: number }
        const root = store.get(workspace, map).code?.root
        const roots = [...(caller.terminal?.cwd ? [caller.terminal.cwd] : []), ...(root ? [root] : [])]
        const files = rebaseFiles(rest as CanvasPatch, refBase(workspace, root), roots)
        const res = store.update(workspace, map, files.patch, 'agent', signed(note), baseRevision, caller.terminal?.id)
        const notes = [...files.notes, ...res.notes]
        if (!res.ok) return { isError: true, text: ['Nothing was written. Fix these and call again:', ...res.errors.map(e => `- ${e}`), ...notes.map(n => `note: ${n}`)].join('\n') }
        return { text: [`rev ${res.revision}`, ...res.changes.map(c => `  ${c}`), ...notes.map(n => `note: ${n}`)].join('\n') }
      }
      case 'canvas_reply': {
        const { name: map, threadId, text } = args as { name: string; threadId: string; text: string }
        const t = store.addThreadItem(workspace, map, { threadId, target: '', who: 'agent', text, terminal: caller.terminal?.id })
        return { text: `Replied on ${t.targetLabel}.` }
      }
    }
  } catch (e) {
    return { isError: true, text: (e as Error).message }
  }
}
