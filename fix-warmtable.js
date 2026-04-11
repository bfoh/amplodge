const fs = require('fs');
let content = fs.readFileSync('src/lib/offline-cache.ts', 'utf8');

// Replace the slow warmup with fast rev mapping
content = content.replace(
`    // Fetch all existing local docs
    const existing = await db.allDocs({ include_docs: false })
    const localIds = new Set(existing.rows.map(r => r.id))
    const remoteIds = new Set<string>()

    // Upsert all remote rows
    const bulkDocs: any[] = []
    for (const row of rows) {
      const docId = String(row.id)
      remoteIds.add(docId)

      // Try to get existing doc for _rev
      let existingRev: string | undefined
      if (localIds.has(docId)) {
        try {
          const existingDoc = await db.get(docId)
          existingRev = existingDoc._rev
        } catch {
          // doc doesn't exist locally, will create
        }
      }

      bulkDocs.push({
        ...row,
        _id: docId,
        ...(existingRev ? { _rev: existingRev } : {}),
      })
    }`, 
`    // Fetch all existing local docs
    const existing = await db.allDocs({ include_docs: false })
    const localRevs = new Map(existing.rows.map(r => [r.id, r.value.rev]))
    const remoteIds = new Set<string>()

    // Upsert all remote rows
    const bulkDocs: any[] = []
    for (const row of rows) {
      const docId = String(row.id)
      remoteIds.add(docId)

      const existingRev = localRevs.get(docId)

      bulkDocs.push({
        ...row,
        _id: docId,
        ...(existingRev ? { _rev: existingRev } : {}),
      })
    }`)

fs.writeFileSync('src/lib/offline-cache.ts', content);
