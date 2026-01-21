
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
    const vendorId = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3';

    // Find Projects
    const { data: projects, error } = await supabase
        .from('oj_projects')
        .select('*')
        .eq('vendor_id', vendorId);

    if (error) {
        console.error('Project Error:', error);
    } else {
        console.log('Projects for Barons:', projects);
    }
}

main();
