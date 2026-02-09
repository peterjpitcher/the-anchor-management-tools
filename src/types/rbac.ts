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
  | 'performers'
  | 'customers'
  | 'employees'
  | 'messages'
  | 'sms_health'
  | 'settings'
  | 'reports'
  | 'users'
  | 'roles'
  | 'private_bookings'
  | 'table_bookings'
  | 'invoices'
  | 'oj_projects'
  | 'receipts'
  | 'loyalty'
  | 'quotes'
  | 'parking'
  | 'short_links'
  | 'menu_management'
  | 'cashing_up'
;

export type ActionType = 
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'export'
  | 'manage'
  | 'send'
  | 'convert'
  | 'view_documents'
  | 'upload_documents'
  | 'delete_documents'
  | 'view_templates'
  | 'manage_templates'
  | 'manage_roles'
  | 'view_pricing'
  | 'manage_deposits'
  | 'view_vendor_costs'
  | 'manage_spaces'
  | 'manage_catering'
  | 'manage_vendors'
  | 'generate_contracts'
  | 'view_sms_queue'
  | 'approve_sms'
  | 'enroll'
  | 'redeem'
  | 'refund'
  | 'submit'
  | 'approve'
  | 'lock'
  | 'unlock';

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
