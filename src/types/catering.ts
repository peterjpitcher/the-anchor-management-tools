export interface CateringPackage {
  id: string;
  name: string;
  description?: string;
  serving_style: 'buffet' | 'sit-down' | 'canapes' | 'drinks' | 'pizza' | 'other';
  category: 'food' | 'drink' | 'addon';
  cost_per_head: number;
  minimum_guests: number;
  maximum_guests?: number;
  dietary_notes?: string;
  active: boolean;
  pricing_model: 'per_head' | 'total_value' | 'variable' | 'per_jar' | 'per_tray' | 'menu_priced' | 'free';
  created_at: string;
  updated_at: string;
}

export interface CreateCateringPackageInput {
  name: string;
  description?: string | null;
  serving_style: string;
  category: 'food' | 'drink' | 'addon';
  cost_per_head: number;
  minimum_guests?: number | null;
  maximum_guests?: number | null;
  dietary_notes?: string | null;
  active?: boolean;
  pricing_model: 'per_head' | 'total_value' | 'variable' | 'per_jar' | 'per_tray' | 'menu_priced' | 'free';
}

export type UpdateCateringPackageInput = Partial<CreateCateringPackageInput>