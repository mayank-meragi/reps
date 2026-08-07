#!/usr/bin/env node
/**
 * Enforces the parity contract's import boundary (docs/plan.md §3): the
 * write primitive `updateFile` (in lib/sync.ts) may only be imported from
 * lib/commands/**, lib/data/**, or lib/sync.ts itself. Everywhere else —
 * components, pages, hooks — mutations MUST go through run() in
 * lib/commands, which is also what generates the AI's tool list. A direct
 * import of updateFile from a component is exactly the kind of "UI-only
 * feature" this build gate exists to catch.
 *
 * Run automatically as part of `npm run build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname
const ALLOWED_PREFIXES = ['lib/commands/', 'lib/data/', 'lib/sync.ts']

/** @type {string[]} */
const violations = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      check(full)
    }
  }
}

function check(file) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p) || rel === p)) return

  const text = readFileSync(file, 'utf8')
  // Matches `import { ..., updateFile, ... } from '...sync'` (any import order/spacing)
  const importBlockRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]*\/lib\/sync['"]/g
  let match
  while ((match = importBlockRe.exec(text))) {
    const names = match[1].split(',').map((s) => s.trim())
    if (names.some((n) => n === 'updateFile' || n.startsWith('updateFile as'))) {
      violations.push(`${rel}: imports updateFile() directly — writes must go through lib/commands`)
    }
  }
}

walk(SRC)

if (violations.length > 0) {
  console.error('\nParity check failed — direct persistence writes outside the command layer:\n')
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error('\nAdd a command in src/lib/commands/ instead, and call it via run().\n')
  process.exit(1)
}

console.log('Parity check passed — no direct writes outside src/lib/commands/.')
