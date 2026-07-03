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

type RolePermission = {
  role_id: string;
  permission_id: string;
  created_at: string;
};

type UserRole = {
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
  | 'feedback'
  | 'menu_management'
  | 'cashing_up'
  | 'rota'
  | 'leave'
  | 'timeclock'
  | 'payroll'
  | 'recruitment'
  | 'mileage'
  | 'expenses'
  | 'mgd'
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
  | 'unlock'
  | 'publish'
  | 'request'
  | 'clock'
  | 'view_contact_preferences'
  | 'manage_contact_preferences'
  | 'manage_whatsapp_opt_in'
  | 'record_service_contact'
  | 'send_transactional'
  | 'send_marketing'
  | 'view_consent_audit'
  | 'export_consent_audit';

export type UserPermission = {
  module_name: ModuleName;
  action: ActionType;
};

type RoleWithPermissions = Role & {
  permissions: Permission[];
};

type UserWithRoles = {
  id: string;
  email: string;
  roles: Role[];
};

export type UserSummaryWithRoles = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  roles: Role[];
};
