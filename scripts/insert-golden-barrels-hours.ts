
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
    const supabase = createAdminClient();
    console.log('Starting Golden Barrels seed...');

    // 1. Ensure Vendor "Golden Barrels"
    let vendorId: string;
    const { data: existingVendor } = await supabase
        .from('invoice_vendors')
        .select('id')
        .ilike('name', 'Golden Barrels')
        .maybeSingle();

    if (existingVendor) {
        vendorId = existingVendor.id;
        console.log(`Found existing vendor: ${vendorId}`);
    } else {
        console.log('Creating vendor "Golden Barrels"...');
        const { data: newVendor, error } = await supabase
            .from('invoice_vendors')
            .insert({
                name: 'Golden Barrels',
                payment_terms: 30,
                is_active: true
            })
            .select('id')
            .single();

        if (error) throw new Error(`Failed to create vendor: ${error.message}`);
        vendorId = newVendor.id;
    }

    // 2. Ensure Vendor Settings
    const { data: settings } = await supabase
        .from('oj_vendor_billing_settings')
        .select('*')
        .eq('vendor_id', vendorId)
        .maybeSingle();

    let hourlyRate = 60;
    let vatRate = 20;

    if (!settings) {
        console.log('Creating billing settings...');
        const { error } = await supabase
            .from('oj_vendor_billing_settings')
            .insert({
                vendor_id: vendorId,
                billing_mode: 'full',
                hourly_rate_ex_vat: hourlyRate,
                vat_rate: vatRate,
                mileage_rate: 0.45
            });
        if (error) throw new Error(`Failed to create settings: ${error.message}`);
    } else {
        hourlyRate = settings.hourly_rate_ex_vat;
        vatRate = settings.vat_rate;
    }

    // 3. Ensure Project "Website Build"
    let projectId: string;
    const { data: existingProject } = await supabase
        .from('oj_projects')
        .select('id')
        .eq('vendor_id', vendorId)
        .ilike('project_name', 'Website Build')
        .maybeSingle();

    if (existingProject) {
        projectId = existingProject.id;
        console.log(`Found existing project: ${projectId}`);
    } else {
        console.log('Creating project "Website Build"...');
        // Generate a code - simplified logic for script
        const code = `OJP-GB-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const { data: newProject, error } = await supabase
            .from('oj_projects')
            .insert({
                vendor_id: vendorId,
                project_name: 'Website Build',
                project_code: code,
                status: 'active',
                budget_ex_vat: 3500
            })
            .select('id')
            .single();

        if (error) throw new Error(`Failed to create project: ${error.message}`);
        projectId = newProject.id;
    }

    // 4. Ensure Work Type "Development"
    let workTypeId: string;
    const { data: workType } = await supabase
        .from('oj_work_types')
        .select('id')
        .ilike('name', 'Development')
        .maybeSingle();

    if (workType) {
        workTypeId = workType.id;
    } else {
        console.log('Creating work type "Development"...');
        const { data: newWorkType, error } = await supabase
            .from('oj_work_types')
            .insert({ name: 'Development', is_active: true, sort_order: 10 })
            .select('id')
            .single();

        if (error) throw new Error(`Failed to create work type: ${error.message}`);
        workTypeId = newWorkType.id;
    }

    // 5. Cleanup incorrect 2025 entries & Insert 2026 Entries
    console.log('Cleaning up 2025 entries...');
    await supabase.from('oj_entries').delete().eq('project_id', projectId).gte('entry_date', '2025-01-01').lte('entry_date', '2025-12-31');

    // Schedule (Jan 2026):
    const entries = [
        { date: '2026-01-12', hours: 2, desc: 'Initial Setup & Scoping' },
        { date: '2026-01-13', hours: 5, desc: 'Frontend Architecture & Layout' },
        { date: '2026-01-14', hours: 4, desc: 'Component Development' },
        { date: '2026-01-15', hours: 6, desc: 'Core Features Implementation' },
        { date: '2026-01-16', hours: 3, desc: 'Responsive Design & Fixes' },
        { date: '2026-01-17', hours: 4, desc: 'Content Integration & Polish' },
        { date: '2026-01-18', hours: 1, desc: 'Final Deployment & Launch Checks' },
    ];

    console.log('Inserting 2026 entries...');

    for (const entry of entries) {
        // Check duplication
        const { count } = await supabase
            .from('oj_entries')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('entry_date', entry.date)
            .eq('duration_minutes_raw', entry.hours * 60);

        if (count && count > 0) {
            console.log(`Skipping duplicate for ${entry.date}`);
            continue;
        }

        const minutes = entry.hours * 60;

        const { error } = await supabase
            .from('oj_entries')
            .insert({
                vendor_id: vendorId,
                project_id: projectId,
                entry_type: 'time',
                entry_date: entry.date,
                start_at: `${entry.date} 09:00:00`, // Simplified
                end_at: `${entry.date} ${9 + entry.hours}:00:00`,
                duration_minutes_raw: minutes,
                duration_minutes_rounded: minutes, // Assuming whole hours
                work_type_id: workTypeId,
                work_type_name_snapshot: 'Development',
                description: entry.desc,
                billable: true,
                status: 'unbilled',
                hourly_rate_ex_vat_snapshot: hourlyRate,
                vat_rate_snapshot: vatRate,
                mileage_rate_snapshot: 0.45
            });

        if (error) {
            console.error(`Failed to insert ${entry.date}:`, error.message);
        } else {
            console.log(`Inserted ${entry.hours}h for ${entry.date}`);
        }
    }

    console.log('Done!');
}

main().catch(console.error);
