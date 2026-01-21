
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Mimic the logic in getProjects since we can't easily import server actions in standalone script without transpilation
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
    // 1. Fetch projects
    const { data: projects } = await supabase
        .from('oj_projects')
        .select(`
          *,
          vendor:invoice_vendors(id, name)
        `)
        .order('created_at', { ascending: false });

    if (!projects) return;

    // 2. Fetch stats
    const projectIds = projects.map(p => p.id);
    let statsMap = new Map();

    if (projectIds.length > 0) {
        const { data: stats } = await supabase
            .from('oj_project_stats')
            .select('*')
            .in('project_id', projectIds);

        if (stats) {
            stats.forEach(s => statsMap.set(s.project_id, s));
        }
    }

    const result = projects.map(p => ({
        name: p.project_name,
        budget_hours: p.budget_hours,
        used_hours: statsMap.get(p.id)?.total_hours_used || 0,
        budget_cash: p.budget_ex_vat,
        used_cash: statsMap.get(p.id)?.total_spend_ex_vat || 0
    }));

    console.log('Project Stats Verification:');
    result.slice(0, 10).forEach(r => { // Show first 10
        console.log(`[${r.name}] Hours: ${Number(r.used_hours).toFixed(2)} / ${r.budget_hours}, Spend: ${Number(r.used_cash).toFixed(2)} / ${r.budget_cash}`);
    });
}

verify();
