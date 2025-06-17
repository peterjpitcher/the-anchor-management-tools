export type Role = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type Permission = {
  id: string;
  module_name: string;
  action: string;
  description: string | null;
  created_at: string;
};

export type RolePermission = {
  role_id: string;
  permission_id: string;
  created_at: string;
};

export type UserRole = {
  user_id: string;
  role_id: string;
  assigned_at: string;
  assigned_by: string | null;
};

export type ModuleName = 
  | 'dashboard'
  | 'events'
  | 'customers'
  | 'employees'
  | 'bookings'
  | 'messages'
  | 'sms_health'
  | 'settings'
  | 'reports'
  | 'users'
  | 'roles';

export type ActionType = 
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'export'
  | 'manage'
  | 'send'
  | 'view_documents'
  | 'upload_documents'
  | 'delete_documents'
  | 'view_templates'
  | 'manage_templates'
  | 'manage_roles';

export type UserPermission = {
  module_name: ModuleName;
  action: ActionType;
};

export type RoleWithPermissions = Role & {
  permissions: Permission[];
};

export type UserWithRoles = {
  id: string;
  email: string;
  roles: Role[];
};