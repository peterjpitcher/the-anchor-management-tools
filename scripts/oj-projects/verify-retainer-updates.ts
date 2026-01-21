
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3';

async function verify() {
    const { data: entries } = await supabase
        .from('oj_entries')
        .select(`
        *,
        project:oj_projects(project_name, is_retainer)
    `)
        .eq('vendor_id', VENDOR_ID);

    console.log(`Total Entries: ${entries?.length}`);

    const retainerEntries = entries?.filter(e => e.project.is_retainer);
    console.log(`Retainer Entries: ${retainerEntries?.length}`);

    const mileageEntries = entries?.filter(e => e.entry_type === 'mileage');
    console.log(`Mileage Entries: ${mileageEntries?.length}`);

    const mileage28 = mileageEntries?.filter(e => e.miles === 28);
    console.log(`28-mile Entries: ${mileage28?.length}`);

    // Check that every 28-mile entry has a corresponding transit entry on the same day?
    // We can just spot check a few dates
    const sample = mileage28?.[0];
    if (sample) {
        console.log('Sample Mileage:', sample.entry_date, sample.project?.project_name);
    }
}

verify();
