
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
    const supabase = createAdminClient();
    const email = 'dev_verifier@example.com';
    const password = 'password123';
    const role = 'super_admin';

    console.log(`Creating user ${email}...`);

    // 1. Create User
    const { data: user, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            first_name: 'Dev',
            last_name: 'Verifier'
        }
    });

    if (createError) {
        console.error('Error creating user:', createError.message);
        // If user exists, try to get ID
        // We can't easily get user by email with admin client without listUsers
        // But let's assume we can proceed if "User already registered"
    }

    let userId = user?.user?.id;

    if (!userId) {
        // Try to list users to find the ID if creation failed due to existence
        const { data: users } = await supabase.auth.admin.listUsers();
        const existingUser = users.users.find(u => u.email === email);
        if (existingUser) {
            userId = existingUser.id;
            console.log(`User already exists with ID: ${userId}`);
            // Reset password
            await supabase.auth.admin.updateUserById(userId, { password });
            console.log('Password updated.');
        } else {
            console.error('Could not find or create user.');
            process.exit(1);
        }
    }

    console.log(`Looking up role ${role}...`);
    const { data: roleData, error: roleLookupError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', role)
        .single();

    if (roleLookupError || !roleData) {
        console.error(`Error looking up role ${role}:`, roleLookupError?.message || 'Role not found');
        process.exit(1);
    }

    const roleId = roleData.id;
    console.log(`Found role ID: ${roleId}`);

    console.log(`Assigning role ${role} (ID: ${roleId}) to user ${userId}...`);

    // 2. Assign Role
    const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: userId, role_id: roleId }, { onConflict: 'user_id,role_id' });

    if (roleError) {
        console.error('Error assigning role:', roleError.message);
        // Fallback? Maybe it's 'public.user_roles'?
        // Or maybe table structure is different
    } else {
        console.log('Role assigned successfully.');
    }
}

main().catch(console.error);
