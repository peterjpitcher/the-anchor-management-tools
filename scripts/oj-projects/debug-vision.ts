
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function listVision() {
    const { data: proj } = await supabase.from('oj_projects').select('id, vendor_id').eq('project_name', 'Vision Workshop').single();
    if (!proj) { console.log('Vision Workshop project not found'); return; }

    console.log(`Vision Workshop Project ID: ${proj.id}, Vendor ID: ${proj.vendor_id}`);

    const { data: entries } = await supabase.from('oj_entries')
        .select('*')
        .eq('project_id', proj.id);

    console.log(`Found ${entries?.length} entries:`);
    entries?.forEach(e => {
        console.log(`- ${e.entry_date} (${e.duration_minutes_rounded / 60}h): ${e.description}, Vendor: ${e.vendor_id}`);
    });
}

listVision();
