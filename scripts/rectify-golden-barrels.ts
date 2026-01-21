
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
    const supabase = createAdminClient();
    console.log('Starting Golden Barrels Rectification...');

    const VENDOR_ID = '227df11c-9f6b-4a87-b45f-ee341cb509d2'; // Golden Barrels Limited
    const PROJECT_ID = '26e5a0f3-59c4-45d4-b454-378bcba1001f'; // Website Build

    // 1. Get/Set Billing Settings (Rate)
    let hourlyRate = 60;
    let vatRate = 20;

    const { data: settings } = await supabase
        .from('oj_vendor_billing_settings')
        .select('*')
        .eq('vendor_id', VENDOR_ID)
        .maybeSingle();

    if (settings) {
        console.log(`Found settings. Rate: £${settings.hourly_rate_ex_vat}/hr`);
        hourlyRate = settings.hourly_rate_ex_vat;
        vatRate = settings.vat_rate;
    } else {
        console.log('No settings found. Creating default (£60/hr)...');
        const { error } = await supabase
            .from('oj_vendor_billing_settings')
            .insert({
                vendor_id: VENDOR_ID,
                billing_mode: 'full',
                hourly_rate_ex_vat: hourlyRate,
                vat_rate: vatRate,
                mileage_rate: 0.45
            });
        if (error) throw new Error(`Failed to create settings: ${error.message}`);
    }

    // 2. Get Work Type
    let workTypeId: string;
    const { data: workType } = await supabase
        .from('oj_work_types')
        .select('id')
        .ilike('name', 'Development')
        .maybeSingle();

    if (workType) {
        workTypeId = workType.id;
    } else {
        console.log('Creating "Development" work type...');
        const { data: newWT, error } = await supabase
            .from('oj_work_types')
            .insert({ name: 'Development', is_active: true, sort_order: 10 })
            .select('id')
            .single();
        if (error) throw new Error(`Failed to create work type: ${error.message}`);
        workTypeId = newWT.id;
    }

    // 3. Entries
    const entries = [
        { date: '2026-01-12', hours: 2, desc: 'Initial Setup & Scoping' },
        { date: '2026-01-13', hours: 5, desc: 'Frontend Architecture & Layout' },
        { date: '2026-01-14', hours: 4, desc: 'Component Development' },
        { date: '2026-01-15', hours: 6, desc: 'Core Features Implementation' },
        { date: '2026-01-16', hours: 3, desc: 'Responsive Design & Fixes' },
        { date: '2026-01-17', hours: 4, desc: 'Content Integration & Polish' },
        { date: '2026-01-18', hours: 1, desc: 'Final Deployment & Launch Checks' },
    ];

    console.log(`Inserting ${entries.length} entries...`);

    for (const entry of entries) {
        // Check duplication
        const minutes = entry.hours * 60;
        const { count } = await supabase
            .from('oj_entries')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', PROJECT_ID)
            .eq('entry_date', entry.date)
            .eq('duration_minutes_raw', minutes);

        if (count && count > 0) {
            console.log(`Skipping duplicate for ${entry.date}`);
            continue;
        }

        const { error } = await supabase
            .from('oj_entries')
            .insert({
                vendor_id: VENDOR_ID,
                project_id: PROJECT_ID,
                entry_type: 'time',
                entry_date: entry.date,
                start_at: `${entry.date} 09:00:00`,
                end_at: `${entry.date} ${9 + entry.hours}:00:00`,
                duration_minutes_raw: minutes,
                duration_minutes_rounded: minutes,
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
    console.log('Done.');
}

main().catch(console.error);
