
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { UnifiedJobQueue } from '@/lib/unified-job-queue'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function processQueue() {
    console.log('🔄 Starting queue processor...')

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables')
    }

    // Initialize the queue logic
    // Note: The singleton in unified-job-queue.ts uses createAdminClient which imports from '@/lib/supabase/admin'
    // which likely relies on process.env being set.

    const { jobQueue } = await import('@/lib/unified-job-queue')

    console.log('Processing next batch of jobs...')
    await jobQueue.processJobs(5) // Process 5 jobs
    console.log('✅ Batch complete.')
}

processQueue().catch(err => {
    console.error('Failed to process queue:', err)
    process.exit(1)
})
