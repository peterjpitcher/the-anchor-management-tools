
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TARGETS: Record<string, number> = {
    '2025-09': 31.5,
    '2025-10': 37,
    '2025-11': 1.5,
    '2025-12': 35,
    '2026-01': 30
};

async function verify() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor "Barons Pubs" not found');

    const { data: entries } = await supabase.from('oj_entries')
        .select('entry_date, duration_minutes_rounded')
        .eq('vendor_id', vendor.id)
        .eq('entry_type', 'time'); // Only time entries

    if (!entries) return;

    const totals: Record<string, number> = {};

    entries.forEach(e => {
        const date = e.entry_date; // YYYY-MM-DD
        const month = date.slice(0, 7); // YYYY-MM
        const hours = (e.duration_minutes_rounded || 0) / 60;

        totals[month] = (totals[month] || 0) + hours;
    });

    console.log('\nMonthly Hours Verification for Barons Pubs:');
    console.log('Month\tActual\tTarget\tMatch?');
    console.log('----------------------------------------');

    let allMatch = true;
    for (const [month, expected] of Object.entries(TARGETS).sort()) {
        const actual = totals[month] || 0;
        const diff = actual - expected;
        const match = Math.abs(diff) < 0.01; // Float tolerance
        if (!match) allMatch = false;

        console.log(`${month}\t${actual}\t${expected}\t${match ? '✅' : '❌ (' + (diff > 0 ? '+' : '') + diff + ')'}`);
    }

    // Check for extra months?
    console.log('\nOther Months found:');
    for (const [month, total] of Object.entries(totals).sort()) {
        if (!TARGETS[month]) {
            console.log(`${month}\t${total}`);
        }
    }
}

verify();
