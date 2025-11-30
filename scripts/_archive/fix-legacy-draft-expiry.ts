
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixLegacyDraftExpiry() {
  console.log('--- Fixing Legacy Draft Expiry ---')

  // 1. Fetch drafts with NULL hold_expiry
  const { data: drafts, error } = await supabase
    .from('private_bookings')
    .select('id, created_at, event_date, customer_name')
    .eq('status', 'draft')
    .is('hold_expiry', null)

  if (error) {
    console.error('Error fetching drafts:', error)
    return
  }

  console.log(`Found ${drafts.length} drafts to fix.`)

  for (const draft of drafts) {
    const createdDate = new Date(draft.created_at)
    const eventDate = new Date(draft.event_date)
    
    // Constants from service
    const STANDARD_HOLD_DAYS = 14
    const SHORT_NOTICE_HOLD_DAYS = 2
    
    const sevenDaysBeforeEvent = new Date(eventDate)
    sevenDaysBeforeEvent.setDate(sevenDaysBeforeEvent.getDate() - 7)
    
    let holdExpiry: Date

    // Logic replication
    if (createdDate.getTime() > sevenDaysBeforeEvent.getTime()) {
        // Short Notice
        const shortNoticeExpiry = new Date(createdDate)
        shortNoticeExpiry.setDate(shortNoticeExpiry.getDate() + SHORT_NOTICE_HOLD_DAYS)
        
        if (shortNoticeExpiry.getTime() > eventDate.getTime()) {
            holdExpiry = eventDate
        } else {
            holdExpiry = shortNoticeExpiry
        }
        console.log(`[Short Notice] Draft ${draft.id} (${draft.customer_name}): Created ${draft.created_at}, Event ${draft.event_date} -> Expiry ${holdExpiry.toISOString()}`)
    } else {
        // Normal
        holdExpiry = new Date(createdDate)
        holdExpiry.setDate(holdExpiry.getDate() + STANDARD_HOLD_DAYS)
        
        if (holdExpiry.getTime() > sevenDaysBeforeEvent.getTime()) {
            holdExpiry = sevenDaysBeforeEvent
        }
        console.log(`[Normal] Draft ${draft.id} (${draft.customer_name}): Created ${draft.created_at}, Event ${draft.event_date} -> Expiry ${holdExpiry.toISOString()}`)
    }

    // Apply Update
    const { error: updateError } = await supabase
        .from('private_bookings')
        .update({ hold_expiry: holdExpiry.toISOString() })
        .eq('id', draft.id)
    
    if (updateError) {
        console.error(`Failed to update draft ${draft.id}:`, updateError)
    } else {
        console.log(`Successfully updated draft ${draft.id}`)
    }
  }
}

fixLegacyDraftExpiry()
