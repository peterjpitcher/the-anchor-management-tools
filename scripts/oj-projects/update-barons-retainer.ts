
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'; // Barons Pubs
const RET_MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01'];
const TRANSIT_WORK_TYPE_ID = '55f8821f-d3b3-4550-a4fe-d0321bc59ef4';

async function getOrCreateRetainerProject(yyyymm: string) {
    const [year, month] = yyyymm.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthName = date.toLocaleString('default', { month: 'long' });
    const projectName = `Monthly Retainer - ${monthName} ${year}`;
    const projectCode = `RET-BAR-${year}-${month}`;

    // Check if exists
    const { data: existing } = await supabase
        .from('oj_projects')
        .select('id')
        .eq('vendor_id', VENDOR_ID)
        .eq('is_retainer', true)
        .eq('retainer_period_yyyymm', yyyymm)
        .maybeSingle();

    if (existing) return existing.id;

    // Create
    const { data: newProject, error } = await supabase
        .from('oj_projects')
        .insert({
            vendor_id: VENDOR_ID,
            project_name: projectName,
            project_code: projectCode,
            is_retainer: true,
            retainer_period_yyyymm: yyyymm,
            status: 'active',
            budget_hours: 10, // Default assumption, can be adjusted
        })
        .select('id')
        .single();

    if (error) {
        console.error(`Error creating project for ${yyyymm}:`, error);
        throw error;
    }

    console.log(`Created project: ${projectName} (${newProject.id})`);
    return newProject.id;
}

async function main() {
    // 1. Ensure projects exist map
    const projectMap: Record<string, string> = {};
    for (const ym of RET_MONTHS) {
        projectMap[ym] = await getOrCreateRetainerProject(ym);
    }

    // 2. Fetch all Barons entries
    const { data: entries, error } = await supabase
        .from('oj_entries')
        .select('*')
        .eq('vendor_id', VENDOR_ID);

    if (error || !entries) {
        console.error('Error fetching entries', error);
        return;
    }

    console.log(`Scanning ${entries.length} entries for migration...`);

    let movedCount = 0;
    let mileageAddedCount = 0;

    for (const entry of entries) {
        const entryMonth = entry.entry_date.substring(0, 7); // YYYY-MM
        const targetProjectId = projectMap[entryMonth];

        if (!targetProjectId) {
            // Entry might be outside of our range (e.g. earlier?). 
            // If the entry matches criteria, we might need to create a project on the fly, 
            // but for now we stick to the plan.
            continue;
        }

        const desc = (entry.description || '').toLowerCase();
        const isMarketingScrum = desc.includes('marketing scrum');
        const isTransit = entry.work_type_id === TRANSIT_WORK_TYPE_ID || desc.includes('drive');

        if (isMarketingScrum || isTransit) {
            if (entry.project_id !== targetProjectId) {
                // Move it
                const { error: moveError } = await supabase
                    .from('oj_entries')
                    .update({ project_id: targetProjectId })
                    .eq('id', entry.id);

                if (moveError) console.error(`Error moving entry ${entry.id}:`, moveError);
                else {
                    movedCount++;
                    // console.log(`Moved entry ${entry.entry_date} "${entry.description}" to retainer.`);
                }
            } else {
                // Already in correct project (maybe re-running script)
            }

            // If it is Transit, check mileage
            if (isTransit) {
                // Check if mileage exists for this date/project with 28 miles
                const { data: existingMileage } = await supabase
                    .from('oj_entries')
                    .select('id')
                    .eq('project_id', targetProjectId)
                    .eq('entry_type', 'mileage')
                    .eq('entry_date', entry.entry_date)
                    .eq('miles', 28)
                    .maybeSingle();

                if (!existingMileage) {
                    const { error: mileageError } = await supabase
                        .from('oj_entries')
                        .insert({
                            vendor_id: VENDOR_ID,
                            project_id: targetProjectId,
                            entry_type: 'mileage',
                            entry_date: entry.entry_date,
                            miles: 28,
                            description: `Mileage for: ${entry.description}`,
                            status: entry.status, // Copy paid status
                            paid_at: entry.paid_at,
                            billable: true,
                            // Using dummy snapshot values or nulls - usually fetched from settings but good enough for backfill
                            mileage_rate_snapshot: 0.42
                        });

                    if (mileageError) console.error(`Error adding mileage for ${entry.id}:`, mileageError);
                    else mileageAddedCount++;
                }
            }
        }
    }

    console.log('Migration Complete.');
    console.log(`Moved Entries: ${movedCount}`);
    console.log(`Mileage Entries Added: ${mileageAddedCount}`);
}

main();
