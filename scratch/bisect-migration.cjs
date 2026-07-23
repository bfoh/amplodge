// Bisect: find the first statement that fails to parse in the preprocessed SQL.
const { parse } = require('pgsql-ast-parser')
const fs = require('fs')

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8')
const sql = raw
  .split('\n')
  .filter((l) => !/^\s*(grant|revoke)\b/i.test(l))
  .filter((l) => !/enable\s+row\s+level\s+security/i.test(l))
  .filter((l) => !/alter\s+publication\b/i.test(l))
  .filter((l) => !/^\s*drop\s+function\b/i.test(l))
  .join('\n')
  .replace(/security\s+definer/gi, (m) => ' '.repeat(m.length))
  .replace(/set\s+search_path\s*=\s*(public|pg_catalog|'[^']*')/gi, (m) => ' '.repeat(m.length))
  .replace(/create\s+policy\b[\s\S]*?;/gi, (m) => m.replace(/[^\n]/g, ' '))

// candidate cut points: lines ending with ';' while NOT inside a $$ ... $$ block
const lines = sql.split('\n')
const cuts = []
let inDollar = false
for (let i = 0; i < lines.length; i++) {
  const occurrences = (lines[i].match(/\$\$/g) || []).length
  const wasInDollar = inDollar
  if (occurrences % 2 === 1) inDollar = !inDollar
  if (!wasInDollar && !inDollar && lines[i].trimEnd().endsWith(';')) cuts.push(i + 1)
  // closing line of a $$ block also ends with ';' and is a valid cut point
  if (wasInDollar && !inDollar && lines[i].trimEnd().endsWith(';')) cuts.push(i + 1)
}

let lo = 0
for (const cut of cuts) {
  const chunk = lines.slice(lo, cut).join('\n')
  try {
    parse(chunk)
    lo = cut
  } catch (e) {
    // comment-only fragments parse as empty input — keep accumulating
    const code = chunk.replace(/--.*$/gm, '').trim()
    if (code === '') continue
    console.error(`FAILS in statement ending at line ${cut}: ${e.message.split('\n')[0]}`)
    console.error('--- statement start (up to 40 lines) ---')
    const stmt = lines.slice(lo, cut)
    stmt.slice(0, 40).forEach((l, i) => console.error(`${lo + i + 1}\t${l}`))
    if (stmt.length > 40) console.error(`... (${stmt.length - 40} more lines)`)
    process.exit(1)
  }
}
console.log('All statements parsed OK.')
