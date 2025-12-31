
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function checkCandidates() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl!, supabaseKey!)

    console.log('Fetching candidates named "Parsing CV..."...')
    const { data, error } = await supabase
        .from('hiring_candidates')
        .select('*')
        .ilike('first_name', 'Parsing%')

    if (data) {
        console.log(`Found ${data.length} candidates still parsing:`)
        data.forEach(c => {
            console.log(`ID: ${c.id}`)
            console.log(`Email: ${c.email}`)
            console.log(`Parsed Data: ${JSON.stringify(c.parsed_data).substring(0, 50)}...`)
            // Check if there is a completed job for this candidate?
            // We can't query jobs by payload easily without jsonb query
        })
    } else {
        console.log('No placeholder candidates found.')
    }
}

checkCandidates()
