
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixRates() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    const { data: settings } = await supabase.from('oj_vendor_billing_settings').select('hourly_rate_ex_vat').eq('vendor_id', vendor.id).single();
    const rate = settings?.hourly_rate_ex_vat || 62.5;

    console.log(`Using rate: £${rate}`);

    console.log('Updating entries with null/zero rate...');
    const { error, count } = await supabase
        .from('oj_entries')
        .update({ hourly_rate_ex_vat_snapshot: rate })
        .eq('vendor_id', vendor.id)
        .eq('entry_type', 'time')
        .is('hourly_rate_ex_vat_snapshot', null)
        .select('id', { count: 'exact' });

    if (error) console.error('Error updating:', error);
    else console.log(`Updated ${count} entries.`);

    // Also check for 0
    const { error: err2, count: count2 } = await supabase
        .from('oj_entries')
        .update({ hourly_rate_ex_vat_snapshot: rate })
        .eq('vendor_id', vendor.id)
        .eq('entry_type', 'time')
        .eq('hourly_rate_ex_vat_snapshot', 0)
        .select('id', { count: 'exact' });

    if (err2) console.error('Error updating zero rates:', err2);
    else console.log(`Updated ${count2} entries with 0 rate.`);
}

fixRates();
