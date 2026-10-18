// Writes mod/hooks/tools.ts, the terminal mod's tools, from the canvas tools Duet's own conversations use.
//   npm run mod:tools        (tests/mod.test.ts fails while the file is out of date)
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { CANVAS_TOOLS, type CanvasToolName } from '../server/agent/canvasTools.ts'

const RELAYS: [string, CanvasToolName][] = [
  ['duet_map_list', 'canvas_list'],
  ['duet_map_read', 'canvas_read'],
  ['duet_map_update', 'canvas_update'],
  ['duet_map_reply', 'canvas_reply'],
]

export function modTools(): string {
  const tools = RELAYS.map(([name, relays]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(z.object(CANVAS_TOOLS[relays].shape)) as Record<string, unknown>
    const guide = relays === 'canvas_read' ? ' The result starts with how to draw and tag maps: read it before you change one with duet_map_update (canvas_update in Duet\'s messages).' : ''
    // Duet's prompts name its own tools; the mod's tools are those, under another name.
    const description = `${CANVAS_TOOLS[relays].description}${guide} Duet's messages call this tool ${relays} (mcp__duet__${relays}).`
    // The small tools sit in every prompt so Duet's names always resolve; canvas_update's schema is most of the size, so it waits behind ToolSearch.
    return { relays, spec: { name, description, inputSchema, isDeferred: relays === 'canvas_update' } }
  })
  return `// Written by scripts/mod-tools.ts from server/agent/canvasTools.ts: run \`npm run mod:tools\` after changing those tools.
import type { ToolSpec } from 'claude-code'

/** Each tool, and the Duet canvas tool it relays to. */
export const TOOLS: { relays: string; spec: ToolSpec }[] = ${JSON.stringify(tools, null, 2)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../mod/hooks/tools.ts', import.meta.url), modTools())
