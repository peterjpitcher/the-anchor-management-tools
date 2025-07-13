export interface VenueSpace {
  id: string;
  name: string;
  description?: string;
  capacity_seated?: number;
  capacity_standing?: number;
  rate_per_hour: number;
  minimum_hours: number;
  setup_fee: number;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateVenueSpaceInput {
  name: string;
  description?: string | null;
  capacity_seated?: number | null;
  capacity_standing?: number | null;
  rate_per_hour: number;
  minimum_hours?: number | null;
  setup_fee?: number | null;
  active?: boolean;
}

export type UpdateVenueSpaceInput = Partial<CreateVenueSpaceInput>