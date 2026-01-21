
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function listJan() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    const start = '2026-01-01';
    const end = '2026-01-31';

    const { data: entries } = await supabase.from('oj_entries')
        .select(`
            entry_date, 
            duration_minutes_rounded, 
            description,
            project:oj_projects(project_name)
        `)
        .eq('vendor_id', vendor.id)
        .eq('entry_type', 'time')
        .gte('entry_date', start)
        .lte('entry_date', end)
        .order('entry_date', { ascending: true });

    if (!entries) return;

    let total = 0;
    console.log('\nJanuary 2026 Entries:');
    entries.forEach(e => {
        const hours = (e.duration_minutes_rounded || 0) / 60;
        total += hours;
        // console.log(`[${e.entry_date}] ${hours}h - ${e.description.substring(0, 50)}`);
    });
    console.log(`\nTotal: ${total} hours`);

    // Sort by date and group by day
    // Print clear list for user
    console.log('\nDetailed List (for copy-paste review):');
    entries.forEach(e => {
        const hours = (e.duration_minutes_rounded || 0) / 60;
        console.log(`${e.entry_date}\t${hours}\t${e.description}`);
    });
}

listJan();
