import { createClient } from '@supabase/supabase-js';
import ical from 'node-ical';
import { parseISO, isValid, format } from 'date-fns';

export const handler = async (event, context) => {
    // This function might take time, so we set a longer timeout in Netlify config if possible
    // For now, we just try to be efficient.

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    // Allow POST (manual trigger) or scheduled event
    // note: scheduled events usually don't have httpMethod 'POST' but we can check usage
    if (event.httpMethod !== 'POST' && !event.body) {
        // allow GET for testing if needed, but prefer POST
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase configuration');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Config Error' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log('[Sync] Starting channel sync...');

        // 1. Get all active mappings with import URLs
        const { data: mappings, error: mappingError } = await supabase
            .from('channel_room_mappings')
            .select(`
                id, 
                import_url, 
                channel_connection_id,
                channel_connections ( is_active )
            `)
            .not('import_url', 'is', null);

        if (mappingError) {
            console.error('[Sync] Failed to fetch mappings:', mappingError);
            return { statusCode: 500, body: JSON.stringify({ error: 'Database Error' }) };
        }

        const activeMappings = mappings.filter(m => m.channel_connections?.is_active && m.import_url);
        console.log(`[Sync] Found ${activeMappings.length} active mappings to sync.`);

        const results = [];

        // 2. Process each mapping
        for (const mapping of activeMappings) {
            const result = { mappingId: mapping.id, status: 'pending', events: 0 };

            try {
                console.log(`[Sync] Fetching iCal for mapping ${mapping.id} (${mapping.import_url})...`);

                // Fetch and parse iCal
                // node-ical fromURL returns an object indexed by UID
                const events = await ical.async.fromURL(mapping.import_url);

                const validEvents = [];

                for (const key in events) {
                    const ev = events[key];
                    if (ev.type === 'VEVENT') {
                        // Validate dates
                        if (ev.start && ev.end) {
                            validEvents.push({
                                mapping_id: mapping.id,
                                external_id: ev.uid,
                                start_date: ev.start.toISOString(), // Supabase handles ISO strings for dates? check schema
                                end_date: ev.end.toISOString(),
                                // Handling All Day events: usually check 'datetype' property or if start/end have no time
                                // For now, simple ISO string is safest, we can trim time later
                                summary: ev.summary || 'External Booking',
                                raw_data: ev,
                                updated_at: new Date().toISOString()
                            });
                        }
                    }
                }

                console.log(`[Sync] Found ${validEvents.length} events for mapping ${mapping.id}`);

                if (validEvents.length > 0) {
                    // Update Database
                    // We need to upsert.
                    // IMPORTANT: We should also delete events that are no longer in the feed (cancellations).
                    // Strategy:
                    // 1. Get List of existing external_id for this mapping
                    // 2. Identify new/updated (in validEvents)
                    // 3. Identify deleted (in DB but not in validEvents)

                    const { data: existing, error: fetchErr } = await supabase
                        .from('external_bookings')
                        .select('external_id')
                        .eq('mapping_id', mapping.id);

                    if (fetchErr) throw fetchErr;

                    const existingIds = new Set(existing.map(e => e.external_id));
                    const newIds = new Set(validEvents.map(e => e.external_id));

                    // Upsert (Insert or Update) all valid events
                    // Prepare for bulk upsert
                    const upsertData = validEvents.map(e => ({
                        ...e,
                        start_date: format(new Date(e.start_date), 'yyyy-MM-dd'), // Format as DATE type
                        end_date: format(new Date(e.end_date), 'yyyy-MM-dd')
                    }));

                    const { error: upsertErr } = await supabase
                        .from('external_bookings')
                        .upsert(upsertData, { onConflict: 'mapping_id,external_id' });

                    if (upsertErr) throw upsertErr;

                    // Delete missing
                    const toDelete = [...existingIds].filter(id => !newIds.has(id));
                    if (toDelete.length > 0) {
                        const { error: delErr } = await supabase
                            .from('external_bookings')
                            .delete()
                            .eq('mapping_id', mapping.id)
                            .in('external_id', toDelete);

                        if (delErr) throw delErr;
                        console.log(`[Sync] Deleted ${toDelete.length} cancelled events.`);
                    }
                }

                // Update Mapping Status
                await supabase
                    .from('channel_room_mappings')
                    .update({
                        last_synced_at: new Date().toISOString(),
                        sync_status: 'success',
                        sync_message: `Synced ${validEvents.length} events`
                    })
                    .eq('id', mapping.id);

                result.status = 'success';
                result.events = validEvents.length;

            } catch (syncError) {
                console.error(`[Sync] Error processing mapping ${mapping.id}:`, syncError);

                // Update Mapping Status to Error
                await supabase
                    .from('channel_room_mappings')
                    .update({
                        last_synced_at: new Date().toISOString(),
                        sync_status: 'error',
                        sync_message: syncError.message || 'Unknown error'
                    })
                    .eq('id', mapping.id);

                result.status = 'error';
                result.error = syncError.message;
            }
            results.push(result);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, results })
        };

    } catch (error) {
        console.error('[Sync] Fatal Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
