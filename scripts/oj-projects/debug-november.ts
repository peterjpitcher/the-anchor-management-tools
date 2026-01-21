
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugNov() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    const start = '2025-11-01';
    const end = '2025-11-30';

    console.log(`Searching for entries between ${start} and ${end}...`);

    const { data: entries } = await supabase.from('oj_entries')
        .select(`
            *,
            project:oj_projects(project_name),
            work_type:oj_work_types(name)
        `)
        .eq('vendor_id', vendor.id)
        .gte('entry_date', start)
        .lte('entry_date', end)
        .order('entry_date');

    if (!entries) {
        console.log('No entries found.');
        return;
    }

    let totalHours = 0;

    console.log(`\nFound ${entries.length} entries:`);
    entries.forEach(e => {
        const hours = (e.duration_minutes_rounded || 0) / 60;
        totalHours += hours;
        console.log(`[${e.entry_date}] ${hours}h - ${e.project?.project_name.padEnd(40)} - ${e.description}`);
    });

    console.log(`\nTotal Hours for November 2025: ${totalHours}`);
}

debugNov();
