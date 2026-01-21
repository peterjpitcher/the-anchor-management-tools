
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// IDs from previous lookup
const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'; // Barons Pubs
const PROJECT_ID = 'c7544454-de06-4913-9737-2dd127659a57'; // Website Content Creation...

const WORK_TYPES = {
    CONSULTING: '1f6f85c3-2288-42fb-a866-b5393607445a', // Typo 'Consuluting'
    DEVELOPMENT: '42740cc9-761a-408a-b3a1-a6424695f4a6',
    TRAINING: 'c150c196-e331-46e6-94d9-8ade0953c4e3',
    TRANSIT: '55f8821f-d3b3-4550-a4fe-d0321bc59ef4',
};

// Raw data
const rawData = `
Thursday, September 4, 2025	September 2025	11:30:00 AM	12:30:00 PM	1.00	£62.50		Call with Zonal
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
Monday, January 19, 2026	January 2026	7:00:00 AM	9:00:00 AM	2.00	£125.00	Consulting	Marketing SCRUM Prep
`;

function getWorkTypeId(category: string, description: string): string {
    const cleanCat = (category || '').trim().toLowerCase();
    const cleanDesc = (description || '').trim().toLowerCase();

    // 1. Check explicit mappings
    if (cleanCat.includes('development')) return WORK_TYPES.DEVELOPMENT;
    if (cleanCat.includes('training')) return WORK_TYPES.TRAINING;

    // 2. Inference from Description
    if (cleanDesc.includes('drive to') || cleanDesc.includes('drive from') || cleanDesc.includes('driving')) {
        return WORK_TYPES.TRANSIT;
    }

    if (cleanDesc.includes('build') || cleanDesc.includes('code') || cleanDesc.includes('develop')) {
        return WORK_TYPES.DEVELOPMENT;
    }

    // 3. Default
    return WORK_TYPES.CONSULTING;
}

function parseDate(dateStr: string, timeStr: string): Date {
    // Date: "Thursday, September 4, 2025" -> standard parsing usually works
    // Time: "11:30:00 AM"
    // Combine
    const d = new Date(`${dateStr} ${timeStr}`);
    return d;
}

function getStatus(date: Date) {
    // cutoff 2025-12-31
    const cutoff = new Date('2025-12-31T23:59:59');
    if (date <= cutoff) {
        return { status: 'paid', paid_at: date.toISOString() };
    }
    return { status: 'unbilled', paid_at: null };
}

async function main() {
    const lines = rawData.trim().split('\n');
    const entriesToInsert = [];

    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(/\t| {2,}/);

        // Safety check for columns
        if (parts.length < 7) {
            console.warn('Skipping malformed line:', line);
            continue;
        }

        const [
            dateStr,          // Thursday, September 4, 2025
            monthStr,         // September 2025
            startTimeStr,     // 11:30:00 AM
            endTimeStr,       // 12:30:00 PM
            hoursStr,         // 1.00
            costStr,          // £62.50
            categoryStr,      // (empty) or Consulting
            reasonStr         // Call with Zonal
        ] = parts;

        try {
            const startAt = parseDate(dateStr, startTimeStr);
            const endAt = parseDate(dateStr, endTimeStr);

            // Handle overnight? Assuming not for now based on data

            const hours = parseFloat(hoursStr);
            const minutes = Math.round(hours * 60);

            const workTypeId = getWorkTypeId(categoryStr, reasonStr);
            const { status, paid_at } = getStatus(startAt);

            // Format for DB: 2025-09-04
            const entryDate = startAt.toISOString().split('T')[0];

            entriesToInsert.push({
                vendor_id: VENDOR_ID,
                project_id: PROJECT_ID,
                entry_type: 'time',
                entry_date: entryDate,
                start_at: startAt.toISOString(),
                end_at: endAt.toISOString(),
                duration_minutes_raw: minutes,
                duration_minutes_rounded: minutes, // Assuming 1:1 for now
                work_type_id: workTypeId,
                description: reasonStr,
                status: status,
                paid_at: paid_at,
                billable: true
            });

        } catch (e) {
            console.error('Error parsing line:', line, e);
        }
    }

    console.log(`Prepared ${entriesToInsert.length} entries.`);

    if (entriesToInsert.length > 0) {
        const { data, error } = await supabase.from('oj_entries').insert(entriesToInsert).select();
        if (error) {
            console.error('Insert Error:', error);
        } else {
            console.log(`Successfully inserted ${data.length} entries.`);
        }
    }
}

main();
