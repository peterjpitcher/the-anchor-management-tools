import { createAdminClient } from '../src/lib/supabase/server'

async function checkVenueSpaces() {
  console.log('Checking venue spaces in database...\n')
  
  try {
    const supabase = await createAdminClient()
    
    // Query venue spaces
    const { data: spaces, error } = await supabase
      .from('venue_spaces')
      .select('*')
      .eq('is_active', true)
      .order('name')
    
    if (error) {
      console.error('Error querying venue spaces:', error)
      return
    }
    
    if (!spaces || spaces.length === 0) {
      console.log('No active venue spaces found in database')
      return
    }
    
    console.log(`Found ${spaces.length} active venue spaces:\n`)
    
    spaces.forEach((space, index) => {
      console.log(`${index + 1}. ${space.name}`)
      console.log(`   - Capacity: ${space.capacity} guests`)
      if (space.description) {
        console.log(`   - Description: ${space.description}`)
      }
      console.log('')
    })
    
  } catch (error) {
    console.error('Script error:', error)
  }
}

checkVenueSpaces()