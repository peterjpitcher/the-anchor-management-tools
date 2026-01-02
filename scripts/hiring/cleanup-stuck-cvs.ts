
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'


async function cleanupStuckCVs() {
    const supabase = createAdminClient()

    // First, just check how many are in this state total
    const { data: allParsing, error: countError } = await supabase
        .from('hiring_candidates')
        .select('id, created_at')
        .eq('first_name', 'Parsing')
        .eq('last_name', 'CV...')

    if (countError) {
        console.error('Failed to fetch count:', countError)
        return
    }

    console.log(`Total candidates in 'Parsing CV...' state: ${allParsing.length}`)
    allParsing.forEach(c => {
        const ageMsg = `ID: ${c.id}, Created: ${c.created_at} (${((Date.now() - new Date(c.created_at).getTime()) / 1000 / 60).toFixed(1)} mins ago)`
        console.log(ageMsg)
    })

    const THRESHOLD = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    console.log(`\nRunning cleanup for candidates created before: ${THRESHOLD} (30 mins ago)`)

    const candidates = allParsing.filter(c => c.created_at < THRESHOLD)

    if (candidates.length === 0) {
        console.log('No stuck candidates found older than 30 minutes.')
        return
    }

    console.log(`Found ${candidates.length} candidates to clean up.`)

    for (const candidate of candidates) {
        console.log(`Fixing candidate ${candidate.id}...`)
        const { error: updateError } = await supabase
            .from('hiring_candidates')
            .update({
                first_name: '[Parsing Failed]',
                last_name: 'Check Details',
                parsed_data: {
                    error: 'Automatically marked as failed by cleanup script',
                    failed_at: new Date().toISOString()
                }
            })
            .eq('id', candidate.id)

        if (updateError) {
            console.error(`Failed to update ${candidate.id}:`, updateError)
        } else {
            console.log(`Updated ${candidate.id}`)
        }
    }

    console.log('Cleanup complete.')
}

cleanupStuckCVs().catch(console.error)
