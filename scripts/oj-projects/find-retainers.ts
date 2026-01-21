
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const vendorId = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'; // Barons Pubs

    const { data: projects, error } = await supabase
        .from('oj_projects')
        .select('*')
        .eq('vendor_id', vendorId)
        .eq('is_retainer', true);

    if (error) console.error(error);
    else console.log('Retainer Projects:', projects);
}

main();
