import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { toMermaid, type CanvasPatch } from '../../shared/canvas.ts'
import type { CanvasStore } from '../canvas/store.ts'

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
  files: z.array(z.string()).nullable().optional().describe('repo-relative paths'),
  decision: z.string().nullable().optional().describe('the decision that shapes this part (D1). Tag every part a decision shapes, and keep the tag after the person chooses: the map shows what each decision shaped'),
  option: z.string().nullable().optional().describe('the option this part belongs to (D1-a); for a made decision, its chosen option. Leave it out when the part stands whichever way the decision goes'),
  before: z.string().optional().describe('move this element right before this sibling (same parent). Top-level groups are drawn in map order: left to right within a row (top to bottom when direction is LR); boxes tied by lines go where the lines put them. Keep an order the person set unless asked'),
  after: z.string().optional().describe('move this element right after this sibling (same parent)'),
})
const relation = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['association', 'dependency', 'inheritance', 'realization', 'composition', 'aggregation']).optional(),
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
})

export const INSTRUCTIONS = `Duet canvas: design maps the person reviews with you in the browser, beside this chat.
- A class map shows groups (packages), classes and labelled relations. Use it to discuss structure: who depends on whom, and what passes along each line.
- Label every relation with what it carries ("upload(location, files)"), and number the steps of a flow with "step".
- Mark how each element touches the code with "change": add (new), modify, delete, result (data that comes out), keep.
- When a design fork needs the person's choice, add a decision (D1 with options D1-a, D1-b) and tag the elements and relations of each option with decision/option. Never choose for them; they choose in the browser.
- Tag everything a decision shapes: the parts each option adds or changes get decision + option, and a part the decision touches whichever way it goes gets decision alone. The person sees these tags as pins on the map.
- When the person chooses, the other options' parts are removed and the chosen ones keep their tags. Keep those tags in every later update; never clear them because the decision is made.
- When asked to tag existing decisions, read the map, find the parts each decision shaped, and add decision (and, for a made decision, its chosen option) to them.
- The person's canvas comments arrive as prompts that name the map and the target. Answer in chat, and update the map so the drawing matches what you said.
- Keep the map and the code in step: when you change the code's structure, update the map in the same turn.
- The person can also edit the map directly (labels, status, notes, removals). Read the map before you change it, and keep their edits.`

/** The canvas tools, written once: Duet's conversations get them over MCP, the terminal mod relays its calls to the server. */
export const CANVAS_TOOLS = {
  canvas_list: { description: 'List the design maps of this workspace.', shape: {} },
  canvas_read: { description: 'Read a map: its JSON, the Mermaid it draws, and open comment threads.', shape: { name: z.string() } },
  canvas_create: {
    description: 'Create a new design map (empty). Then fill it with canvas_update.',
    shape: {
      name: z.string().describe('lowercase file name, e.g. thumbnail-worker'),
      diagram: z.enum(['class', 'sequence']),
      title: z.string(),
      context: z.string().optional().describe('one or two sentences: what this map is for'),
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

/** A terminal signs its revisions and replies; a Duet conversation is the session itself. */
export type Caller = { terminal?: { id: string; label: string } }

/** One canvas tool call on arguments its shape already checked; the text is what the agent reads. */
export function runCanvasTool(store: CanvasStore, workspace: string, name: CanvasToolName, args: Record<string, unknown>, caller: Caller = {}): { text: string; isError?: boolean } {
  try {
    switch (name) {
      case 'canvas_list': {
        const maps = store.list(workspace)
        if (!maps.length) return { text: caller.terminal ? 'No maps yet in this workspace. The person makes them in Duet.' : 'No maps yet. Create one with canvas_create.' }
        return { text: maps.map(m => `- ${m.name} (${m.diagram}, rev ${m.revision}): ${m.title}; ${m.elements} elements, ${m.openDecisions} open decisions, ${m.openThreads} open comment threads`).join('\n') }
      }
      case 'canvas_read': {
        const map = String(args.name)
        const cur = store.get(workspace, map)
        const threads = store.threads(workspace, map).filter(t => t.state === 'open')
        // Duet's conversations carry the guide in the MCP server's instructions; a terminal reads it with the map.
        const parts = [
          ...(caller.terminal ? [INSTRUCTIONS, ''] : []),
          `rev ${cur.revision}`,
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
        const { name: map, diagram, title, context } = args as { name: string; diagram: 'class' | 'sequence'; title: string; context?: string }
        const cur = store.create(workspace, map, diagram, title, context, 'agent')
        return { text: `Created ${map} (rev ${cur.revision}). The person sees it on the Canvas tab.` }
      }
      case 'canvas_update': {
        const { name: map, note, baseRevision, ...rest } = args as { name: string; note: string; baseRevision?: number }
        const signed = caller.terminal ? `터미널 · ${caller.terminal.label} · ${note}` : note
        const res = store.update(workspace, map, rest as CanvasPatch, 'agent', signed, baseRevision)
        if (!res.ok) return { isError: true, text: ['Nothing was written. Fix these and call again:', ...res.errors.map(e => `- ${e}`), ...res.notes.map(n => `note: ${n}`)].join('\n') }
        return { text: [`rev ${res.revision}`, ...res.changes.map(c => `  ${c}`), ...res.notes.map(n => `note: ${n}`)].join('\n') }
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

const result = (r: { text: string; isError?: boolean }) => ({ content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) })

export function canvasServer(store: CanvasStore, workspace: string) {
  const run = (name: CanvasToolName) => async (args: Record<string, unknown>) => result(runCanvasTool(store, workspace, name, args))
  const { canvas_list: list, canvas_read: read, canvas_create: create, canvas_update: update, canvas_reply: reply } = CANVAS_TOOLS
  return createSdkMcpServer({
    name: 'duet',
    version: '1.0.0',
    instructions: INSTRUCTIONS,
    alwaysLoad: true,
    tools: [
      tool('canvas_list', list.description, list.shape, run('canvas_list')),
      tool('canvas_read', read.description, read.shape, run('canvas_read')),
      tool('canvas_create', create.description, create.shape, run('canvas_create')),
      tool('canvas_update', update.description, update.shape, run('canvas_update')),
      tool('canvas_reply', reply.description, reply.shape, run('canvas_reply')),
    ],
  })
}
