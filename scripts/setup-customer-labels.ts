import { createAdminClient } from '@/lib/supabase/server'

async function setupCustomerLabels() {
  console.log('=== Setting Up Customer Labels ===\n')

  try {
    const supabase = await createAdminClient()
    
    // Test if tables already exist
    const { data: existingLabels, error: checkError } = await supabase
      .from('customer_labels')
      .select('id')
      .limit(1)
    
    if (!checkError) {
      console.log('Customer labels tables already exist!')
      
      // Check if default labels exist
      const { data: labels, error: labelsError } = await supabase
        .from('customer_labels')
        .select('*')
      
      if (labels && labels.length > 0) {
        console.log(`\nFound ${labels.length} existing labels:`)
        labels.forEach(l => console.log(`  - ${l.name} (${l.color})`))
      } else {
        console.log('\nNo labels found. Run the migration to create default labels.')
      }
      
      return
    }
    
    console.log('Customer labels tables do not exist yet.')
    console.log('\nTo set up customer labels, please run the following migration:')
    console.log('  supabase/migrations/20250706160000_add_customer_labels.sql')
    console.log('\nYou can apply it using:')
    console.log('  1. Supabase Dashboard > SQL Editor')
    console.log('  2. Or via Supabase CLI: supabase db push')
    
  } catch (error) {
    console.error('Error:', error)
  }
}

setupCustomerLabels().catch(console.error)