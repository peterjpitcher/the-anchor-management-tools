export interface Vendor {
  id: string;
  name: string;
  company_name?: string;
  service_type: 'dj' | 'band' | 'photographer' | 'florist' | 'decorator' | 'cake' | 'transport' | 'equipment' | 'entertainment' | 'other';
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  typical_rate?: string;
  notes?: string;
  preferred: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateVendorInput {
  name: string;
  company_name?: string | null;
  service_type: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  website?: string | null;
  typical_rate?: string | null;
  notes?: string | null;
  preferred?: boolean;
  active?: boolean;
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {}