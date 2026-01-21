
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RAW_DATA = `Thursday, September 4, 2025	September 2025	11:30:00 AM	12:30:00 PM	1.00	£62.50		Call with Zonal
Wednesday, September 10, 2025	September 2025	5:30:00 PM	7:30:00 PM	2.00	£125.00		Marketing Workshop Prep
Friday, September 12, 2025	September 2025	9:00:00 AM	9:30:00 AM	0.50	£31.25		Driving to Marketing Workshop
Friday, September 12, 2025	September 2025	1:30:00 PM	2:00:00 PM	0.50	£31.25		Driving from Marketing Workshop
Friday, September 12, 2025	September 2025	9:30:00 AM	12:30:00 PM	3.00	£187.50		Marketing Workshop
Friday, September 12, 2025	September 2025	12:30:00 PM	1:30:00 PM	1.00	£62.50		Georgia Follow Up
Wednesday, September 17, 2025	September 2025	9:30:00 AM	10:00:00 AM	0.50	£31.25		Meeting notes write up and follow up
Wednesday, September 17, 2025	September 2025	4:00:00 PM	5:30:00 PM	1.50	£93.75		Zonal loyalty call
Thursday, September 18, 2025	September 2025	9:45:00 AM	10:30:00 AM	0.75	£46.88		Call with Andrew Hart discussing tech stack
Thursday, September 18, 2025	September 2025	10:30:00 AM	11:30:00 AM	1.00	£62.50		Writing up tech stack and outstanding questions
Friday, September 19, 2025	September 2025	9:00:00 AM	9:30:00 AM	0.50	£31.25		Driving to Marketing Scrum & Tech Stack Connect
Friday, September 19, 2025	September 2025	1:00:00 PM	1:30:00 PM	0.50	£31.25		Driving from Marketing Scrum & Tech Stack Connect
Friday, September 19, 2025	September 2025	9:30:00 AM	1:00:00 PM	3.50	£218.75		Marketing Scrum and Tech Stack Connect
Friday, September 19, 2025	September 2025	2:00:00 PM	4:00:00 PM	2.00	£125.00		Marketing Scrum Write Up & Actions
Monday, September 22, 2025	September 2025	3:00:00 PM	4:00:00 PM	1.00	£62.50		Event Brief Development for Key Events
Thursday, September 25, 2025	September 2025	10:30:00 AM	11:15:00 AM	0.75	£46.88		Call with Airship
Thursday, September 25, 2025	September 2025	5:00:00 PM	9:00:00 PM	4.00	£250.00		Demo Website Build
Friday, September 26, 2025	September 2025	10:00:00 AM	1:00:00 PM	3.00	£187.50		Marketing Scrum
Friday, September 26, 2025	September 2025	9:30:00 AM	10:00:00 AM	0.50	£31.25		Drive to Marketing Scrum
Friday, September 26, 2025	September 2025	1:00:00 PM	2:00:00 PM	1.00	£62.50		Website Discussion with Ben and Georgia
Friday, September 26, 2025	September 2025	2:00:00 PM	2:30:00 PM	0.50	£31.25		Drive from Marketing Scrum
Friday, September 26, 2025	September 2025	3:00:00 PM	4:00:00 PM	1.00	£62.50		Marketing Scrum write up and website workshop planning
Monday, September 29, 2025	September 2025	11:00:00 AM	12:30:00 PM	1.50	£93.75		Guest Engagement Workshop Setup & Research
Thursday, October 9, 2025	October 2025	3:30:00 PM	4:00:00 PM	0.50	£31.25		Google Search Console follow up with Ben
Friday, October 10, 2025	October 2025	8:30:00 AM	9:00:00 AM	0.50	£31.25		Drive to Marketing Scrum
Friday, October 10, 2025	October 2025	9:00:00 AM	11:00:00 AM	2.00	£125.00		Marketing Scrum & Event Actioning
Friday, October 10, 2025	October 2025	11:00:00 AM	11:30:00 AM	0.50	£31.25		Drive from Marketing Scrum
Tuesday, October 14, 2025	October 2025	5:00:00 PM	10:00:00 PM	5.00	£312.50		Prep for Workshop (consolidation of feedback)
Tuesday, October 14, 2025	October 2025	5:00:00 AM	11:00:00 AM	6.00	£375.00		Barons Events Application Demo Build
Thursday, October 16, 2025	October 2025	8:30:00 AM	9:00:00 AM	0.50	£31.25		Drive to The Star, Guest Engagement Workshop
Thursday, October 16, 2025	October 2025	9:00:00 AM	12:00:00 PM	3.00	£187.50		Guest Engagement Workshop
Thursday, October 16, 2025	October 2025	12:00:00 PM	12:30:00 PM	0.50	£31.25		Drive back from The Star, Guest Engagement Workshop
Thursday, October 16, 2025	October 2025	2:00:00 PM	6:00:00 PM	4.00	£250.00		Write up from Guest Engagement Workshop
Friday, October 17, 2025	October 2025	8:00:00 AM	2:00:00 PM	6.00	£375.00		Barons Events Application Demo Build
Sunday, October 19, 2025	October 2025	5:00:00 PM	9:00:00 PM	4.00	£250.00		Barons Events Application Demo Build
Monday, October 20, 2025	October 2025	7:00:00 AM	11:30:00 AM	4.50	£281.25		Barons Events Application Demo Build
Thursday, November 6, 2025	November 2025	10:00:00 AM	11:00:00 AM	1.00	£62.50	Consulting	Website Kickoff Planning
Monday, November 10, 2025	November 2025	3:00:00 PM	3:30:00 PM	0.50	£31.25	Consulting	Website Kickoff Planning
Monday, December 1, 2025	December 2025	12:30:00 PM	1:00:00 PM	0.50	£31.25	Consulting	Drive from Website Kickoff
Monday, December 1, 2025	December 2025	8:30:00 AM	9:00:00 AM	0.50	£31.25	Consulting	Drive to Website Kickoff
Monday, December 1, 2025	December 2025	9:00:00 AM	12:30:00 PM	3.50	£218.75	Consulting	Website Kickoff
Monday, December 1, 2025	December 2025	1:00:00 PM	4:00:00 PM	3.00	£187.50	Consulting	Website Kickoff Write up & Follow up
Tuesday, December 2, 2025	December 2025	8:00:00 PM	9:00:00 PM	1.00	£62.50	Consulting	Photography Session Planning & Prep
Wednesday, December 3, 2025	December 2025	12:00:00 PM	1:30:00 PM	1.50	£93.75	Consulting	CareerHub Requirements Development
Tuesday, December 9, 2025	December 2025	3:00:00 PM	3:30:00 PM	0.50	£31.25	Consulting	Organising Connect Dates
Thursday, December 11, 2025	December 2025	1:00:00 PM	1:30:00 PM	0.50	£31.25	Consulting	Drive from The Cricketers
Thursday, December 11, 2025	December 2025	9:30:00 AM	10:00:00 AM	0.50	£31.25	Consulting	Drive to The Cricketers
Thursday, December 11, 2025	December 2025	10:00:00 AM	1:00:00 PM	3.00	£187.50	Consulting	Marketing Scrum & Brand Guidelines Review with Georgia
Friday, December 12, 2025	December 2025	11:30:00 AM	12:00:00 PM	0.50	£31.25	Consulting	Drive from Meade Hall
Friday, December 12, 2025	December 2025	9:00:00 AM	9:30:00 AM	0.50	£31.25	Consulting	Drive to Meade Hall
Friday, December 12, 2025	December 2025	9:30:00 AM	11:30:00 AM	2.00	£125.00	Consulting	Website Meeting with Natalie at Meade Hall
Monday, December 15, 2025	December 2025	10:30:00 AM	6:00:00 PM	7.50	£468.75	Development	CareerHub Build
Monday, December 15, 2025	December 2025	9:30:00 AM	10:30:00 AM	1.00	£62.50	Consulting	CareerHub Call with Helene/Kate
Tuesday, December 16, 2025	December 2025	5:30:00 PM	9:00:00 PM	3.50	£218.75	Development	CareerHub Build
Wednesday, December 17, 2025	December 2025	6:00:00 AM	11:30:00 AM	5.50	£343.75	Development	CareerHub Build
Friday, January 2, 2026	January 2026	4:30:00 PM	5:00:00 PM	0.50	£31.25	Development	Adding delete and cost tracking functionality to EventHub
Monday, January 5, 2026	January 2026	7:00:00 AM	9:00:00 AM	2.00	£125.00	Consulting	Marketing SCRUM Prep
Monday, January 5, 2026	January 2026	1:30:00 PM	2:00:00 PM	0.50	£31.25	Consulting	Drive to The Cricketers
Monday, January 5, 2026	January 2026	2:00:00 PM	4:00:00 PM	2.00	£125.00	Consulting	Weekly Marketing SCRUM
Monday, January 5, 2026	January 2026	4:00:00 PM	4:30:00 PM	0.50	£31.25	Consulting	Drive from The Cricketers
Wednesday, January 7, 2026	January 2026	2:00:00 PM	2:30:00 PM	0.50	£31.25	Consuling	Favourite Table Media engagement
Wednesday, January 7, 2026	January 2026	2:30:00 PM	3:30:00 PM	1.00	£62.50	Development	Fixing delete error and form validation in EventHub
Monday, January 12, 2026	January 2026	9:00:00 AM	9:30:00 AM	0.50	£31.25	Consulting	Phone connect with Helen. Favourite Table media options.
Monday, January 12, 2026	January 2026	9:30:00 AM	10:30:00 AM	1.00	£62.50	Consulting	Call with Helen to discuss open work
Monday, January 12, 2026	January 2026	10:30:00 AM	12:00:00 PM	1.50	£93.75	Consulting	FavouriteTable media options email chain/discussion / table booking media strategy development
Wednesday, January 14, 2026	January 2026	7:00:00 AM	9:00:00 AM	2.00	£125.00	Consulting	Marketing SCRUM Prep
Thursday, January 15, 2026	January 2026	12:30:00 PM	1:30:00 PM	1.00	£62.50	Consulting	Write up debrief from website call and marketing scrum
Thursday, January 15, 2026	January 2026	9:00:00 AM	9:30:00 AM	0.50	£31.25	Consulting	Drive to Marketing scrum
Thursday, January 15, 2026	January 2026	12:00:00 PM	12:30:00 PM	0.50	£31.25	Consulting	Drive from Marketing scrum
Thursday, January 15, 2026	January 2026	9:30:00 AM	12:00:00 PM	2.50	£156.25	Consulting	Marketing Scrum
Friday, January 16, 2026	January 2026	10:00:00 AM	1:00:00 PM	3.00	£187.50	Consulting	Website Copy Validation Generation
Monday, January 19, 2026	January 2026	7:00:00 AM	9:00:00 AM	2.00	£125.00	Consulting	Marketing SCRUM Prep`;

