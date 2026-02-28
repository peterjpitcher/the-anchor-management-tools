import type { Database } from './database';

export type Customer = Database['public']['Tables']['customers']['Row'];
export type CustomerInsert = Database['public']['Tables']['customers']['Insert'];
export type CustomerUpdate = Database['public']['Tables']['customers']['Update'];

export type CreateCustomerInput = {
  first_name?: string;
  last_name?: string;
  mobile_number?: string;
  default_country_code?: string;
  email?: string;
  sms_opt_in: boolean;
  internal_notes?: string;
};

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface CustomerImportResult {
  created: Customer[];
  skippedInvalid: number;
  skippedDuplicates: number;
  skippedExisting: number;
}

export interface BulkDeleteResult {
  success: boolean;
  deletedCount: number;
  failedCount?: number;
  deletedCustomers?: { id: string; name: string }[];
  failedDeletions?: { id: string; name: string; error: string }[];
  message?: string;
}
