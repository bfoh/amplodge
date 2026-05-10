#!/usr/bin/env node
/**
 * One-shot codemod: rewrite Blink imports + symbol references to the new
 * src/lib/db.ts surface.
 *
 * Usage:
 *   node scripts/codemod-blink.js --dry        # preview changes
 *   node scripts/codemod-blink.js --apply      # write changes
 *
 * Scope: src/**\/*.{ts,tsx}, excluding src/blink/ itself (deleted later).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { glob } from 'glob'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const DRY = args.has('--dry') || !APPLY

// Files to delete entirely (no rewrite — they are removed in Task 9).
const DELETE_DIR_PREFIX = path.join(SRC, 'blink') + path.sep

// Import-line rewrites. Each rule: regex → replacement function.
const importRules = [
  // import { ... } from '...blink/{schema,database-schema,blink-config,blink-database,database-config,database}'
  // Drop the entire import line.
  {
    pattern: /^import\s*\{[^}]*\}\s*from\s*['"](?:@\/|\.\.?\/|(?:\.\.\/)+)blink\/(schema|database-schema|blink-config|blink-database|database-config|database)['"];?[ \t]*\r?\n/gm,
    replace: () => '',
  },
  // import { blink, X, Y, ... } from '...blink/client'
  // Always inject db, auth at the front of the named-imports list.
  {
    pattern: /import\s*\{\s*blink\s*(?:,\s*([^}]+?))?\s*\}\s*from\s*['"](?:@\/|\.\.?\/|(?:\.\.\/)+)blink\/client['"];?/g,
    replace: (_m, rest) => {
      const extras = (rest || '').trim().replace(/\s+/g, ' ')
      const symbols = extras ? `db, auth, ${extras}` : `db, auth`
      return `import { ${symbols} } from '@/lib/db'`
    },
  },
]

// Symbol rewrites applied to the rest of the file.
const symbolRules = [
  { pattern: /\bblink\.db\b/g, replace: () => 'db' },
  { pattern: /\bblink\.auth\b/g, replace: () => 'auth' },
  { pattern: /\bblinkManaged\b/g, replace: () => 'db' },
]

// Cleanup pass — runs AFTER the renames above. Removes self-referential
// declarations that the rename introduced. Many files had:
//
//   const db = blink.db as any
//
// to silence the wrapper's loose typing. After the symbol rewrite that becomes
// `const db = db as any` — a self-reference that TS reports as
// "Block-scoped variable 'db' used before its declaration". The imported `db`
// already plays the same role, so the local can simply be deleted.
const cleanupRules = [
  // Drop `const db = db as any` and `const db = (db as any)` and the trailing newline.
  { pattern: /^[ \t]*const\s+db\s*=\s*\(?\s*db\s+as\s+any\s*\)?\s*;?[ \t]*\r?\n/gm, replace: () => '' },
  { pattern: /^[ \t]*const\s+auth\s*=\s*\(?\s*auth\s+as\s+any\s*\)?\s*;?[ \t]*\r?\n/gm, replace: () => '' },
]

async function main() {
  const files = await glob('src/**/*.{ts,tsx}', { cwd: ROOT, absolute: true })
  const changed = []

  for (const file of files) {
    if (file.startsWith(DELETE_DIR_PREFIX)) continue
    const before = await fs.readFile(file, 'utf8')
    let after = before

    for (const rule of importRules) after = after.replace(rule.pattern, rule.replace)
    for (const rule of symbolRules) after = after.replace(rule.pattern, rule.replace)
    for (const rule of cleanupRules) after = after.replace(rule.pattern, rule.replace)

    if (after !== before) {
      changed.push(path.relative(ROOT, file))
      if (APPLY) await fs.writeFile(file, after, 'utf8')
    }
  }

  console.log(`${DRY ? '[DRY]' : '[APPLY]'} ${changed.length} files would be modified:`)
  changed.forEach(f => console.log(`  ${f}`))
}

main().catch(err => {
  console.error('codemod failed:', err)
  process.exit(1)
})
