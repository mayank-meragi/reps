#!/usr/bin/env node
/**
 * Prints every registered command, whether it's exposed to the AI, and
 * whether it has an undo handler — a cheap, visible coverage check
 * (docs/plan.md §3). Static extraction from source rather than executing
 * the registry, so it needs no build step.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMMANDS_DIR = new URL('../src/lib/commands', import.meta.url).pathname
const SKIP_FILES = new Set(['registry.ts', 'context.ts', 'log.ts', 'index.ts'])

const rows = []

for (const file of readdirSync(COMMANDS_DIR)) {
  if (!file.endsWith('.ts') || SKIP_FILES.has(file)) continue
  const text = readFileSync(join(COMMANDS_DIR, file), 'utf8')
  // Each real call site: "defineCommand" followed (ignoring whitespace) by
  // '(' or '<' — excludes the `import { defineCommand } from ...` line,
  // which is followed by '}'. The call's own '(' is then the first '(' after
  // the match (generic type params here never themselves contain '('), and
  // its argument object is the first '{' after that '(' — this sidesteps
  // generics like `defineCommand<{ id: string }, R>(...)` that would
  // otherwise confuse a naive brace-balance-from-first-'{' search.
  const callRe = /defineCommand\s*[(<]/g
  let m
  while ((m = callRe.exec(text))) {
    const parenIdx = text.indexOf('(', m.index)
    const braceStart = parenIdx === -1 ? -1 : text.indexOf('{', parenIdx)
    if (braceStart === -1) continue
    let depth = 0
    let j = braceStart
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const block = text.slice(braceStart, j + 1)
    const name = block.match(/name:\s*['"]([^'"]+)['"]/)?.[1] ?? '(unknown)'
    const kind = block.match(/kind:\s*['"]([^'"]+)['"]/)?.[1] ?? '(unknown)'
    const aiExposed = !/aiExposed:\s*false/.test(block)
    const hasUndo = /\bundo:\s*\(/.test(block)
    rows.push({ file, name, kind, aiExposed, hasUndo })
    callRe.lastIndex = j + 1
  }
}

rows.sort((a, b) => a.name.localeCompare(b.name))

const col = (s, w) => String(s).padEnd(w)
console.log(col('COMMAND', 34) + col('KIND', 13) + col('AI', 5) + col('UNDO', 6) + 'FILE')
for (const r of rows) {
  console.log(
    col(r.name, 34) + col(r.kind, 13) + col(r.aiExposed ? 'yes' : 'no', 5) + col(r.hasUndo ? 'yes' : 'no', 6) + r.file,
  )
}

const writes = rows.filter((r) => r.kind !== 'read')
const hidden = rows.filter((r) => !r.aiExposed)
const noUndo = writes.filter((r) => !r.hasUndo)

console.log(`\n${rows.length} commands (${writes.length} writes, ${rows.length - writes.length} reads).`)
if (hidden.length > 0) console.log(`${hidden.length} hidden from the AI: ${hidden.map((r) => r.name).join(', ')}`)
if (noUndo.length > 0) console.log(`${noUndo.length} writes without undo: ${noUndo.map((r) => r.name).join(', ')}`)
