
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixTypo() {
    console.log('Finding "Consuluting" work type...');
    const { data: wt } = await supabase.from('oj_work_types').select('id, name').eq('name', 'Consuluting').single();

    if (wt) {
        console.log(`Found ID: ${wt.id}. Updating to "Consulting"...`);
        await supabase.from('oj_work_types').update({ name: 'Consulting' }).eq('id', wt.id);

        console.log('Updating snapshots in oj_entries...');
        await supabase.from('oj_entries')
            .update({ work_type_name_snapshot: 'Consulting' })
            .eq('work_type_name_snapshot', 'Consuluting');

        console.log('Done.');
    } else {
        console.log('"Consuluting" work type not found. Checking for "Consulting"...');
        const { data: correct } = await supabase.from('oj_work_types').select('id').eq('name', 'Consulting').single();
        if (correct) console.log(' "Consulting" exists.');
    }
}

fixTypo();
