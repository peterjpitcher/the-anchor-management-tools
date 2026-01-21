
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
    const supabase = createAdminClient();
    const vendorId = '227df11c-9f6b-4a87-b45f-ee341cb509d2';

    console.log(`Checking projects for vendor: ${vendorId}`);

    const { data: projects } = await supabase
        .from('oj_projects')
        .select('*')
        .eq('vendor_id', vendorId);

    console.log('Projects found:', projects);
}

main().catch(console.error);
