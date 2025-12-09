
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixBookings() {
    console.log('Finding bookings with seats > 0 but is_reminder_only = true...')

    const { data: bookings, error: fetchError } = await supabase
        .from('bookings')
        .select('id, seats')
        .gt('seats', 0)
        .eq('is_reminder_only', true)

    if (fetchError) {
        console.error('Error fetching bookings:', fetchError)
        return
    }

    console.log(`Found ${bookings.length} bookings to fix.`)

    if (bookings.length === 0) {
        return
    }

    const { error: updateError } = await supabase
        .from('bookings')
        .update({ is_reminder_only: false })
        .in('id', bookings.map(b => b.id))

    if (updateError) {
        console.error('Error updating bookings:', updateError)
    } else {
        console.log('Successfully fixed bookings.')
    }
}

fixBookings()
