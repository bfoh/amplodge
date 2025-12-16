const fs = require('fs');
try {
    require.resolve('@supabase/supabase-js');
    fs.writeFileSync('resolution_status.txt', 'FOUND');
} catch (e) {
    fs.writeFileSync('resolution_status.txt', 'MISSING: ' + e.message);
}
