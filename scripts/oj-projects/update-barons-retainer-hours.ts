
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'; // Barons Pubs
const NEW_HOURS = 30;

async function main() {
    console.log(`Updating Barons Pubs retainer hours to ${NEW_HOURS}...`);

    // 1. Update Existing Retainer Projects
    const { data: projects, error: projectError } = await supabase
        .from('oj_projects')
        .update({ budget_hours: NEW_HOURS })
        .eq('vendor_id', VENDOR_ID)
        .eq('is_retainer', true)
        .select();

    if (projectError) {
        console.error('Error updating projects:', projectError);
    } else {
        console.log(`Updated ${projects?.length} existing retainer projects.`);
    }

    // 2. Update Vendor Settings for future reference
    // First check if settings exist
    const { data: settings } = await supabase
        .from('oj_vendor_billing_settings')
        .select('*')
        .eq('vendor_id', VENDOR_ID)
        .maybeSingle();

    if (settings) {
        const { error: settingsError } = await supabase
            .from('oj_vendor_billing_settings')
            .update({ retainer_included_hours_per_month: NEW_HOURS })
            .eq('vendor_id', VENDOR_ID);

        if (settingsError) console.error('Error updating settings:', settingsError);
        else console.log('Updated vendor billing settings default.');
    } else {
        // Insert if not exists (though usually it should exist if they have projects)
        const { error: insertError } = await supabase
            .from('oj_vendor_billing_settings')
            .insert({
                vendor_id: VENDOR_ID,
                retainer_included_hours_per_month: NEW_HOURS,
                billing_mode: 'full'
            });

        if (insertError) console.error('Error inserting settings:', insertError);
        else console.log('Created vendor billing settings with default.');
    }

    console.log('Update Complete.');
}

main();
