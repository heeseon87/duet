// Writes mod/hooks/tools.ts, the terminal mod's tools, from the canvas tools Duet's own conversations use.
//   npm run mod:tools        (tests/mod.test.ts fails while the file is out of date)
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { CANVAS_TOOLS, INSTRUCTIONS, type CanvasToolName } from '../server/agent/canvasTools.ts'

const RELAYS: [string, CanvasToolName][] = [
  ['duet_map_list', 'canvas_list'],
  ['duet_map_read', 'canvas_read'],
  ['duet_map_create', 'canvas_create'],
  ['duet_map_update', 'canvas_update'],
  ['duet_map_reply', 'canvas_reply'],
]

/** What a terminal's tool does beyond the canvas tool it relays to. */
const ADDED: Partial<Record<CanvasToolName, string>> = {
  canvas_read: ' How to draw and tag maps is at the end of duet_map_create\'s description: follow it when you change a map with duet_map_update (canvas_update in Duet\'s messages).',
  canvas_create: ' When this terminal has no pinned map, the new map becomes its map. From a folder outside every Duet workspace, it first opens the folder\'s git repository in Duet as a workspace.',
  canvas_update: ' Draw and tag as the guide at the end of duet_map_create\'s description says.',
}

/** The terminal has no MCP server instructions, so the drawing guide rides on the tool it draws a new map with. */
const GUIDE: Partial<Record<CanvasToolName, string>> = {
  canvas_create: `\n\nHow to draw and tag maps, here and with duet_map_update (canvas_update in Duet's messages):\n${INSTRUCTIONS}`,
}

/** Each terminal tool's spec, and the canvas tool it relays to. */
export function modToolSpecs() {
  return RELAYS.map(([name, relays]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(z.object(CANVAS_TOOLS[relays].shape)) as Record<string, unknown>
    // Duet's prompts name its own tools; the mod's tools are those, under another name.
    const description = `${CANVAS_TOOLS[relays].description}${ADDED[relays] ?? ''} Duet's messages call this tool ${relays} (mcp__duet__${relays}).${GUIDE[relays] ?? ''}`
    // The small tools sit in every prompt so Duet's names always resolve; canvas_update's schema is most of the size, so it waits behind ToolSearch.
    return { relays, spec: { name, description, inputSchema, isDeferred: relays === 'canvas_update' } }
  })
}

export function modTools(): string {
  const tools = modToolSpecs()
  return `// Written by scripts/mod-tools.ts from server/agent/canvasTools.ts: run \`npm run mod:tools\` after changing those tools.
import type { ToolSpec } from 'claude-code'

/** Each tool, and the Duet canvas tool it relays to. */
export const TOOLS: { relays: string; spec: ToolSpec }[] = ${JSON.stringify(tools, null, 2)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../mod/hooks/tools.ts', import.meta.url), modTools())
