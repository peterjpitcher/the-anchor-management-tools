
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'

async function checkEmployeeStatuses() {
    console.log('🔍 Checking Employee Statuses...')
    const admin = createAdminClient()

    // We can't use .distinct() easily on all fields, but we can group by
    // Or just fetch all unique statuses.
    // Supabase JS SDK doesn't always have a distinct helper, but we can select status.

    const { data, error } = await admin
        .from('employees')
        .select('status')

    if (error) {
        console.error('❌ Error fetching employees:', error)
        return
    }

    const statuses = data.map(e => e.status)
    const uniqueStatuses = [...new Set(statuses)]

    console.log('✅ Unique Statuses found in DB:', uniqueStatuses)

    // define expected
    const expected = ['Active', 'Inactive', 'Suspended', 'Prospective']
    const invalid = uniqueStatuses.filter(s => !expected.includes(s))

    if (invalid.length > 0) {
        console.error('❌ Prohibited Statuses found:', invalid)
    } else {
        console.log('✅ All statuses are valid.')
    }
}

checkEmployeeStatuses()
