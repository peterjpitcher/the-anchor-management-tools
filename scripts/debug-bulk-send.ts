
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
    console.log('--- Starting Debug Script ---')
    const supabase = createAdminClient()

    console.log('Checking recent JOBS...')
    const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

    if (jobsError) {
        console.error('Error fetching jobs:', jobsError)
    } else {
        console.log(`Found ${jobs.length} recent jobs:`)
        jobs.forEach(job => {
            console.log(`- [${job.status}] Type: ${job.type}, ID: ${job.id}, CreatedAt: ${job.created_at}, ScheduledFor: ${job.scheduled_for}, Attempts: ${job.attempts}`)
            if (job.payload) {
                console.log(`  Payload summary: IDs count: ${(job.payload as any).customerIds?.length}, Message length: ${(job.payload as any).message?.length}`)
            }
        })
    }

    console.log('\nChecking recent OUTBOUND MESSAGES...')
    const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(30)

    if (messagesError) {
        console.error('Error fetching messages:', messagesError)
    } else {
        console.log(`Found ${messages.length} recent messages:`)
        messages.forEach(msg => {
            console.log(`- [${msg.status}] To: ${msg.to_number}, SID: ${msg.message_sid}, CreatedAt: ${msg.created_at}`)
            if (msg.metadata) {
                console.log(`  Metadata:`, JSON.stringify(msg.metadata))
            }
        })
    }
    console.log('--- End of Debug Script ---')
}

main().catch((error) => {
  console.error('Debug bulk send script failed:', error)
  process.exitCode = 1
})
