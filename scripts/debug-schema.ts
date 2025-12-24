
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local')
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8')
        envConfig.split('\n').forEach((line) => {
            const match = line.match(/^([^=]+)=(.*)$/)
            if (match) {
                process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
            }
        })
    }
}

loadEnv()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
    console.log('Fetching distinct booking_source values...')
    const { data, error } = await supabase
        .from('bookings')
        .select('booking_source')

    if (error) {
        console.error('Error:', error)
        return
    }

    if (data) {
        const sources = [...new Set(data.map(d => d.booking_source))]
        console.log('Distinct sources:', sources)
    }
}

main()