function parseDate(dateStr: string) {
    // Input: "Thursday, September 4, 2025" or "September 4, 2025"
    // Manual parse to avoid timezone shifts
    const parts = dateStr.split(',');
    if (parts.length < 2) return new Date(dateStr).toISOString().slice(0, 10);

    // Check if format is "DayName, Month Day, Year" (3 parts) or "Month Day, Year" (2 parts)
    let monthDay = '';
    let year = '';

    if (parts.length === 3) {
        monthDay = parts[1].trim(); // "September 4"
        year = parts[2].trim();     // "2025"
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
    if (m === undefined) return new Date(dateStr).toISOString().slice(0, 10); // Fallback

    const y = parseInt(year);
    const d = parseInt(day);

    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Helper to remove surrounding quotes if any (some copies paste with quotes)
function clean(str: string) {
    if (!str) return '';
    return str.trim().replace(/^"|"$/g, '');
}

// Normalize description for fuzzy matching (remove extra spaces, case insensitive)
function norm(str: string) {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function verify() {
    console.log('Fetching Barons Pubs vendor...');
    const { data: vendor } = await supabase.from('invoice_vendors').select('id').eq('name', 'Barons Pubs').single();
    if (!vendor) throw new Error('Vendor Barons Pubs not found');

    const { data: entries } = await supabase.from('oj_entries')
        .select('*, work_type:oj_work_types(name), project:oj_projects(project_name)')
        .eq('vendor_id', vendor.id);

    if (!entries) throw new Error('Failed to fetch data');

    const lines = RAW_DATA.split('\n').filter(l => l.trim().length > 0);

    let missingCount = 0;
    let wrongProjectCount = 0;

    console.log('\n--- VERIFICATION START ---');

    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 8) continue;

        const dateRaw = clean(parts[0]);
        const dateIso = parseDate(dateRaw);
        const description = clean(parts[7] || parts[parts.length - 1]);

        // Find matching entry in DB
        const matches = entries.filter(e =>
            e.entry_date === dateIso &&
            norm(e.description || '') === norm(description)
        );

        if (matches.length === 0) {
            console.error(`[MISSING] ${dateIso} - ${description}`);
            // Attempt to find by close match?
            const fuzzyMatches = entries.filter(e => e.entry_date === dateIso);
            if (fuzzyMatches.length > 0) {
                console.log(`    Possible candidates on ${dateIso}:`);
                fuzzyMatches.forEach(f => console.log(`      - "${f.description}"`));
            }
            missingCount++;
            continue;
        }

        const entry = matches[0];

        // --- Project Check ---
        const isMarketingScrum = norm(description).includes('marketing scrum');
        const isTransit = norm(description).includes('drive') || norm(description).includes('driving');

        if (isMarketingScrum || isTransit) {
            const d = new Date(dateIso);
            const monthName = d.toLocaleString('default', { month: 'long' });

            if (!entry.project.project_name.startsWith('Monthly Retainer')) {
                console.error(`[WRONG PROJECT TYPE] ${dateIso} - ${description}`);
                console.error(`   Actual:   ${entry.project.project_name}`);
                wrongProjectCount++;
            } else if (!entry.project.project_name.includes(monthName)) {
                console.error(`[WRONG MONTHLY RETAINER] ${dateIso} - ${description}`);
                console.error(`   Expected Month: ${monthName}`);
                console.error(`   Actual Project: ${entry.project.project_name}`);
                wrongProjectCount++;
            }
        }

        // --- Work Type Check ---
        const categoryRaw = clean(parts[6]);
        if (categoryRaw) {
            let expected = categoryRaw;
            if (expected === 'Consuling') expected = 'Consulting'; // User typo

            // If we moved it to Transit, that's valid
            if (isTransit) expected = 'Transit';

            let actual = entry.work_type?.name;
            if (actual === 'Consuluting') actual = 'Consulting'; // DB typo fix visualization

            if (actual !== expected) {
                // If expected was Consulting/Development but actual matches our logic (e.g. we mapped it differently), NOTE it.
                // Re-map actual DB typo for comparison
                const actualRaw = entry.work_type?.name;

                if (actualRaw === 'Consuluting' && expected === 'Consulting') {
                    // This is just the typo.
                } else if (expected === 'Consulting' && actual === 'Transit') {
                    // Logic override for driving. Valid.
                } else {
                    console.warn(`[WORK TYPE MISMATCH] ${dateIso} - ${description}`);
                    console.warn(`   User List: ${categoryRaw} -> Expected: ${expected}`);
                    console.warn(`   DB Entry:  ${entry.work_type?.name}`);
                }
            }
        }
    }

    console.log('--- VERIFICATION END ---');
    console.log(`Missing Entries: ${missingCount}`);
    console.log(`Project Issues: ${wrongProjectCount}`);
}

verify();
