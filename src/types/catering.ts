export interface CateringPackage {
  id: string;
  name: string;
  description?: string;
  package_type: 'buffet' | 'sit-down' | 'canapes' | 'drinks' | 'other';
  cost_per_head: number;
  minimum_guests: number;
  maximum_guests?: number;
  dietary_notes?: string;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCateringPackageInput {
  name: string;
  description?: string | null;
  package_type: string;
  cost_per_head: number;
  minimum_guests?: number | null;
  maximum_guests?: number | null;
  dietary_notes?: string | null;
  active?: boolean;
}

export type UpdateCateringPackageInput = Partial<CreateCateringPackageInput>