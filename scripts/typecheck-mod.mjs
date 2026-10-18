// Claude Code writes the mod's types into mod/.claude-plugin/types the first time it loads the plugin, and
// keeps them out of git; without them tsc only says a tsconfig is missing.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('mod/.claude-plugin/types/tsconfig.json')) {
  console.error('mod types missing: run `claude --plugin-dir mod` once (then /exit) so Claude Code writes them, then typecheck again')
  process.exit(1)
}
execFileSync('npx', ['tsc', '-p', 'mod'], { stdio: 'inherit' })
