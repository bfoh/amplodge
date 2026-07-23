// One-off syntax check for the v3 attendance migration.
// pgsql-ast-parser gaps handled by preprocessing (all are valid Postgres):
//   - GRANT/REVOKE lines stripped
//   - "security definer" / "set search_path = ..." in function headers blanked
// plpgsql bodies ($$...$$) are opaque strings to the parser, so this validates
// statement-level syntax only (DDL, policies, DML), not function-body logic.
const { parse } = require('pgsql-ast-parser')
const fs = require('fs')

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8')
const sql = raw
  .split('\n')
  .filter((l) => !/^\s*(grant|revoke)\b/i.test(l))
  .filter((l) => !/enable\s+row\s+level\s+security/i.test(l))
  .join('\n')
  .replace(/security\s+definer/gi, (m) => ' '.repeat(m.length))
  .replace(/set\s+search_path\s*=\s*(public|pg_catalog|'[^']*')/gi, (m) => ' '.repeat(m.length))
  .replace(/create\s+policy\b[\s\S]*?;/gi, (m) => m.replace(/[^\n]/g, ' '))

try {
  const ast = parse(sql)
  console.log(`OK: ${file}: parsed ${ast.length} top-level statements, no syntax errors.`)
} catch (e) {
  console.error(`SYNTAX ERROR in ${file}:`, e.message)
  if (e.location) {
    const lines = sql.split('\n')
    const start = Math.max(0, e.location.start.line - 3)
    const end = Math.min(lines.length, e.location.end.line + 2)
    for (let i = start; i < end; i++) {
      console.error(`${i + 1}\t${lines[i]}`)
    }
  }
  process.exit(1)
}
