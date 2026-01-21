
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
    console.log('Searching for Golden Barrels vendor...');
    const { data: vendors, error: vendorError } = await supabase
        .from('invoice_vendors') // Assuming this is the vendors table based on doc "stakeholder names must be matched against the invoice_vendors table"
        .select('*')
        .ilike('name', '%Golden%')
        .limit(1);

    if (vendorError) {
        console.error('Error finding vendor:', vendorError);
        return;
    }

    if (!vendors || vendors.length === 0) {
        console.error('No vendor found matching "Golden"');
        return;
    }

    const vendor = vendors[0];
    console.log(`Found Vendor: ${vendor.name} (${vendor.id})`);

    // Get Projects
    console.log('\nFetching Projects...');
    const { data: projects, error: projectError } = await supabase
        .from('oj_projects')
        .select('*')
        .eq('vendor_id', vendor.id)
        .order('created_at', { ascending: false });

    if (projectError) {
        console.error('Error fetching projects:', projectError);
        return;
    }

    if (projects.length > 0) {
        console.log('Project Table Keys:', Object.keys(projects[0]));
    }

    console.log(`Found ${projects.length} projects.`);
    projects.forEach(p => {
        console.log(`- [${p.status}] ${p.project_name} (ID: ${p.id})`);
        console.log(`  Retainer: ${p.is_retainer} | Period: ${p.retainer_period_yyyymm} | Budget: ${p.budget_hours}h | Budget £: ${p.budget_ex_vat}`);
    });

    // Get Unbilled Entries
    console.log('\nFetching Unbilled Entries...');
    const projectIds = projects.map(p => p.id);
    const { data: entries, error: entryError } = await supabase
        .from('oj_entries')
        .select('*')
        .in('project_id', projectIds)
        .eq('status', 'unbilled')
        .order('entry_date', { ascending: true }); // Sort by date

    if (entryError) {
        console.error('Error fetching entries:', entryError);
        return;
    }

    if (entries.length > 0) {
        const firstDate = entries[0].entry_date;
        const lastDate = entries[entries.length - 1].entry_date;
        console.log(`Entry Date Range: ${firstDate} to ${lastDate}`);
    }

    const totalMinutes = entries.reduce((acc, e) => acc + (e.duration_minutes_rounded || 0), 0);
    const totalHours = totalMinutes / 60;
    const totalSpend = entries.reduce((acc, e) => {
        // Simple approx calculation
        if (e.entry_type === 'time') {
            return acc + ((e.duration_minutes_rounded || 0) / 60) * (e.hourly_rate_ex_vat_snapshot || 0);
        }
        return acc;
    }, 0);

    console.log(`Found ${entries.length} unbilled entries.`);
    console.log(`Total Unbilled Work: ${totalHours.toFixed(2)} hours`);
    console.log(`Approx Unbilled Value: £${totalSpend.toFixed(2)}`);

    // Check Vendor Billing Settings
    // I am guessing the table name based on docs "oj_vendor_billing_settings"
    console.log('\nFetching Vendor Billing Settings...');
    const { data: settings, error: settingsError } = await supabase
        .from('oj_vendor_billing_settings')
        .select('*')
        .eq('vendor_id', vendor.id);

    if (settingsError) {
        // It might not exist or be named differently, just log error but don't fail hard
        console.log('Could not fetch billing settings (table might be named differently or empty):', settingsError.message);
    } else {
        console.log('Billing Settings:', settings);
    }

}

main();
