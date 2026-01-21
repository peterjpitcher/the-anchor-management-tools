
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugSnapshots() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    console.log('Checking entries with 0 or null rate...');
    const { data: entries } = await supabase.from('oj_entries')
        .select(`id, entry_date, description, hourly_rate_ex_vat_snapshot, duration_minutes_rounded, project:oj_projects(project_name)`)
        .eq('vendor_id', vendor.id)
        .eq('entry_type', 'time')
        .order('entry_date', { ascending: false });

    if (!entries) return;

    let zeroCount = 0;
    entries.forEach(e => {
        const rate = e.hourly_rate_ex_vat_snapshot;
        if (rate === 0 || rate === null) {
            console.log(`[ZERO RATE] ${e.entry_date} - ${e.description.substring(0, 40)}... (Rate: ${rate}, Proj: ${e.project.project_name})`);
            zeroCount++;
        }
    });

    console.log(`\nFound ${zeroCount} entries with 0/null rate out of ${entries.length} total.`);

    // Check what the vendor settings says strictly
    const { data: settings } = await supabase.from('oj_vendor_billing_settings').select('*').eq('vendor_id', vendor.id).single();
    console.log('Current Vendor Settings:', settings);
}

debugSnapshots();
