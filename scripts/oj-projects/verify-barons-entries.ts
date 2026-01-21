
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
    const { data: entries, error } = await supabase
        .from('oj_entries')
        .select('*')
        .eq('vendor_id', 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3') // Barons Pubs
        .order('entry_date', { ascending: true });

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Total Entries Found: ${entries.length}`);

    const paidEntries = entries.filter(e => e.status === 'paid');
    const unbilledEntries = entries.filter(e => e.status === 'unbilled');

    console.log(`Paid Entries: ${paidEntries.length}`);
    console.log(`Unbilled Entries: ${unbilledEntries.length}`);

    // Check date boundary
    const paidWrongDate = paidEntries.filter(e => new Date(e.entry_date) > new Date('2025-12-31'));
    const unbilledWrongDate = unbilledEntries.filter(e => new Date(e.entry_date) <= new Date('2025-12-31'));

    if (paidWrongDate.length > 0) console.error('Found paid entries after cutoff!', paidWrongDate);
    if (unbilledWrongDate.length > 0) console.error('Found unbilled entries before cutoff!', unbilledWrongDate);

    if (paidWrongDate.length === 0 && unbilledWrongDate.length === 0) {
        console.log('Date boundary check passed.');
    }
}

verify();
