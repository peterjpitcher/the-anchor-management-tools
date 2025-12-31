
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function resetJobs() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl!, supabaseKey!)

    console.log('Rescheduling all pending jobs to now...')
    const { error } = await supabase
        .from('jobs')
        .update({ scheduled_for: new Date().toISOString() })
        .eq('status', 'pending')

    if (error) console.error(error)
    else console.log('✅ Done.')
}

resetJobs()
