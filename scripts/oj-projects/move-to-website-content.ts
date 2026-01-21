
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RAW_DATA = `Thursday, September 25, 2025	September 2025	5:00:00 PM	9:00:00 PM	4.00	£250.00		Demo Website Build
Friday, September 26, 2025	September 2025	1:00:00 PM	2:00:00 PM	1.00	£62.50		Website Discussion with Ben and Georgia
Friday, September 26, 2025	September 2025	3:00:00 PM	4:00:00 PM	1.00	£62.50		Marketing Scrum write up and website workshop planning
Thursday, November 6, 2025	November 2025	10:00:00 AM	11:00:00 AM	1.00	£62.50	Consulting	Website Kickoff Planning
Monday, November 10, 2025	November 2025	3:00:00 PM	3:30:00 PM	0.50	£31.25	Consulting	Website Kickoff Planning
Monday, December 1, 2025	December 2025	12:30:00 PM	1:00:00 PM	0.50	£31.25	Consulting	Drive from Website Kickoff
Monday, December 1, 2025	December 2025	8:30:00 AM	9:00:00 AM	0.50	£31.25	Consulting	Drive to Website Kickoff
Monday, December 1, 2025	December 2025	9:00:00 AM	12:30:00 PM	3.50	£218.75	Consulting	Website Kickoff
Monday, December 1, 2025	December 2025	1:00:00 PM	4:00:00 PM	3.00	£187.50	Consulting	Website Kickoff Write up & Follow up
Friday, December 12, 2025	December 2025	9:30:00 AM	11:30:00 AM	2.00	£125.00	Consulting	Website Meeting with Natalie at Meade Hall
Thursday, January 15, 2026	January 2026	12:30:00 PM	1:30:00 PM	1.00	£62.50	Consulting	Write up debrief from website call and marketing scrum
Friday, January 16, 2026	January 2026	10:00:00 AM	1:00:00 PM	3.00	£187.50	Consulting	Website Copy Validation Generation`;

function parseDate(dateStr: string) {
    const parts = dateStr.split(',');
    if (parts.length < 2) return new Date(dateStr).toISOString().slice(0, 10);

    let monthDay = '';
    let year = '';

    if (parts.length === 3) {
        monthDay = parts[1].trim();
        year = parts[2].trim();
    } else {
        monthDay = parts[0].trim();
        year = parts[1].trim();
    }

    const [monthName, day] = monthDay.split(' ');

    const months: { [key: string]: number } = {
        January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
        July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
    };

    const m = months[monthName];
    if (m === undefined) return new Date(dateStr).toISOString().slice(0, 10);

    const y = parseInt(year);
    const d = parseInt(day);

    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function clean(str: string) {
    if (!str) return '';
    return str.trim().replace(/^"|"$/g, '');
}

function norm(str: string) {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function moveEntries() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    console.log('Fetching Target Project: Website Content Creation...');
    const { data: project } = await supabase.from('oj_projects')
        .select('id, project_name')
        .eq('vendor_id', vendor.id)
        .ilike('project_name', '%Website Content Creation%')
        .single();

    if (!project) throw new Error('Project "Website Content Creation & Information Architecture" not found');

    console.log(`Target Project: ${project.project_name} (${project.id})`);

    // Fetch all vendor entries for lookup
    const { data: entries } = await supabase.from('oj_entries')
        .select('id, entry_date, description, project_id, project:oj_projects(project_name)')
        .eq('vendor_id', vendor.id);

    if (!entries) throw new Error('No entries found');

    const lines = RAW_DATA.split('\n').filter(l => l.trim().length > 0);

    let updatedCount = 0;

    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 8) continue;

        const dateRaw = clean(parts[0]);
        const dateIso = parseDate(dateRaw);
        const description = clean(parts[7] || parts[parts.length - 1]);

        const match = entries.find(e =>
            e.entry_date === dateIso &&
            norm(e.description || '') === norm(description)
        );

        if (match) {
            if (match.project_id === project.id) {
                console.log(`[SKIP] Already in project: ${dateIso} - ${description}`);
            } else {
                console.log(`[MOVING] ${dateIso} - ${description}`);
                console.log(`    From: ${match.project.project_name}`);
                console.log(`    To:   ${project.project_name}`);

                await supabase.from('oj_entries').update({
                    project_id: project.id
                }).eq('id', match.id);
                updatedCount++;
            }
        } else {
            console.error(`[NOT FOUND] ${dateIso} - ${description}`);
            // Check for fuzzy descriptions?
        }
    }

    console.log(`Updated ${updatedCount} entries.`);
}

moveEntries();
