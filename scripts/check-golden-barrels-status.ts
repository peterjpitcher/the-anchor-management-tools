
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
    const supabase = createAdminClient();
    console.log('Checking Golden Barrels account status...');

    // 1. Check for both vendors
    console.log('--- Checking Vendors ---');
    const { data: vendors } = await supabase
        .from('invoice_vendors')
        .select('*')
        .ilike('name', '%Golden Barrels%');

    console.log('Vendors found:', vendors);

    const vendorIds = vendors?.map(v => v.id) || [];

    // 2. Check Entries for these vendors
    console.log('--- Checking Entries ---');
    if (vendorIds.length > 0) {
        const { data: entries } = await supabase
            .from('oj_entries')
            .select('vendor_id, project_id, status, duration_minutes_rounded, entry_date')
            .in('vendor_id', vendorIds)
            .gte('entry_date', '2026-01-01');

        // Group by vendor
        const byVendor: Record<string, number> = {};
        entries?.forEach(e => {
            byVendor[e.vendor_id] = (byVendor[e.vendor_id] || 0) + (e.duration_minutes_rounded || 0);
        });

        for (const [vid, mins] of Object.entries(byVendor)) {
            console.log(`Vendor ${vid}: ${mins / 60} hours logged`);
        }
    }

    // 3. Check Invoices
    console.log('--- Checking Invoices ---');
    const invoiceRefs = ['INV-003VB', 'INV-003VI'];
    const { data: invoices } = await supabase
        .from('invoices')
        .select('*')
        .in('invoice_number', invoiceRefs);

    console.log('Invoices found:', invoices);

}

main().catch(console.error);
