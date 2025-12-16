const fs = require('fs');
try {
    const path = require.resolve('@supabase/supabase-js');
    fs.writeFileSync('resolution_status.txt', 'FOUND: ' + path);
} catch (e) {
    fs.writeFileSync('resolution_status.txt', 'MISSING: ' + e.message);
}
