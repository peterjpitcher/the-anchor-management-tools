import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create Supabase admin client
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  
  if (!supabase) {
    return NextResponse.json({ error: 'Failed to initialize Supabase admin client' }, { status: 500 });
  }

  try {
    // Check employees table
    const { data: employees, error: employeesError, count } = await supabase
      .from('employees')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(5);

    // Check if employee-related tables exist
    const tables = [
      'employees',
      'employee_notes', 
      'employee_attachments',
      'employee_emergency_contacts',
      'employee_financial_details',
      'employee_health_records'
    ];

    const tableChecks: Record<string, any> = {};
    
    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      tableChecks[table] = !error;
    }

    // Check RLS policies
    const { data: policies, error: policiesError } = await supabase
      .rpc('pg_policies')
      .eq('tablename', 'employees');

    return NextResponse.json({ 
      success: true,
      summary: {
        totalEmployees: count || 0,
        tablesExist: tableChecks,
        hasRLSPolicies: policies?.length > 0,
        recentEmployees: employees?.length || 0
      },
      details: {
        employees: employees || [],
        employeesError,
        policiesError,
        policies
      }
    });

  } catch (error) {
    console.error('Check employees error:', error);
    return NextResponse.json({ 
      error: 'Failed to check employees',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}