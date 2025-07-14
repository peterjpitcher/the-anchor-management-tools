// API-specific types

export interface ApiKey {
  id: string;
  key_hash: string;
  name: string;
  description?: string | null;
  permissions: string[];
  rate_limit: number;
  is_active: boolean;
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiUsage {
  id: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code?: number | null;
  response_time_ms?: number | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface MenuSection {
  id: string;
  name: string;
  description?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  section_id: string;
  name: string;
  description?: string | null;
  price: number;
  calories?: number | null;
  dietary_info: string[];
  allergens: string[];
  is_available: boolean;
  is_special: boolean;
  available_from?: string | null;
  available_until?: string | null;
  image_url?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BusinessHours {
  id: string;
  day_of_week: number; // 0-6, 0=Sunday
  opens?: string | null;
  closes?: string | null;
  kitchen_opens?: string | null;
  kitchen_closes?: string | null;
  is_closed: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpecialHours {
  id: string;
  date: string;
  opens?: string | null;
  closes?: string | null;
  kitchen_opens?: string | null;
  kitchen_closes?: string | null;
  is_closed: boolean;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessAmenity {
  id: string;
  type: string;
  available: boolean;
  details?: string | null;
  capacity?: number | null;
  additional_info: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string | null;
  is_active: boolean;
  last_triggered_at?: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, any>;
  response_status?: number | null;
  response_body?: string | null;
  attempt_count: number;
  delivered_at?: string | null;
  created_at: string;
}