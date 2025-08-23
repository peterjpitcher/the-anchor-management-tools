import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables. Please check .env.local')
  process.exit(1)
}

async function fixRpcFunctions() {
  console.log('=== Fixing RPC Functions ===\n')

  // Fix get_category_regulars function
  const fixRegularsQuery = `
    CREATE OR REPLACE FUNCTION "public"."get_category_regulars"(
      "p_category_id" "uuid", 
      "p_days_back" integer DEFAULT 90
    ) 
    RETURNS TABLE(
      "customer_id" "uuid", 
      "first_name" text,
      "last_name" text,
      "mobile_number" text,
      "times_attended" integer, 
      "last_attended_date" "date", 
      "days_since_last_visit" integer
    )
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        c.id,
        c.first_name::text,
        c.last_name::text,
        c.mobile_number::text,
        ccs.times_attended,
        ccs.last_attended_date,
        EXTRACT(DAY FROM NOW() - ccs.last_attended_date)::INTEGER as days_since_last_visit
      FROM customer_category_stats ccs
      JOIN customers c ON c.id = ccs.customer_id
      WHERE ccs.category_id = p_category_id
        AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '1 day' * p_days_back
        AND c.sms_opt_in = true
      ORDER BY ccs.times_attended DESC, ccs.last_attended_date DESC;
    END;
    $$;
  `

  console.log('1. Fixing get_category_regulars function...')
  const { error: regularsError } = await supabase.rpc('query', { query: fixRegularsQuery })
  
  if (regularsError) {
    // Try using a direct SQL query
    const { error: directError } = await (supabase as any).from('_sql').select('*').eq('query', fixRegularsQuery)
    if (directError) {
      console.error('Error fixing get_category_regulars:', directError)
    } else {
      console.log('   ✓ Fixed get_category_regulars function')
    }
  } else {
    console.log('   ✓ Fixed get_category_regulars function')
  }

  // Test the fixed function
  console.log('\n2. Testing get_category_regulars function...')
  const { data: categories } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(1)

  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`   Testing with category: ${categories[0].name}`)
    
    const { data: regulars, error: testError } = await supabase
      .rpc('get_category_regulars', { 
        p_category_id: categoryId,
        p_days_back: 365
      })

    if (testError) {
      console.error('   ✗ Error:', testError)
    } else {
      console.log(`   ✓ Found ${regulars?.length || 0} regular customers`)
      regulars?.slice(0, 3).forEach(r => 
        console.log(`     - ${r.first_name} ${r.last_name} (attended ${r.times_attended} times)`)
      )
    }
  }

  process.exit(0)
}

fixRpcFunctions().catch(console.error)