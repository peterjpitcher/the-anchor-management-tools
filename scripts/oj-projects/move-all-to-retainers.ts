
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function moveAllToRetainers() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor "Barons Pubs" not found');

    console.log('Fetching all entries for Barons Pubs...');
    const { data: entries } = await supabase.from('oj_entries')
        .select(`id, entry_date, description, project_id, project:oj_projects(project_name)`)
        .eq('vendor_id', vendor.id);

    if (!entries || entries.length === 0) {
        console.log('No entries found.');
        return;
    }

    console.log(`Found ${entries.length} entries.`);

    // Cache projects
    const { data: existingProjects } = await supabase.from('oj_projects')
        .select('id, project_name, retainer_period_yyyymm')
        .eq('vendor_id', vendor.id);

    let projects = existingProjects || [];

    // Group entries by target month
    for (const entry of entries) {
        const date = new Date(entry.entry_date);
        const monthName = date.toLocaleString('default', { month: 'long' });
        const year = date.getFullYear();
        const monthNum = String(date.getMonth() + 1).padStart(2, '0');
        const period = `${year}-${monthNum}`;

        const targetProjectName = `Monthly Retainer - ${monthName} ${year}`;
        const targetProjectCode = `RET-BAR-${year}-${monthNum}`; // Standard code

        // Find project
        let project = projects.find(p => p.retainer_period_yyyymm === period);

        if (!project) {
            // Check by name just in case
            project = projects.find(p => p.project_name === targetProjectName);
        }

        if (!project) {
            console.log(`Creating new project: ${targetProjectName} (${period})`);
            const { data: newProj, error } = await supabase.from('oj_projects').insert({
                vendor_id: vendor.id,
                project_name: targetProjectName,
                project_code: targetProjectCode,
                status: 'active',
                is_retainer: true,
                retainer_period_yyyymm: period,
                budget_hours: 30
            }).select().single();

            if (error) {
                console.error(`Error creating project ${targetProjectName}:`, error);
                continue;
            }
            project = newProj;
            projects.push(newProj);
        }

        // Move entry if not already there
        if (entry.project_id !== project.id) {
            console.log(`Moving "${entry.description}" (${entry.entry_date}) from "${entry.project.project_name}" to "${targetProjectName}"`);

            const { error: moveError } = await supabase.from('oj_entries')
                .update({ project_id: project.id })
                .eq('id', entry.id);

            if (moveError) {
                console.error(`Failed to move entry ${entry.id}:`, moveError);
            }
        }
    }

    console.log('Migration complete.');
}

moveAllToRetainers();
