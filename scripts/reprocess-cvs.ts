
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function reprocessCVs() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl!, supabaseKey!)

    console.log('Resetting COMPLETED Parse CV jobs to run again...')
    const { error } = await supabase
        .from('jobs')
        .update({
            status: 'pending',
            attempts: 0,
            result: null,
            error_message: null,
            failed_at: null,
            completed_at: null,
            scheduled_for: new Date().toISOString()
        })
        .eq('type', 'parse_cv')
        .eq('status', 'completed')

    if (error) console.error(error)
    else console.log('✅ Completed jobs reset to pending.')
}

reprocessCVs()
