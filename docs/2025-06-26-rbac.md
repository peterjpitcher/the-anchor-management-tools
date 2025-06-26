# Role-Based Access Control (RBAC) Documentation

## Overview

The Event Planner application now includes a comprehensive Role-Based Access Control (RBAC) system that allows administrators to control which modules users can access within the application.

## Features

- **Role Management**: Create, edit, and delete custom roles
- **Permission Assignment**: Granular permissions for each module and action
- **User Role Assignment**: Assign multiple roles to users
- **Dynamic UI**: Navigation and features adapt based on user permissions
- **Middleware Protection**: Routes are protected at the middleware level
- **Server-Side Validation**: All actions validate permissions server-side

## Default Roles

The system comes with three predefined system roles:

1. **Super Admin** (`super_admin`)
   - Full access to all modules and settings
   - Can manage roles and permissions
   - Cannot be deleted or modified

2. **Manager** (`manager`)
   - Access to most modules except system settings
   - Cannot manage roles or user permissions
   - Suitable for supervisory staff

3. **Staff** (`staff`)
   - Limited read-only access to basic modules
   - Cannot access sensitive areas like settings or user management
   - Ideal for regular employees

## Modules and Permissions

Each module supports different actions:

### Core Modules
- **Dashboard**: view
- **Events**: view, create, edit, delete
- **Customers**: view, create, edit, delete, export
- **Employees**: view, create, edit, delete, view_documents, upload_documents, delete_documents
- **Bookings**: view, create, edit, delete, export
- **Messages**: view, send, delete, view_templates, manage_templates

### Administrative Modules
- **SMS Health**: view, manage
- **Settings**: view, manage
- **Reports**: view, export
- **Users**: view, manage_roles
- **Roles**: view, manage

## Implementation Guide

### 1. Database Migration

First, run the RBAC migration in your Supabase dashboard:

```sql
-- Run the migration file: supabase/migrations/20250117_rbac_system.sql
```

### 2. Assign Initial Roles

After running the migration, use the provided script to assign roles to existing users:

```bash
npx tsx scripts/migrate-users-to-rbac.ts
```

This script will:
- Assign the `super_admin` role to the first user (by creation date)
- Assign the `staff` role to all other existing users
- Skip users who already have roles assigned

### 3. Managing Roles

#### Creating a New Role
1. Navigate to `/roles`
2. Click "New Role"
3. Enter a name and description
4. Save the role
5. Click "Permissions" on the role card to assign permissions

#### Assigning Permissions to a Role
1. Click "Permissions" on any role card
2. Select/deselect individual permissions or use "Select all" for modules
3. Click "Save Permissions"

#### Assigning Roles to Users
1. Navigate to `/users`
2. Click "Manage Roles" for any user
3. Select the roles to assign
4. Click "Save Roles"

### 4. Using Permissions in Code

#### In Server Actions
```typescript
import { checkUserPermission } from '@/app/actions/rbac';

export async function myServerAction() {
  const hasPermission = await checkUserPermission('module_name', 'action');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  // Proceed with action
}
```

#### In Client Components
```typescript
import { usePermissions } from '@/contexts/PermissionContext';

export function MyComponent() {
  const { hasPermission } = usePermissions();
  
  if (!hasPermission('module_name', 'action')) {
    return <div>You don't have permission to view this</div>;
  }
  
  // Render component
}
```

#### In Server Components
```typescript
import { checkUserPermission } from '@/app/actions/rbac';

export default async function MyPage() {
  const hasPermission = await checkUserPermission('module_name', 'action');
  if (!hasPermission) {
    return <div>Access denied</div>;
  }
  
  // Render page
}
```

## Security Considerations

1. **Middleware Protection**: All routes are protected at the middleware level
2. **Server-Side Validation**: Every server action validates permissions
3. **Row Level Security**: Database operations respect RLS policies
4. **UI Adaptation**: Navigation and features hide based on permissions
5. **Audit Trail**: Role assignments track who assigned them and when

## Troubleshooting

### User Can't Access Expected Features
1. Check the user's assigned roles in `/users`
2. Verify the role has the necessary permissions in `/roles`
3. Ensure the user has logged out and back in after role changes

### Permission Denied Errors
1. Verify the module and action names match exactly
2. Check that permissions are being checked with the correct parameters
3. Ensure the RBAC migration has been run successfully

### First User Setup
If no user has super admin access:
1. Run the migration script: `npx tsx scripts/migrate-users-to-rbac.ts`
2. Or manually assign via Supabase SQL Editor:
```sql
INSERT INTO public.user_roles (user_id, role_id)
SELECT 
  '<YOUR_USER_ID>',
  id
FROM public.roles
WHERE name = 'super_admin';
```

## Best Practices

1. **Principle of Least Privilege**: Give users only the permissions they need
2. **Regular Audits**: Periodically review role assignments
3. **Custom Roles**: Create specific roles for your organization's needs
4. **Testing**: Test permission changes in a development environment first
5. **Documentation**: Document custom roles and their purposes