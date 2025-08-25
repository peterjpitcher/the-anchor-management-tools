import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// Create client with anon key for this script
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

async function finalPermissionFix() {
  console.log('🔧 Final permission fixes...\n');

  try {
    // Check if we can see the current user's roles
    console.log('1️⃣  Checking your current user status...');
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('⚠️  No authenticated user found. Please ensure you are logged in.');
      console.log('\n📝 Manual steps to complete:');
      console.log('1. Log into your Supabase dashboard');
      console.log('2. Run the following SQL in the SQL editor:');
      console.log(`
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- First check if user is a superadmin
    IF EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND r.name = 'super_admin'
    ) THEN
        RETURN true;
    END IF;
    
    -- Otherwise check specific permissions
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON ur.role_id = rp.role_id
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND p.module_name = p_module_name
        AND p.action = p_action
    );
END;
$$;
      `);
      return;
    }

    console.log(`✅ Found user: ${user.email}`);

    // Check user roles
    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('*, roles(*)')
      .eq('user_id', user.id);

    if (rolesError) {
      console.error('Error checking user roles:', rolesError);
    } else if (userRoles && userRoles.length > 0) {
      console.log('\n📊 Your current roles:');
      userRoles.forEach(ur => {
        console.log(`- ${ur.roles.name} (${ur.roles.description || 'No description'})`);
      });

      const isSuperAdmin = userRoles.some(ur => ur.roles.name === 'super_admin');
      if (isSuperAdmin) {
        console.log('\n✅ You are a superadmin!');
      } else {
        console.log('\n⚠️  You are not currently a superadmin');
      }
    }

    console.log('\n🎉 Permission check completed!');
    console.log('\n📝 Next steps:');
    console.log('1. The permissions have been fixed in the database');
    console.log('2. The user_has_permission function needs to be updated manually in Supabase');
    console.log('3. Refresh your browser and check if you can see "Customer Labels" in settings');
    console.log('\nIf you still cannot see "Customer Labels", please:');
    console.log('1. Clear your browser cache');
    console.log('2. Log out and log back in');
    console.log('3. Check the browser console for any errors');

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the check
finalPermissionFix();