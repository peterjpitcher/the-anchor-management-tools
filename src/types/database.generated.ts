export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      achievement_progress: {
        Row: {
          achievement_id: string | null
          created_at: string | null
          current_value: number | null
          id: string
          member_id: string | null
          progress: Json | null
          target_value: number
          updated_at: string | null
        }
        Insert: {
          achievement_id?: string | null
          created_at?: string | null
          current_value?: number | null
          id?: string
          member_id?: string | null
          progress?: Json | null
          target_value: number
          updated_at?: string | null
        }
        Update: {
          achievement_id?: string | null
          created_at?: string | null
          current_value?: number | null
          id?: string
          member_id?: string | null
          progress?: Json | null
          target_value?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "achievement_progress_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "loyalty_achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievement_progress_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          completion_tokens: number
          context: string | null
          cost: number
          id: number
          model: string
          occurred_at: string
          prompt_tokens: number
          total_tokens: number
        }
        Insert: {
          completion_tokens?: number
          context?: string | null
          cost?: number
          id?: number
          model: string
          occurred_at?: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Update: {
          completion_tokens?: number
          context?: string | null
          cost?: number
          id?: number
          model?: string
          occurred_at?: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          customer_id: string
          event_booking_id: string | null
          event_type: string
          id: string
          metadata: Json
          private_booking_id: string | null
          table_booking_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          event_booking_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          private_booking_id?: string | null
          table_booking_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          event_booking_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          private_booking_id?: string | null
          table_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "analytics_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "analytics_events_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "analytics_events_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          last_used_at: string | null
          name: string
          permissions: Json | null
          rate_limit: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          last_used_at?: string | null
          name: string
          permissions?: Json | null
          rate_limit?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          last_used_at?: string | null
          name?: string
          permissions?: Json | null
          rate_limit?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          api_key_id: string
          created_at: string | null
          endpoint: string
          id: string
          ip_address: unknown
          method: string
          response_time_ms: number | null
          status_code: number | null
          user_agent: string | null
        }
        Insert: {
          api_key_id: string
          created_at?: string | null
          endpoint: string
          id?: string
          ip_address?: unknown
          method: string
          response_time_ms?: number | null
          status_code?: number | null
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          ip_address?: unknown
          method?: string
          response_time_ms?: number | null
          status_code?: number | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_categories: {
        Row: {
          category_id: string
          category_name: string
          created_at: string
          email_on_upload: boolean
          updated_at: string
        }
        Insert: {
          category_id?: string
          category_name: string
          created_at?: string
          email_on_upload?: boolean
          updated_at?: string
        }
        Update: {
          category_id?: string
          category_name?: string
          created_at?: string
          email_on_upload?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          additional_info: Json | null
          created_at: string
          error_message: string | null
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          operation_status: string
          operation_type: string
          resource_id: string | null
          resource_type: string
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          additional_info?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          operation_status: string
          operation_type: string
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          additional_info?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          operation_status?: string
          operation_type?: string
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          duration_ms: number | null
          error: string | null
          id: string
          max_attempts: number | null
          payload: Json
          priority: number | null
          processed_at: string | null
          result: Json | null
          scheduled_for: string
          status: string
          type: string
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          max_attempts?: number | null
          payload?: Json
          priority?: number | null
          processed_at?: string | null
          result?: Json | null
          scheduled_for?: string
          status?: string
          type: string
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          max_attempts?: number | null
          payload?: Json
          priority?: number | null
          processed_at?: string | null
          result?: Json | null
          scheduled_for?: string
          status?: string
          type?: string
        }
        Relationships: []
      }
      booking_audit: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          event: string
          id: number
          meta: Json | null
          new_status: string | null
          old_status: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          event: string
          id?: number
          meta?: Json | null
          new_status?: string | null
          old_status?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          event?: string
          id?: number
          meta?: Json | null
          new_status?: string | null
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_audit_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_holds: {
        Row: {
          consumed_at: string | null
          created_at: string
          event_booking_id: string | null
          expires_at: string
          hold_type: string
          id: string
          released_at: string | null
          scheduled_sms_send_time: string | null
          seats_or_covers_held: number
          status: string
          table_booking_id: string | null
          updated_at: string
          waitlist_offer_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          event_booking_id?: string | null
          expires_at: string
          hold_type: string
          id?: string
          released_at?: string | null
          scheduled_sms_send_time?: string | null
          seats_or_covers_held: number
          status?: string
          table_booking_id?: string | null
          updated_at?: string
          waitlist_offer_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          event_booking_id?: string | null
          expires_at?: string
          hold_type?: string
          id?: string
          released_at?: string | null
          scheduled_sms_send_time?: string | null
          seats_or_covers_held?: number
          status?: string
          table_booking_id?: string | null
          updated_at?: string
          waitlist_offer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_holds_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_holds_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_holds_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_holds_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_holds_waitlist_offer_id_fkey"
            columns: ["waitlist_offer_id"]
            isOneToOne: false
            referencedRelation: "waitlist_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_items: {
        Row: {
          attendee_names: string[]
          booking_id: string
          created_at: string
          id: string
          quantity: number
          ticket_type_id: string
          unit_price: number
        }
        Insert: {
          attendee_names?: string[]
          booking_id: string
          created_at?: string
          id?: string
          quantity: number
          ticket_type_id: string
          unit_price: number
        }
        Update: {
          attendee_names?: string[]
          booking_id?: string
          created_at?: string
          id?: string
          quantity?: number
          ticket_type_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "event_ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_period_menu_items: {
        Row: {
          allergens: string | null
          course: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          period_id: string
          price_gbp: number | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergens?: string | null
          course: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          period_id: string
          price_gbp?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergens?: string | null
          course?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          period_id?: string
          price_gbp?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_period_menu_items_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "booking_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_periods: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          deposit_amount: number
          deposit_basis: string
          ends_on: string
          guest_blurb: string | null
          guest_question: string
          id: string
          is_active: boolean
          legacy_booking_type:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          max_party_size: number | null
          min_notice_hours: number
          min_party_size: number | null
          name: string
          period_kind: string
          preorder_cutoff_days: number
          refund_cutoff_days: number
          requires_preorder: boolean
          starts_on: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          deposit_amount?: number
          deposit_basis?: string
          ends_on: string
          guest_blurb?: string | null
          guest_question: string
          id?: string
          is_active?: boolean
          legacy_booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          max_party_size?: number | null
          min_notice_hours?: number
          min_party_size?: number | null
          name: string
          period_kind: string
          preorder_cutoff_days?: number
          refund_cutoff_days?: number
          requires_preorder?: boolean
          starts_on: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          deposit_amount?: number
          deposit_basis?: string
          ends_on?: string
          guest_blurb?: string | null
          guest_question?: string
          id?: string
          is_active?: boolean
          legacy_booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          max_party_size?: number | null
          min_notice_hours?: number
          min_party_size?: number | null
          name?: string
          period_kind?: string
          preorder_cutoff_days?: number
          refund_cutoff_days?: number
          requires_preorder?: boolean
          starts_on?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      booking_policies: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_fee: number | null
          created_at: string | null
          full_refund_hours: number
          id: string
          max_advance_days: number | null
          max_party_size: number | null
          min_advance_hours: number | null
          modification_allowed: boolean | null
          partial_refund_hours: number
          partial_refund_percentage: number
          updated_at: string | null
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_fee?: number | null
          created_at?: string | null
          full_refund_hours?: number
          id?: string
          max_advance_days?: number | null
          max_party_size?: number | null
          min_advance_hours?: number | null
          modification_allowed?: boolean | null
          partial_refund_hours?: number
          partial_refund_percentage?: number
          updated_at?: string | null
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          cancellation_fee?: number | null
          created_at?: string | null
          full_refund_hours?: number
          id?: string
          max_advance_days?: number | null
          max_party_size?: number | null
          min_advance_hours?: number | null
          modification_allowed?: boolean | null
          partial_refund_hours?: number
          partial_refund_percentage?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_preorder_covers: {
        Row: {
          created_at: string
          dietary_note: string | null
          guest_name: string | null
          id: string
          ordinal: number
          table_booking_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dietary_note?: string | null
          guest_name?: string | null
          id?: string
          ordinal: number
          table_booking_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dietary_note?: string | null
          guest_name?: string | null
          id?: string
          ordinal?: number
          table_booking_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_preorder_covers_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_preorder_covers_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_preorder_reminders: {
        Row: {
          id: string
          kind: string
          sent_at: string
          table_booking_id: string
        }
        Insert: {
          id?: string
          kind: string
          sent_at?: string
          table_booking_id: string
        }
        Update: {
          id?: string
          kind?: string
          sent_at?: string
          table_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_preorder_reminders_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_preorder_reminders_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_preorder_selections: {
        Row: {
          course: string
          cover_id: string
          created_at: string
          id: string
          item_name: string
          menu_item_id: string
          price_gbp: number | null
          updated_at: string
        }
        Insert: {
          course: string
          cover_id: string
          created_at?: string
          id?: string
          item_name: string
          menu_item_id: string
          price_gbp?: number | null
          updated_at?: string
        }
        Update: {
          course?: string
          cover_id?: string
          created_at?: string
          id?: string
          item_name?: string
          menu_item_id?: string
          price_gbp?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_preorder_selections_cover_id_fkey"
            columns: ["cover_id"]
            isOneToOne: false
            referencedRelation: "booking_preorder_covers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_preorder_selections_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "booking_period_menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reminders: {
        Row: {
          booking_id: string
          created_at: string
          error_message: string | null
          event_id: string | null
          id: string
          message_id: string | null
          reminder_type: string
          scheduled_for: string
          sent_at: string
          status: string | null
          target_phone: string | null
          updated_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          id?: string
          message_id?: string | null
          reminder_type: string
          scheduled_for?: string
          sent_at?: string
          status?: string | null
          target_phone?: string | null
          updated_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          id?: string
          message_id?: string | null
          reminder_type?: string
          scheduled_for?: string
          sent_at?: string
          status?: string | null
          target_phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_reminders_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_table_assignments: {
        Row: {
          created_at: string
          end_datetime: string
          id: string
          start_datetime: string
          table_booking_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          end_datetime: string
          id?: string
          start_datetime: string
          table_booking_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          end_datetime?: string
          id?: string
          start_datetime?: string
          table_booking_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_table_assignments_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_table_assignments_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_table_assignments_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_time_slots: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"] | null
          created_at: string | null
          day_of_week: number
          duration_minutes: number | null
          id: string
          is_active: boolean | null
          max_covers: number
          slot_time: string
          updated_at: string | null
        }
        Insert: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          created_at?: string | null
          day_of_week: number
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          max_covers: number
          slot_time: string
          updated_at?: string | null
        }
        Update: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          created_at?: string | null
          day_of_week?: number
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          max_covers?: number
          slot_time?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          attendee_names: string[] | null
          booking_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          customer_id: string
          event_id: string
          event_seating_type: string
          expired_at: string | null
          hold_expires_at: string | null
          id: string
          is_reminder_only: boolean
          last_reminder_sent: string | null
          notes: string | null
          review_clicked_at: string | null
          review_sms_sent_at: string | null
          review_suppressed_at: string | null
          review_window_closes_at: string | null
          seats: number | null
          source: string
          status: string
          updated_at: string | null
        }
        Insert: {
          attendee_names?: string[] | null
          booking_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id: string
          event_id: string
          event_seating_type?: string
          expired_at?: string | null
          hold_expires_at?: string | null
          id?: string
          is_reminder_only?: boolean
          last_reminder_sent?: string | null
          notes?: string | null
          review_clicked_at?: string | null
          review_sms_sent_at?: string | null
          review_suppressed_at?: string | null
          review_window_closes_at?: string | null
          seats?: number | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          attendee_names?: string[] | null
          booking_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          event_id?: string
          event_seating_type?: string
          expired_at?: string | null
          hold_expires_at?: string | null
          id?: string
          is_reminder_only?: boolean
          last_reminder_sent?: string | null
          notes?: string | null
          review_clicked_at?: string | null
          review_sms_sent_at?: string | null
          review_suppressed_at?: string | null
          review_window_closes_at?: string | null
          seats?: number | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      business_amenities: {
        Row: {
          additional_info: Json | null
          available: boolean | null
          capacity: number | null
          created_at: string | null
          details: string | null
          id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          additional_info?: Json | null
          available?: boolean | null
          capacity?: number | null
          created_at?: string | null
          details?: string | null
          id?: string
          type: string
          updated_at?: string | null
        }
        Update: {
          additional_info?: Json | null
          available?: boolean | null
          capacity?: number | null
          created_at?: string | null
          details?: string | null
          id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      business_contacts: {
        Row: {
          angle: string | null
          basis_evidence: string | null
          cluster: string | null
          collected_at: string | null
          company_name: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          distance_note: string | null
          eligibility_note: string | null
          eligibility_reviewed_at: string | null
          eligibility_reviewed_by: string | null
          eligibility_status: string
          email: string
          first_name: string | null
          id: string
          invoice_vendor_id: string | null
          is_freemail: boolean
          job_title: string | null
          last_marketing_campaign_id: string | null
          last_marketing_email_at: string | null
          marketing_basis: string | null
          marketing_reserved_until: string | null
          marketing_status: string
          notes: string | null
          opening_line: string | null
          privacy_notice_sent_at: string | null
          resubscribe_note: string | null
          resubscribed_at: string | null
          room_fit: string | null
          room_fit_note: string | null
          send_timing: string | null
          source: string
          source_detail: string | null
          staff_estimate: string | null
          subscriber_type: string
          subscriber_type_verified_at: string | null
          tags: string[]
          unsubscribe_campaign_id: string | null
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          angle?: string | null
          basis_evidence?: string | null
          cluster?: string | null
          collected_at?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          distance_note?: string | null
          eligibility_note?: string | null
          eligibility_reviewed_at?: string | null
          eligibility_reviewed_by?: string | null
          eligibility_status?: string
          email: string
          first_name?: string | null
          id?: string
          invoice_vendor_id?: string | null
          is_freemail?: boolean
          job_title?: string | null
          last_marketing_campaign_id?: string | null
          last_marketing_email_at?: string | null
          marketing_basis?: string | null
          marketing_reserved_until?: string | null
          marketing_status?: string
          notes?: string | null
          opening_line?: string | null
          privacy_notice_sent_at?: string | null
          resubscribe_note?: string | null
          resubscribed_at?: string | null
          room_fit?: string | null
          room_fit_note?: string | null
          send_timing?: string | null
          source?: string
          source_detail?: string | null
          staff_estimate?: string | null
          subscriber_type?: string
          subscriber_type_verified_at?: string | null
          tags?: string[]
          unsubscribe_campaign_id?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          angle?: string | null
          basis_evidence?: string | null
          cluster?: string | null
          collected_at?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          distance_note?: string | null
          eligibility_note?: string | null
          eligibility_reviewed_at?: string | null
          eligibility_reviewed_by?: string | null
          eligibility_status?: string
          email?: string
          first_name?: string | null
          id?: string
          invoice_vendor_id?: string | null
          is_freemail?: boolean
          job_title?: string | null
          last_marketing_campaign_id?: string | null
          last_marketing_email_at?: string | null
          marketing_basis?: string | null
          marketing_reserved_until?: string | null
          marketing_status?: string
          notes?: string | null
          opening_line?: string | null
          privacy_notice_sent_at?: string | null
          resubscribe_note?: string | null
          resubscribed_at?: string | null
          room_fit?: string | null
          room_fit_note?: string | null
          send_timing?: string | null
          source?: string
          source_detail?: string | null
          staff_estimate?: string | null
          subscriber_type?: string
          subscriber_type_verified_at?: string | null
          tags?: string[]
          unsubscribe_campaign_id?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_contacts_eligibility_reviewed_by_fkey"
            columns: ["eligibility_reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_contacts_invoice_vendor_id_fkey"
            columns: ["invoice_vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_contacts_last_campaign_fk"
            columns: ["last_marketing_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_contacts_unsub_campaign_fk"
            columns: ["unsubscribe_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          closes: string | null
          created_at: string | null
          day_of_week: number
          id: string
          is_closed: boolean | null
          is_kitchen_closed: boolean | null
          kitchen_closes: string | null
          kitchen_opens: string | null
          opens: string | null
          schedule_config: Json | null
          updated_at: string | null
          version_id: string
        }
        Insert: {
          closes?: string | null
          created_at?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          opens?: string | null
          schedule_config?: Json | null
          updated_at?: string | null
          version_id?: string
        }
        Update: {
          closes?: string | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          opens?: string | null
          schedule_config?: Json | null
          updated_at?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "business_hours_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours_versions: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          is_baseline: boolean
          label: string | null
          published_at: string | null
          published_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          is_baseline?: boolean
          label?: string | null
          published_at?: string | null
          published_by?: string | null
          status: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          is_baseline?: boolean
          label?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_note_google_sync_queue: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          generation: number
          last_error: string | null
          lease_expires_at: string | null
          note_id: string
          operation: string
          processing_token: string | null
          replay_requested: boolean
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          generation?: number
          last_error?: string | null
          lease_expires_at?: string | null
          note_id: string
          operation: string
          processing_token?: string | null
          replay_requested?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          generation?: number
          last_error?: string | null
          lease_expires_at?: string | null
          note_id?: string
          operation?: string
          processing_token?: string | null
          replay_requested?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      calendar_notes: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          end_date: string | null
          end_time: string | null
          generated_context: Json
          id: string
          note_date: string
          notes: string | null
          source: string
          start_time: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_time?: string | null
          generated_context?: Json
          id?: string
          note_date: string
          notes?: string | null
          source?: string
          start_time?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_time?: string | null
          generated_context?: Json
          id?: string
          note_date?: string
          notes?: string | null
          source?: string
          start_time?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_cash_counts: {
        Row: {
          cashup_session_id: string
          denomination: number
          id: string
          quantity: number
          total_amount: number
        }
        Insert: {
          cashup_session_id: string
          denomination: number
          id?: string
          quantity?: number
          total_amount?: number
        }
        Update: {
          cashup_session_id?: string
          denomination?: number
          id?: string
          quantity?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashup_cash_counts_cashup_session_id_fkey"
            columns: ["cashup_session_id"]
            isOneToOne: false
            referencedRelation: "cashup_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_payment_breakdowns: {
        Row: {
          cashup_session_id: string
          counted_amount: number
          expected_amount: number
          id: string
          payment_type_code: string
          payment_type_label: string
          variance_amount: number
        }
        Insert: {
          cashup_session_id: string
          counted_amount?: number
          expected_amount?: number
          id?: string
          payment_type_code: string
          payment_type_label: string
          variance_amount?: number
        }
        Update: {
          cashup_session_id?: string
          counted_amount?: number
          expected_amount?: number
          id?: string
          payment_type_code?: string
          payment_type_label?: string
          variance_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashup_payment_breakdowns_cashup_session_id_fkey"
            columns: ["cashup_session_id"]
            isOneToOne: false
            referencedRelation: "cashup_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_sales_breakdowns: {
        Row: {
          amount: number
          cashup_session_id: string
          created_at: string
          id: string
          sales_category: string
          updated_at: string
        }
        Insert: {
          amount?: number
          cashup_session_id: string
          created_at?: string
          id?: string
          sales_category: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cashup_session_id?: string
          created_at?: string
          id?: string
          sales_category?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashup_sales_breakdowns_cashup_session_id_fkey"
            columns: ["cashup_session_id"]
            isOneToOne: false
            referencedRelation: "cashup_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_sessions: {
        Row: {
          approved_by_user_id: string | null
          created_at: string
          created_by_user_id: string
          id: string
          notes: string | null
          prepared_by_user_id: string
          session_date: string
          site_id: string
          status: string
          total_counted_amount: number
          total_expected_amount: number
          total_variance_amount: number
          updated_at: string
          updated_by_user_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approved_by_user_id?: string | null
          created_at?: string
          created_by_user_id: string
          id?: string
          notes?: string | null
          prepared_by_user_id: string
          session_date: string
          site_id: string
          status: string
          total_counted_amount?: number
          total_expected_amount?: number
          total_variance_amount?: number
          updated_at?: string
          updated_by_user_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approved_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string
          id?: string
          notes?: string | null
          prepared_by_user_id?: string
          session_date?: string
          site_id?: string
          status?: string
          total_counted_amount?: number
          total_expected_amount?: number
          total_variance_amount?: number
          updated_at?: string
          updated_by_user_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashup_sessions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_target_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          site_id: string
          target_amount: number
          target_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          site_id: string
          target_amount?: number
          target_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          site_id?: string
          target_amount?: number
          target_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashup_target_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashup_target_overrides_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashup_target_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cashup_targets: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: number
          effective_from: string
          id: string
          site_id: string
          target_amount: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week: number
          effective_from: string
          id?: string
          site_id: string
          target_amount?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number
          effective_from?: string
          id?: string
          site_id?: string
          target_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashup_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashup_targets_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_packages: {
        Row: {
          active: boolean | null
          category: string
          cost_per_head: number
          created_at: string
          dietary_notes: string | null
          display_order: number | null
          good_to_know: string | null
          guest_description: string | null
          id: string
          includes: string | null
          maximum_guests: number | null
          minimum_guests: number | null
          name: string
          pricing_model: string | null
          requires_allergy_capture: boolean
          requires_waiver: boolean
          seasonal: boolean
          served: string | null
          serving_style: string | null
          summary: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          active?: boolean | null
          category: string
          cost_per_head: number
          created_at?: string
          dietary_notes?: string | null
          display_order?: number | null
          good_to_know?: string | null
          guest_description?: string | null
          id?: string
          includes?: string | null
          maximum_guests?: number | null
          minimum_guests?: number | null
          name: string
          pricing_model?: string | null
          requires_allergy_capture?: boolean
          requires_waiver?: boolean
          seasonal?: boolean
          served?: string | null
          serving_style?: string | null
          summary?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          active?: boolean | null
          category?: string
          cost_per_head?: number
          created_at?: string
          dietary_notes?: string | null
          display_order?: number | null
          good_to_know?: string | null
          guest_description?: string | null
          id?: string
          includes?: string | null
          maximum_guests?: number | null
          minimum_guests?: number | null
          name?: string
          pricing_model?: string | null
          requires_allergy_capture?: boolean
          requires_waiver?: boolean
          seasonal?: boolean
          served?: string | null
          serving_style?: string | null
          summary?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      charge_requests: {
        Row: {
          amount: number
          charge_status: string
          created_at: string
          currency: string
          decided_at: string | null
          id: string
          manager_decision: string | null
          metadata: Json
          requested_by: string
          requested_by_user_id: string | null
          stripe_payment_intent_id: string | null
          table_booking_id: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          charge_status?: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          id?: string
          manager_decision?: string | null
          metadata?: Json
          requested_by?: string
          requested_by_user_id?: string | null
          stripe_payment_intent_id?: string | null
          table_booking_id: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          charge_status?: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          id?: string
          manager_decision?: string | null
          metadata?: Json
          requested_by?: string
          requested_by_user_id?: string | null
          stripe_payment_intent_id?: string | null
          table_booking_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_requests_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_requests_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_email_outbox: {
        Row: {
          attempts: number
          body_html: string | null
          created_at: string
          email_type: string
          error_message: string | null
          id: string
          idempotency_key: string
          message_id: string | null
          next_attempt_at: string | null
          sent_at: string | null
          source_id: string
          source_type: string
          status: string
          subject: string
          to_addresses: string[]
        }
        Insert: {
          attempts?: number
          body_html?: string | null
          created_at?: string
          email_type: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          message_id?: string | null
          next_attempt_at?: string | null
          sent_at?: string | null
          source_id: string
          source_type: string
          status?: string
          subject: string
          to_addresses: string[]
        }
        Update: {
          attempts?: number
          body_html?: string | null
          created_at?: string
          email_type?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          message_id?: string | null
          next_attempt_at?: string | null
          sent_at?: string | null
          source_id?: string
          source_type?: string
          status?: string
          subject?: string
          to_addresses?: string[]
        }
        Relationships: []
      }
      checklist_generation_runs: {
        Row: {
          attempt: number
          business_date: string
          error_message: string | null
          finished_at: string | null
          id: string
          instances_created: number | null
          instances_retracted: number | null
          instances_updated: number | null
          started_at: string
          status: string
          window_json: Json | null
        }
        Insert: {
          attempt?: number
          business_date: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          instances_created?: number | null
          instances_retracted?: number | null
          instances_updated?: number | null
          started_at?: string
          status: string
          window_json?: Json | null
        }
        Update: {
          attempt?: number
          business_date?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          instances_created?: number | null
          instances_retracted?: number | null
          instances_updated?: number | null
          started_at?: string
          status?: string
          window_json?: Json | null
        }
        Relationships: []
      }
      checklist_hours_mismatches: {
        Row: {
          business_date: string
          created_at: string
          expected_closes_at: string | null
          expected_opens_at: string | null
          id: string
          kind: string
          mismatch_minutes: number
          notified_at: string | null
          rota_earliest_start_at: string | null
          rota_latest_end_at: string | null
        }
        Insert: {
          business_date: string
          created_at?: string
          expected_closes_at?: string | null
          expected_opens_at?: string | null
          id?: string
          kind: string
          mismatch_minutes: number
          notified_at?: string | null
          rota_earliest_start_at?: string | null
          rota_latest_end_at?: string | null
        }
        Update: {
          business_date?: string
          created_at?: string
          expected_closes_at?: string | null
          expected_opens_at?: string | null
          id?: string
          kind?: string
          mismatch_minutes?: number
          notified_at?: string | null
          rota_earliest_start_at?: string | null
          rota_latest_end_at?: string | null
        }
        Relationships: []
      }
      checklist_settings: {
        Row: {
          autumn_winter_end: string
          autumn_winter_start: string
          business_day_start_hour: number
          close_lead_minutes: number
          default_grace_minutes: number
          emails_enabled: boolean
          generation_enabled: boolean
          id: number
          mismatch_early_threshold_minutes: number
          mismatch_threshold_minutes: number
          module_enabled: boolean
          open_lead_minutes: number
          prompts_enabled: boolean
          spot_checks_per_day: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          autumn_winter_end?: string
          autumn_winter_start?: string
          business_day_start_hour?: number
          close_lead_minutes?: number
          default_grace_minutes?: number
          emails_enabled?: boolean
          generation_enabled?: boolean
          id?: number
          mismatch_early_threshold_minutes?: number
          mismatch_threshold_minutes?: number
          module_enabled?: boolean
          open_lead_minutes?: number
          prompts_enabled?: boolean
          spot_checks_per_day?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          autumn_winter_end?: string
          autumn_winter_start?: string
          business_day_start_hour?: number
          close_lead_minutes?: number
          default_grace_minutes?: number
          emails_enabled?: boolean
          generation_enabled?: boolean
          id?: number
          mismatch_early_threshold_minutes?: number
          mismatch_threshold_minutes?: number
          module_enabled?: boolean
          open_lead_minutes?: number
          prompts_enabled?: boolean
          spot_checks_per_day?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      checklist_spot_check_expectations: {
        Row: {
          business_date: string
          expected: number
        }
        Insert: {
          business_date: string
          expected: number
        }
        Update: {
          business_date?: string
          expected?: number
        }
        Relationships: []
      }
      checklist_spot_checks: {
        Row: {
          business_date: string
          checked_by_user_id: string | null
          checked_employee_id: string
          draw_number: number
          drawn_at: string
          id: string
          instance_id: string
          note: string | null
          recorded_at: string | null
          result: string | null
          state: string
        }
        Insert: {
          business_date: string
          checked_by_user_id?: string | null
          checked_employee_id: string
          draw_number: number
          drawn_at?: string
          id?: string
          instance_id: string
          note?: string | null
          recorded_at?: string | null
          result?: string | null
          state?: string
        }
        Update: {
          business_date?: string
          checked_by_user_id?: string | null
          checked_employee_id?: string
          draw_number?: number
          drawn_at?: string
          id?: string
          instance_id?: string
          note?: string | null
          recorded_at?: string | null
          result?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_spot_checks_checked_employee_id_fkey"
            columns: ["checked_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "checklist_spot_checks_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "checklist_task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_task_instances: {
        Row: {
          accountable_employee_id: string | null
          business_date: string
          checklist_id: string
          completed_at: string | null
          completed_by_employee_id: string | null
          created_at: string
          department: string
          due_at: string
          generation_run_id: string | null
          grace_until: string
          id: string
          instruction_snapshot: string | null
          is_spot_checkable: boolean
          locked_at: string | null
          notes: string | null
          requires_value: boolean
          skip_reason: string | null
          slot: string
          state: string
          template_id: string
          template_version: number
          title_snapshot: string
          updated_at: string
          value_breach: boolean
          value_max: number | null
          value_min: number | null
          value_recorded: number | null
          value_unit: string | null
          was_late: boolean
          window_start: string
        }
        Insert: {
          accountable_employee_id?: string | null
          business_date: string
          checklist_id: string
          completed_at?: string | null
          completed_by_employee_id?: string | null
          created_at?: string
          department: string
          due_at: string
          generation_run_id?: string | null
          grace_until: string
          id?: string
          instruction_snapshot?: string | null
          is_spot_checkable: boolean
          locked_at?: string | null
          notes?: string | null
          requires_value: boolean
          skip_reason?: string | null
          slot: string
          state?: string
          template_id: string
          template_version: number
          title_snapshot: string
          updated_at?: string
          value_breach?: boolean
          value_max?: number | null
          value_min?: number | null
          value_recorded?: number | null
          value_unit?: string | null
          was_late?: boolean
          window_start: string
        }
        Update: {
          accountable_employee_id?: string | null
          business_date?: string
          checklist_id?: string
          completed_at?: string | null
          completed_by_employee_id?: string | null
          created_at?: string
          department?: string
          due_at?: string
          generation_run_id?: string | null
          grace_until?: string
          id?: string
          instruction_snapshot?: string | null
          is_spot_checkable?: boolean
          locked_at?: string | null
          notes?: string | null
          requires_value?: boolean
          skip_reason?: string | null
          slot?: string
          state?: string
          template_id?: string
          template_version?: number
          title_snapshot?: string
          updated_at?: string
          value_breach?: boolean
          value_max?: number | null
          value_min?: number | null
          value_recorded?: number | null
          value_unit?: string | null
          was_late?: boolean
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_task_instances_accountable_employee_id_fkey"
            columns: ["accountable_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "checklist_task_instances_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_task_instances_completed_by_employee_id_fkey"
            columns: ["completed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "checklist_task_instances_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "checklist_generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_task_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_task_templates: {
        Row: {
          anchor: string
          anchor_date: string | null
          at_times: string[] | null
          by_weekday: number[] | null
          checklist_id: string
          created_at: string
          created_by: string | null
          department: string | null
          every_hours: number | null
          first_due_on: string | null
          first_offset_minutes: number | null
          freq: string | null
          freq_interval: number
          grace_minutes: number | null
          id: string
          instruction: string | null
          interval_days: number | null
          is_active: boolean
          is_spot_checkable: boolean
          lead_minutes: number
          not_before: string | null
          requires_value: boolean
          schedule_kind: string
          season_end: string | null
          season_start: string | null
          sort_order: number
          title: string
          tolerance_days: number | null
          updated_at: string
          value_max: number | null
          value_min: number | null
          value_unit: string | null
          version: number
        }
        Insert: {
          anchor?: string
          anchor_date?: string | null
          at_times?: string[] | null
          by_weekday?: number[] | null
          checklist_id: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          every_hours?: number | null
          first_due_on?: string | null
          first_offset_minutes?: number | null
          freq?: string | null
          freq_interval?: number
          grace_minutes?: number | null
          id?: string
          instruction?: string | null
          interval_days?: number | null
          is_active?: boolean
          is_spot_checkable?: boolean
          lead_minutes?: number
          not_before?: string | null
          requires_value?: boolean
          schedule_kind: string
          season_end?: string | null
          season_start?: string | null
          sort_order?: number
          title: string
          tolerance_days?: number | null
          updated_at?: string
          value_max?: number | null
          value_min?: number | null
          value_unit?: string | null
          version?: number
        }
        Update: {
          anchor?: string
          anchor_date?: string | null
          at_times?: string[] | null
          by_weekday?: number[] | null
          checklist_id?: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          every_hours?: number | null
          first_due_on?: string | null
          first_offset_minutes?: number | null
          freq?: string | null
          freq_interval?: number
          grace_minutes?: number | null
          id?: string
          instruction?: string | null
          interval_days?: number | null
          is_active?: boolean
          is_spot_checkable?: boolean
          lead_minutes?: number
          not_before?: string | null
          requires_value?: boolean
          schedule_kind?: string
          season_end?: string | null
          season_start?: string | null
          sort_order?: number
          title?: string
          tolerance_days?: number | null
          updated_at?: string
          value_max?: number | null
          value_min?: number | null
          value_unit?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_task_templates_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_task_templates_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["name"]
          },
        ]
      }
      checklist_todos: {
        Row: {
          assigned_employee_id: string | null
          completed_at: string | null
          completed_by_employee_id: string | null
          created_at: string
          created_by: string | null
          department: string | null
          description: string | null
          due_date: string | null
          id: string
          notes: string | null
          state: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_employee_id?: string | null
          completed_at?: string | null
          completed_by_employee_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          state?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_employee_id?: string | null
          completed_at?: string | null
          completed_by_employee_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          state?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_todos_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "checklist_todos_completed_by_employee_id_fkey"
            columns: ["completed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "checklist_todos_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["name"]
          },
        ]
      }
      checklists: {
        Row: {
          created_at: string
          created_by: string | null
          department: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["name"]
          },
        ]
      }
      credit_notes: {
        Row: {
          amount_ex_vat: number
          amount_inc_vat: number
          created_at: string
          created_by: string
          credit_note_number: string
          id: string
          invoice_id: string
          reason: string
          status: string
          vat_rate: number
          vendor_id: string
        }
        Insert: {
          amount_ex_vat: number
          amount_inc_vat: number
          created_at?: string
          created_by: string
          credit_note_number: string
          id?: string
          invoice_id: string
          reason: string
          status?: string
          vat_rate?: number
          vendor_id: string
        }
        Update: {
          amount_ex_vat?: number
          amount_inc_vat?: number
          created_at?: string
          created_by?: string
          credit_note_number?: string
          id?: string
          invoice_id?: string
          reason?: string
          status?: string
          vat_rate?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_job_runs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          job_name: string
          run_key: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          run_key: string
          started_at?: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          run_key?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_achievements: {
        Row: {
          achievement_id: string | null
          created_at: string | null
          earned_date: string | null
          id: string
          member_id: string | null
          points_awarded: number | null
        }
        Insert: {
          achievement_id?: string | null
          created_at?: string | null
          earned_date?: string | null
          id?: string
          member_id?: string | null
          points_awarded?: number | null
        }
        Update: {
          achievement_id?: string | null
          created_at?: string | null
          earned_date?: string | null
          id?: string
          member_id?: string | null
          points_awarded?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "loyalty_achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_achievements_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_category_stats: {
        Row: {
          category_id: string
          created_at: string | null
          customer_id: string
          first_attended_date: string | null
          last_attended_date: string | null
          times_attended: number | null
          updated_at: string | null
        }
        Insert: {
          category_id: string
          created_at?: string | null
          customer_id: string
          first_attended_date?: string | null
          last_attended_date?: string | null
          times_attended?: number | null
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string | null
          customer_id?: string
          first_attended_date?: string | null
          last_attended_date?: string | null
          times_attended?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_category_stats_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "event_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_category_stats_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_category_stats_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_category_stats_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_challenges: {
        Row: {
          challenge_id: string | null
          completed_count: number | null
          created_at: string | null
          id: string
          last_completed_at: string | null
          member_id: string | null
          progress: Json | null
          updated_at: string | null
        }
        Insert: {
          challenge_id?: string | null
          completed_count?: number | null
          created_at?: string | null
          id?: string
          last_completed_at?: string | null
          member_id?: string | null
          progress?: Json | null
          updated_at?: string | null
        }
        Update: {
          challenge_id?: string | null
          completed_count?: number | null
          created_at?: string | null
          id?: string
          last_completed_at?: string | null
          member_id?: string | null
          progress?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_challenges_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "loyalty_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_challenges_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consents: {
        Row: {
          capture_method: string
          captured_at: string
          captured_by_user_id: string | null
          channel: string
          consent_text: string | null
          consent_text_version: string | null
          created_at: string
          customer_id: string
          event_sequence: number
          id: string
          ip_hash: string | null
          legal_basis: string
          metadata: Json
          purpose: string
          related_entity_id: string | null
          related_entity_type: string | null
          source: string
          source_url: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          capture_method: string
          captured_at?: string
          captured_by_user_id?: string | null
          channel: string
          consent_text?: string | null
          consent_text_version?: string | null
          created_at?: string
          customer_id: string
          event_sequence?: number
          id?: string
          ip_hash?: string | null
          legal_basis: string
          metadata?: Json
          purpose: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          source: string
          source_url?: string | null
          status: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          capture_method?: string
          captured_at?: string
          captured_by_user_id?: string | null
          channel?: string
          consent_text?: string | null
          consent_text_version?: string | null
          created_at?: string
          customer_id?: string
          event_sequence?: number
          id?: string
          ip_hash?: string | null
          legal_basis?: string
          metadata?: Json
          purpose?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_captured_by_user_id_fkey"
            columns: ["captured_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_label_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          auto_assigned: boolean | null
          customer_id: string
          id: string
          label_id: string
          notes: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          auto_assigned?: boolean | null
          customer_id: string
          id?: string
          label_id: string
          notes?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          auto_assigned?: boolean | null
          customer_id?: string
          id?: string
          label_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_label_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_label_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_label_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_label_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "customer_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_labels: {
        Row: {
          auto_apply_rules: Json | null
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          auto_apply_rules?: Json | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          auto_apply_rules?: Json | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      customer_scores: {
        Row: {
          booking_breakdown: Json
          bookings_last_30: number
          bookings_last_365: number
          bookings_last_90: number
          customer_id: string
          last_booking_date: string | null
          total_score: number
          updated_at: string
        }
        Insert: {
          booking_breakdown?: Json
          bookings_last_30?: number
          bookings_last_365?: number
          bookings_last_90?: number
          customer_id: string
          last_booking_date?: string | null
          total_score?: number
          updated_at?: string
        }
        Update: {
          booking_breakdown?: Json
          bookings_last_30?: number
          bookings_last_365?: number
          bookings_last_90?: number
          customer_id?: string
          last_booking_date?: string | null
          total_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_scores_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_scores_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_scores_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          consecutive_failures: number | null
          created_at: string
          email: string | null
          email_deactivated_at: string | null
          email_delivery_failures: number
          email_status: string
          first_name: string
          id: string
          internal_notes: string | null
          last_email_failure_reason: string | null
          last_failure_type: string | null
          last_name: string
          last_sms_failure_reason: string | null
          last_successful_delivery: string | null
          last_successful_email_at: string | null
          last_successful_sms_at: string | null
          last_successful_whatsapp_at: string | null
          last_table_booking_date: string | null
          last_whatsapp_failure_reason: string | null
          last_whatsapp_inbound_at: string | null
          marketing_email_opt_in: boolean
          marketing_email_opt_in_at: string | null
          marketing_email_opted_out_at: string | null
          marketing_last_campaign_id: string | null
          marketing_last_email_at: string | null
          marketing_reserved_until: string | null
          marketing_sms_opt_in: boolean
          marketing_sms_opt_in_at: string | null
          marketing_sms_opted_out_at: string | null
          marketing_unsubscribe_campaign_id: string | null
          marketing_whatsapp_opt_in: boolean
          marketing_whatsapp_opt_in_at: string | null
          marketing_whatsapp_opted_out_at: string | null
          messaging_status: string | null
          mobile_e164: string | null
          mobile_number: string
          mobile_number_raw: string | null
          no_show_count: number | null
          sms_deactivated_at: string | null
          sms_deactivation_reason: string | null
          sms_delivery_failures: number | null
          sms_opt_in: boolean | null
          sms_opt_in_at: string | null
          sms_opt_in_source: string | null
          sms_opted_out_at: string | null
          sms_status: string
          stripe_customer_id: string | null
          table_booking_count: number | null
          total_failures_30d: number | null
          whatsapp_deactivated_at: string | null
          whatsapp_deactivation_reason: string | null
          whatsapp_delivery_failures: number
          whatsapp_opt_in: boolean
          whatsapp_opt_in_at: string | null
          whatsapp_opt_in_source: string | null
          whatsapp_opted_out_at: string | null
          whatsapp_status: string
        }
        Insert: {
          consecutive_failures?: number | null
          created_at?: string
          email?: string | null
          email_deactivated_at?: string | null
          email_delivery_failures?: number
          email_status?: string
          first_name: string
          id?: string
          internal_notes?: string | null
          last_email_failure_reason?: string | null
          last_failure_type?: string | null
          last_name: string
          last_sms_failure_reason?: string | null
          last_successful_delivery?: string | null
          last_successful_email_at?: string | null
          last_successful_sms_at?: string | null
          last_successful_whatsapp_at?: string | null
          last_table_booking_date?: string | null
          last_whatsapp_failure_reason?: string | null
          last_whatsapp_inbound_at?: string | null
          marketing_email_opt_in?: boolean
          marketing_email_opt_in_at?: string | null
          marketing_email_opted_out_at?: string | null
          marketing_last_campaign_id?: string | null
          marketing_last_email_at?: string | null
          marketing_reserved_until?: string | null
          marketing_sms_opt_in?: boolean
          marketing_sms_opt_in_at?: string | null
          marketing_sms_opted_out_at?: string | null
          marketing_unsubscribe_campaign_id?: string | null
          marketing_whatsapp_opt_in?: boolean
          marketing_whatsapp_opt_in_at?: string | null
          marketing_whatsapp_opted_out_at?: string | null
          messaging_status?: string | null
          mobile_e164?: string | null
          mobile_number: string
          mobile_number_raw?: string | null
          no_show_count?: number | null
          sms_deactivated_at?: string | null
          sms_deactivation_reason?: string | null
          sms_delivery_failures?: number | null
          sms_opt_in?: boolean | null
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
          sms_opted_out_at?: string | null
          sms_status?: string
          stripe_customer_id?: string | null
          table_booking_count?: number | null
          total_failures_30d?: number | null
          whatsapp_deactivated_at?: string | null
          whatsapp_deactivation_reason?: string | null
          whatsapp_delivery_failures?: number
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opted_out_at?: string | null
          whatsapp_status?: string
        }
        Update: {
          consecutive_failures?: number | null
          created_at?: string
          email?: string | null
          email_deactivated_at?: string | null
          email_delivery_failures?: number
          email_status?: string
          first_name?: string
          id?: string
          internal_notes?: string | null
          last_email_failure_reason?: string | null
          last_failure_type?: string | null
          last_name?: string
          last_sms_failure_reason?: string | null
          last_successful_delivery?: string | null
          last_successful_email_at?: string | null
          last_successful_sms_at?: string | null
          last_successful_whatsapp_at?: string | null
          last_table_booking_date?: string | null
          last_whatsapp_failure_reason?: string | null
          last_whatsapp_inbound_at?: string | null
          marketing_email_opt_in?: boolean
          marketing_email_opt_in_at?: string | null
          marketing_email_opted_out_at?: string | null
          marketing_last_campaign_id?: string | null
          marketing_last_email_at?: string | null
          marketing_reserved_until?: string | null
          marketing_sms_opt_in?: boolean
          marketing_sms_opt_in_at?: string | null
          marketing_sms_opted_out_at?: string | null
          marketing_unsubscribe_campaign_id?: string | null
          marketing_whatsapp_opt_in?: boolean
          marketing_whatsapp_opt_in_at?: string | null
          marketing_whatsapp_opted_out_at?: string | null
          messaging_status?: string | null
          mobile_e164?: string | null
          mobile_number?: string
          mobile_number_raw?: string | null
          no_show_count?: number | null
          sms_deactivated_at?: string | null
          sms_deactivation_reason?: string | null
          sms_delivery_failures?: number | null
          sms_opt_in?: boolean | null
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
          sms_opted_out_at?: string | null
          sms_status?: string
          stripe_customer_id?: string | null
          table_booking_count?: number | null
          total_failures_30d?: number | null
          whatsapp_deactivated_at?: string | null
          whatsapp_deactivation_reason?: string | null
          whatsapp_delivery_failures?: number
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opted_out_at?: string | null
          whatsapp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_marketing_last_campaign_id_fkey"
            columns: ["marketing_last_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_marketing_unsubscribe_campaign_id_fkey"
            columns: ["marketing_unsubscribe_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      department_budgets: {
        Row: {
          annual_hours: number
          budget_year: number
          created_at: string
          created_by: string | null
          department: string
          id: string
          updated_at: string
        }
        Insert: {
          annual_hours: number
          budget_year: number
          created_at?: string
          created_by?: string | null
          department: string
          id?: string
          updated_at?: string
        }
        Update: {
          annual_hours?: number
          budget_year?: number
          created_at?: string
          created_by?: string | null
          department?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          label: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          label: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          label?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      email_link_clicks: {
        Row: {
          clicked_at: string
          created_at: string
          email_message_id: string | null
          id: string
          ip_address: string | null
          link_url: string
          provider_message_id: string | null
          user_agent: string | null
        }
        Insert: {
          clicked_at?: string
          created_at?: string
          email_message_id?: string | null
          id?: string
          ip_address?: string | null
          link_url: string
          provider_message_id?: string | null
          user_agent?: string | null
        }
        Update: {
          clicked_at?: string
          created_at?: string
          email_message_id?: string | null
          id?: string
          ip_address?: string | null
          link_url?: string
          provider_message_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_link_clicks_email_message_id_fkey"
            columns: ["email_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          attachments: Json | null
          body_html: string | null
          body_text: string | null
          bounced_at: string | null
          business_contact_id: string | null
          clicked_at: string | null
          comm_type: string | null
          complained_at: string | null
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          delivery_delayed_at: string | null
          direction: string
          error: string | null
          event_booking_id: string | null
          failed_at: string | null
          from_address: string | null
          has_attachments: boolean
          id: string
          invoice_id: string | null
          marketing_campaign_id: string | null
          marketing_recipient_id: string | null
          metadata: Json
          opened_at: string | null
          parking_booking_id: string | null
          private_booking_id: string | null
          quote_id: string | null
          received_at: string | null
          replied_at: string | null
          resend_message_id: string | null
          sent_at: string | null
          staff_read_at: string | null
          status: string
          subject: string | null
          table_booking_id: string | null
          to_address: string
          updated_at: string
        }
        Insert: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          bounced_at?: string | null
          business_contact_id?: string | null
          clicked_at?: string | null
          comm_type?: string | null
          complained_at?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_delayed_at?: string | null
          direction?: string
          error?: string | null
          event_booking_id?: string | null
          failed_at?: string | null
          from_address?: string | null
          has_attachments?: boolean
          id?: string
          invoice_id?: string | null
          marketing_campaign_id?: string | null
          marketing_recipient_id?: string | null
          metadata?: Json
          opened_at?: string | null
          parking_booking_id?: string | null
          private_booking_id?: string | null
          quote_id?: string | null
          received_at?: string | null
          replied_at?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          staff_read_at?: string | null
          status?: string
          subject?: string | null
          table_booking_id?: string | null
          to_address: string
          updated_at?: string
        }
        Update: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          bounced_at?: string | null
          business_contact_id?: string | null
          clicked_at?: string | null
          comm_type?: string | null
          complained_at?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_delayed_at?: string | null
          direction?: string
          error?: string | null
          event_booking_id?: string | null
          failed_at?: string | null
          from_address?: string | null
          has_attachments?: boolean
          id?: string
          invoice_id?: string | null
          marketing_campaign_id?: string | null
          marketing_recipient_id?: string | null
          metadata?: Json
          opened_at?: string | null
          parking_booking_id?: string | null
          private_booking_id?: string | null
          quote_id?: string | null
          received_at?: string | null
          replied_at?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          staff_read_at?: string | null
          status?: string
          subject?: string | null
          table_booking_id?: string | null
          to_address?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_business_contact_id_fkey"
            columns: ["business_contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "email_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "email_messages_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_marketing_campaign_id_fkey"
            columns: ["marketing_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_marketing_recipient_id_fkey"
            columns: ["marketing_recipient_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_parking_booking_id_fkey"
            columns: ["parking_booking_id"]
            isOneToOne: false
            referencedRelation: "parking_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "email_messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
          resend_email_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
          resend_email_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
          resend_email_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          business_contact_id: string | null
          created_at: string
          customer_id: string | null
          last_used_at: string | null
          token: string
          use_count: number
        }
        Insert: {
          business_contact_id?: string | null
          created_at?: string
          customer_id?: string | null
          last_used_at?: string | null
          token: string
          use_count?: number
        }
        Update: {
          business_contact_id?: string | null
          created_at?: string
          customer_id?: string | null
          last_used_at?: string | null
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribe_tokens_business_contact_id_fkey"
            columns: ["business_contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      email_webhook_unmatched: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          provider_message_id: string | null
          resolved_at: string | null
          to_address: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          provider_message_id?: string | null
          resolved_at?: string | null
          to_address?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          provider_message_id?: string | null
          resolved_at?: string | null
          to_address?: string | null
        }
        Relationships: []
      }
      employee_attachments: {
        Row: {
          attachment_id: string
          category_id: string
          description: string | null
          employee_id: string
          file_name: string
          file_size_bytes: number
          mime_type: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          attachment_id?: string
          category_id: string
          description?: string | null
          employee_id: string
          file_name: string
          file_size_bytes: number
          mime_type: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          attachment_id?: string
          category_id?: string
          description?: string | null
          employee_id?: string
          file_name?: string
          file_size_bytes?: number
          mime_type?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_attachments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "attachment_categories"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "employee_attachments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_emergency_contacts: {
        Row: {
          address: string | null
          created_at: string | null
          employee_id: string
          id: string
          mobile_number: string | null
          name: string
          phone_number: string | null
          priority: string | null
          relationship: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          mobile_number?: string | null
          name: string
          phone_number?: string | null
          priority?: string | null
          relationship?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          mobile_number?: string | null
          name?: string
          phone_number?: string | null
          priority?: string | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_emergency_contacts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_financial_details: {
        Row: {
          bank_account_number: string | null
          bank_name: string | null
          bank_sort_code: string | null
          branch_address: string | null
          created_at: string
          employee_id: string
          ni_number: string | null
          payee_name: string | null
          updated_at: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_name?: string | null
          bank_sort_code?: string | null
          branch_address?: string | null
          created_at?: string
          employee_id: string
          ni_number?: string | null
          payee_name?: string | null
          updated_at?: string
        }
        Update: {
          bank_account_number?: string | null
          bank_name?: string | null
          bank_sort_code?: string | null
          branch_address?: string | null
          created_at?: string
          employee_id?: string
          ni_number?: string | null
          payee_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_financial_details_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_health_records: {
        Row: {
          absence_or_treatment_details: string | null
          allergies: string | null
          created_at: string
          disability_details: string | null
          disability_reg_expiry_date: string | null
          disability_reg_number: string | null
          doctor_address: string | null
          doctor_name: string | null
          employee_id: string
          had_absence_over_2_weeks_last_3_years: boolean
          had_outpatient_treatment_over_3_months_last_3_years: boolean
          has_allergies: boolean
          has_bowel_problems: boolean
          has_depressive_illness: boolean
          has_diabetes: boolean
          has_ear_problems: boolean
          has_epilepsy: boolean
          has_skin_condition: boolean
          illness_history: string | null
          is_registered_disabled: boolean
          recent_treatment: string | null
          updated_at: string
        }
        Insert: {
          absence_or_treatment_details?: string | null
          allergies?: string | null
          created_at?: string
          disability_details?: string | null
          disability_reg_expiry_date?: string | null
          disability_reg_number?: string | null
          doctor_address?: string | null
          doctor_name?: string | null
          employee_id: string
          had_absence_over_2_weeks_last_3_years?: boolean
          had_outpatient_treatment_over_3_months_last_3_years?: boolean
          has_allergies?: boolean
          has_bowel_problems?: boolean
          has_depressive_illness?: boolean
          has_diabetes?: boolean
          has_ear_problems?: boolean
          has_epilepsy?: boolean
          has_skin_condition?: boolean
          illness_history?: string | null
          is_registered_disabled?: boolean
          recent_treatment?: string | null
          updated_at?: string
        }
        Update: {
          absence_or_treatment_details?: string | null
          allergies?: string | null
          created_at?: string
          disability_details?: string | null
          disability_reg_expiry_date?: string | null
          disability_reg_number?: string | null
          doctor_address?: string | null
          doctor_name?: string | null
          employee_id?: string
          had_absence_over_2_weeks_last_3_years?: boolean
          had_outpatient_treatment_over_3_months_last_3_years?: boolean
          has_allergies?: boolean
          has_bowel_problems?: boolean
          has_depressive_illness?: boolean
          has_diabetes?: boolean
          has_ear_problems?: boolean
          has_epilepsy?: boolean
          has_skin_condition?: boolean
          illness_history?: string | null
          is_registered_disabled?: boolean
          recent_treatment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_health_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_invite_tokens: {
        Row: {
          completed_at: string | null
          created_at: string
          day3_chase_sent_at: string | null
          day6_chase_sent_at: string | null
          email: string
          employee_id: string
          expires_at: string
          id: string
          invite_type: string
          token: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          day3_chase_sent_at?: string | null
          day6_chase_sent_at?: string | null
          email: string
          employee_id: string
          expires_at?: string
          id?: string
          invite_type?: string
          token?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          day3_chase_sent_at?: string | null
          day6_chase_sent_at?: string | null
          email?: string
          employee_id?: string
          expires_at?: string
          id?: string
          invite_type?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_invite_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_notes: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          employee_id: string
          note_id: string
          note_text: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          employee_id: string
          note_id?: string
          note_text: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          employee_id?: string
          note_id?: string
          note_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_onboarding_checklist: {
        Row: {
          created_at: string | null
          employee_agreement_accepted: boolean | null
          employee_agreement_accepted_date: string | null
          employee_id: string
          employment_agreement_date: string | null
          employment_agreement_drafted: boolean | null
          private_whatsapp_added: boolean | null
          private_whatsapp_date: string | null
          team_whatsapp_added: boolean | null
          team_whatsapp_date: string | null
          till_system_date: string | null
          till_system_setup: boolean | null
          training_flow_date: string | null
          training_flow_setup: boolean | null
          updated_at: string | null
          wheniwork_invite_date: string | null
          wheniwork_invite_sent: boolean | null
        }
        Insert: {
          created_at?: string | null
          employee_agreement_accepted?: boolean | null
          employee_agreement_accepted_date?: string | null
          employee_id: string
          employment_agreement_date?: string | null
          employment_agreement_drafted?: boolean | null
          private_whatsapp_added?: boolean | null
          private_whatsapp_date?: string | null
          team_whatsapp_added?: boolean | null
          team_whatsapp_date?: string | null
          till_system_date?: string | null
          till_system_setup?: boolean | null
          training_flow_date?: string | null
          training_flow_setup?: boolean | null
          updated_at?: string | null
          wheniwork_invite_date?: string | null
          wheniwork_invite_sent?: boolean | null
        }
        Update: {
          created_at?: string | null
          employee_agreement_accepted?: boolean | null
          employee_agreement_accepted_date?: string | null
          employee_id?: string
          employment_agreement_date?: string | null
          employment_agreement_drafted?: boolean | null
          private_whatsapp_added?: boolean | null
          private_whatsapp_date?: string | null
          team_whatsapp_added?: boolean | null
          team_whatsapp_date?: string | null
          till_system_date?: string | null
          till_system_setup?: boolean | null
          training_flow_date?: string | null
          training_flow_setup?: boolean | null
          updated_at?: string | null
          wheniwork_invite_date?: string | null
          wheniwork_invite_sent?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_onboarding_checklist_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_pay_settings: {
        Row: {
          created_at: string
          employee_id: string
          holiday_allowance_days: number
          id: string
          max_weekly_hours: number | null
          non_working_weekdays: number[]
          pay_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          holiday_allowance_days?: number
          id?: string
          max_weekly_hours?: number | null
          non_working_weekdays?: number[]
          pay_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          holiday_allowance_days?: number
          id?: string
          max_weekly_hours?: number | null
          non_working_weekdays?: number[]
          pay_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_pay_settings_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_rate_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          employee_id: string
          hourly_rate: number
          id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          employee_id: string
          hourly_rate: number
          id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          employee_id?: string
          hourly_rate?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_rate_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rate_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_reliability_events: {
        Row: {
          created_at: string
          department: string | null
          employee_id: string
          end_time: string | null
          event_at: string
          event_type: string
          id: string
          idempotency_key: string
          impacted_shift_count: number
          leave_day_count: number | null
          leave_end_date: string | null
          leave_request_id: string | null
          leave_start_date: string | null
          metadata: Json
          note: string | null
          notice_days: number | null
          published_at: string | null
          score_eligible: boolean
          shift_date: string | null
          shift_id: string | null
          shift_name: string | null
          source: string
          source_id: string | null
          source_table: string | null
          start_time: string | null
          week_id: string | null
        }
        Insert: {
          created_at?: string
          department?: string | null
          employee_id: string
          end_time?: string | null
          event_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          impacted_shift_count?: number
          leave_day_count?: number | null
          leave_end_date?: string | null
          leave_request_id?: string | null
          leave_start_date?: string | null
          metadata?: Json
          note?: string | null
          notice_days?: number | null
          published_at?: string | null
          score_eligible?: boolean
          shift_date?: string | null
          shift_id?: string | null
          shift_name?: string | null
          source?: string
          source_id?: string | null
          source_table?: string | null
          start_time?: string | null
          week_id?: string | null
        }
        Update: {
          created_at?: string
          department?: string | null
          employee_id?: string
          end_time?: string | null
          event_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          impacted_shift_count?: number
          leave_day_count?: number | null
          leave_end_date?: string | null
          leave_request_id?: string | null
          leave_start_date?: string | null
          metadata?: Json
          note?: string | null
          notice_days?: number | null
          published_at?: string | null
          score_eligible?: boolean
          shift_date?: string | null
          shift_id?: string | null
          shift_name?: string | null
          source?: string
          source_id?: string | null
          source_table?: string | null
          start_time?: string | null
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_reliability_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_right_to_work: {
        Row: {
          check_method: string | null
          created_at: string | null
          document_details: string | null
          document_expiry_date: string | null
          document_reference: string | null
          document_type: string
          employee_id: string
          follow_up_date: string | null
          photo_storage_path: string | null
          updated_at: string | null
          verification_date: string
          verified_by_user_id: string | null
        }
        Insert: {
          check_method?: string | null
          created_at?: string | null
          document_details?: string | null
          document_expiry_date?: string | null
          document_reference?: string | null
          document_type: string
          employee_id: string
          follow_up_date?: string | null
          photo_storage_path?: string | null
          updated_at?: string | null
          verification_date: string
          verified_by_user_id?: string | null
        }
        Update: {
          check_method?: string | null
          created_at?: string | null
          document_details?: string | null
          document_expiry_date?: string | null
          document_reference?: string | null
          document_type?: string
          employee_id?: string
          follow_up_date?: string | null
          photo_storage_path?: string | null
          updated_at?: string | null
          verification_date?: string
          verified_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_right_to_work_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_right_to_work_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          auth_user_id: string | null
          created_at: string
          date_of_birth: string | null
          email_address: string
          employee_id: string
          employment_end_date: string | null
          employment_start_date: string | null
          first_name: string | null
          first_shift_date: string | null
          invited_at: string | null
          job_title: string | null
          keyholder_status: boolean | null
          last_name: string | null
          mobile_number: string | null
          onboarding_completed_at: string | null
          phone_number: string | null
          post_code: string | null
          preferred_name: string | null
          status: string
          timeclock_pin_hash: string | null
          timeclock_pin_updated_at: string | null
          uniform_preference: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email_address: string
          employee_id?: string
          employment_end_date?: string | null
          employment_start_date?: string | null
          first_name?: string | null
          first_shift_date?: string | null
          invited_at?: string | null
          job_title?: string | null
          keyholder_status?: boolean | null
          last_name?: string | null
          mobile_number?: string | null
          onboarding_completed_at?: string | null
          phone_number?: string | null
          post_code?: string | null
          preferred_name?: string | null
          status?: string
          timeclock_pin_hash?: string | null
          timeclock_pin_updated_at?: string | null
          uniform_preference?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email_address?: string
          employee_id?: string
          employment_end_date?: string | null
          employment_start_date?: string | null
          first_name?: string | null
          first_shift_date?: string | null
          invited_at?: string | null
          job_title?: string | null
          keyholder_status?: boolean | null
          last_name?: string | null
          mobile_number?: string | null
          onboarding_completed_at?: string | null
          phone_number?: string | null
          post_code?: string | null
          preferred_name?: string | null
          status?: string
          timeclock_pin_hash?: string | null
          timeclock_pin_updated_at?: string | null
          uniform_preference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      event_categories: {
        Row: {
          accessibility_notes: string | null
          cancellation_policy: string | null
          color: string
          created_at: string | null
          default_booking_mode: string
          default_booking_url: string | null
          default_bookings_enabled: boolean
          default_capacity: number | null
          default_doors_time: string | null
          default_duration_minutes: number | null
          default_end_time: string | null
          default_event_status: string | null
          default_image_url: string | null
          default_is_free: boolean | null
          default_last_entry_time: string | null
          default_payment_mode: string
          default_performer_name: string | null
          default_performer_type: string | null
          default_price: number | null
          default_promo_sms_enabled: boolean
          default_reminder_hours: number | null
          default_start_time: string | null
          description: string | null
          faqs: Json | null
          gallery_image_urls: Json | null
          highlight_video_urls: Json | null
          highlights: Json | null
          icon: string | null
          id: string
          image_alt_text: string | null
          is_active: boolean | null
          is_default: boolean | null
          keywords: Json | null
          local_seo_keywords: Json | null
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          poster_image_url: string | null
          primary_keywords: Json | null
          promo_video_url: string | null
          secondary_keywords: Json | null
          short_description: string | null
          slug: string
          sort_order: number | null
          thumbnail_image_url: string | null
          updated_at: string | null
        }
        Insert: {
          accessibility_notes?: string | null
          cancellation_policy?: string | null
          color?: string
          created_at?: string | null
          default_booking_mode?: string
          default_booking_url?: string | null
          default_bookings_enabled?: boolean
          default_capacity?: number | null
          default_doors_time?: string | null
          default_duration_minutes?: number | null
          default_end_time?: string | null
          default_event_status?: string | null
          default_image_url?: string | null
          default_is_free?: boolean | null
          default_last_entry_time?: string | null
          default_payment_mode?: string
          default_performer_name?: string | null
          default_performer_type?: string | null
          default_price?: number | null
          default_promo_sms_enabled?: boolean
          default_reminder_hours?: number | null
          default_start_time?: string | null
          description?: string | null
          faqs?: Json | null
          gallery_image_urls?: Json | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          icon?: string | null
          id?: string
          image_alt_text?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: Json | null
          local_seo_keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          poster_image_url?: string | null
          primary_keywords?: Json | null
          promo_video_url?: string | null
          secondary_keywords?: Json | null
          short_description?: string | null
          slug: string
          sort_order?: number | null
          thumbnail_image_url?: string | null
          updated_at?: string | null
        }
        Update: {
          accessibility_notes?: string | null
          cancellation_policy?: string | null
          color?: string
          created_at?: string | null
          default_booking_mode?: string
          default_booking_url?: string | null
          default_bookings_enabled?: boolean
          default_capacity?: number | null
          default_doors_time?: string | null
          default_duration_minutes?: number | null
          default_end_time?: string | null
          default_event_status?: string | null
          default_image_url?: string | null
          default_is_free?: boolean | null
          default_last_entry_time?: string | null
          default_payment_mode?: string
          default_performer_name?: string | null
          default_performer_type?: string | null
          default_price?: number | null
          default_promo_sms_enabled?: boolean
          default_reminder_hours?: number | null
          default_start_time?: string | null
          description?: string | null
          faqs?: Json | null
          gallery_image_urls?: Json | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          icon?: string | null
          id?: string
          image_alt_text?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: Json | null
          local_seo_keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          poster_image_url?: string | null
          primary_keywords?: Json | null
          promo_video_url?: string | null
          secondary_keywords?: Json | null
          short_description?: string | null
          slug?: string
          sort_order?: number | null
          thumbnail_image_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      event_check_ins: {
        Row: {
          booking_id: string | null
          check_in_method: string | null
          check_in_time: string | null
          created_at: string | null
          customer_id: string | null
          event_id: string | null
          id: string
          member_id: string | null
          points_earned: number | null
          staff_id: string | null
        }
        Insert: {
          booking_id?: string | null
          check_in_method?: string | null
          check_in_time?: string | null
          created_at?: string | null
          customer_id?: string | null
          event_id?: string | null
          id?: string
          member_id?: string | null
          points_earned?: number | null
          staff_id?: string | null
        }
        Update: {
          booking_id?: string | null
          check_in_method?: string | null
          check_in_time?: string | null
          created_at?: string | null
          customer_id?: string | null
          event_id?: string | null
          id?: string
          member_id?: string | null
          points_earned?: number | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_check_ins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_check_ins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_check_ins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "event_check_ins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_check_ins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_check_ins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_check_ins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_check_ins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      event_checklist_statuses: {
        Row: {
          completed_at: string | null
          created_at: string
          event_id: string
          id: string
          task_key: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          task_key: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          task_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checklist_statuses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_communal_seat_allocations: {
        Row: {
          created_at: string
          end_datetime: string
          event_booking_id: string
          event_id: string
          id: string
          seats: number
          start_datetime: string
          table_booking_id: string | null
          table_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_datetime: string
          event_booking_id: string
          event_id: string
          id?: string
          seats: number
          start_datetime: string
          table_booking_id?: string | null
          table_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_datetime?: string
          event_booking_id?: string
          event_id?: string
          id?: string
          seats?: number
          start_datetime?: string
          table_booking_id?: string | null
          table_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_communal_seat_allocations_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_communal_seat_allocations_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_communal_seat_allocations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_communal_seat_allocations_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_communal_seat_allocations_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_communal_seat_allocations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      event_faqs: {
        Row: {
          answer: string
          created_at: string | null
          event_id: string
          id: string
          question: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          answer: string
          created_at?: string | null
          event_id: string
          id?: string
          question: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          answer?: string
          created_at?: string | null
          event_id?: string
          id?: string
          question?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_faqs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_images: {
        Row: {
          alt_text: string | null
          caption: string | null
          created_at: string | null
          display_order: number | null
          event_id: string
          file_name: string
          file_size_bytes: number
          id: string
          image_type: string
          mime_type: string
          storage_path: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          display_order?: number | null
          event_id: string
          file_name: string
          file_size_bytes: number
          id?: string
          image_type: string
          mime_type: string
          storage_path: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          display_order?: number | null
          event_id?: string
          file_name?: string
          file_size_bytes?: number
          id?: string
          image_type?: string
          mime_type?: string
          storage_path?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_images_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_images_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      event_images_dedupe_backup_20260812: {
        Row: {
          alt_text: string | null
          caption: string | null
          created_at: string | null
          display_order: number | null
          event_id: string
          file_name: string
          file_size_bytes: number
          id: string
          image_type: string
          mime_type: string
          storage_path: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          display_order?: number | null
          event_id: string
          file_name: string
          file_size_bytes: number
          id?: string
          image_type: string
          mime_type: string
          storage_path: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          display_order?: number | null
          event_id?: string
          file_name?: string
          file_size_bytes?: number
          id?: string
          image_type?: string
          mime_type?: string
          storage_path?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      event_interest_manual_recipients: {
        Row: {
          created_at: string
          customer_id: string
          event_id: string
          id: string
          reminder_14d_sent_at: string | null
          reminder_1d_sent_at: string | null
          reminder_7d_sent_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          event_id: string
          id?: string
          reminder_14d_sent_at?: string | null
          reminder_1d_sent_at?: string | null
          reminder_7d_sent_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          event_id?: string
          id?: string
          reminder_14d_sent_at?: string | null
          reminder_1d_sent_at?: string | null
          reminder_7d_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_interest_manual_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "event_interest_manual_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_interest_manual_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_interest_manual_recipients_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_message_templates: {
        Row: {
          character_count: number | null
          content: string
          created_at: string
          custom_timing_hours: number | null
          estimated_segments: number | null
          event_id: string
          id: string
          is_active: boolean | null
          send_timing: string | null
          template_type: string
          variables: string[] | null
        }
        Insert: {
          character_count?: number | null
          content: string
          created_at?: string
          custom_timing_hours?: number | null
          estimated_segments?: number | null
          event_id: string
          id?: string
          is_active?: boolean | null
          send_timing?: string | null
          template_type: string
          variables?: string[] | null
        }
        Update: {
          character_count?: number | null
          content?: string
          created_at?: string
          custom_timing_hours?: number | null
          estimated_segments?: number | null
          event_id?: string
          id?: string
          is_active?: boolean | null
          send_timing?: string | null
          template_type?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "event_message_templates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_payment_exceptions: {
        Row: {
          created_at: string
          customer_notified_at: string | null
          event_booking_id: string
          id: string
          metadata: Json
          payment_id: string | null
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          staff_notified_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_notified_at?: string | null
          event_booking_id: string
          id?: string
          metadata?: Json
          payment_id?: string | null
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          staff_notified_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_notified_at?: string | null
          event_booking_id?: string
          id?: string
          metadata?: Json
          payment_id?: string | null
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          staff_notified_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_payment_exceptions_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      event_payment_reminders: {
        Row: {
          channel: string
          created_at: string
          event_booking_id: string
          id: string
          message_id: string | null
          metadata: Json
          sent_at: string
          stage: string
        }
        Insert: {
          channel: string
          created_at?: string
          event_booking_id: string
          id?: string
          message_id?: string | null
          metadata?: Json
          sent_at?: string
          stage: string
        }
        Update: {
          channel?: string
          created_at?: string
          event_booking_id?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          sent_at?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_payment_reminders_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_reminders_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      event_ticket_transfers: {
        Row: {
          approved_by: string | null
          completed_at: string | null
          created_at: string
          from_event_id: string
          id: string
          metadata: Json
          new_booking_id: string | null
          original_booking_id: string
          requested_by: string
          status: string
          to_event_id: string
        }
        Insert: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          from_event_id: string
          id?: string
          metadata?: Json
          new_booking_id?: string | null
          original_booking_id: string
          requested_by?: string
          status?: string
          to_event_id: string
        }
        Update: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          from_event_id?: string
          id?: string
          metadata?: Json
          new_booking_id?: string | null
          original_booking_id?: string
          requested_by?: string
          status?: string
          to_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_transfers_from_event_id_fkey"
            columns: ["from_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticket_transfers_new_booking_id_fkey"
            columns: ["new_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticket_transfers_new_booking_id_fkey"
            columns: ["new_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_ticket_transfers_original_booking_id_fkey"
            columns: ["original_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticket_transfers_original_booking_id_fkey"
            columns: ["original_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_ticket_transfers_to_event_id_fkey"
            columns: ["to_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_types: {
        Row: {
          base_price: number
          capacity: number | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_price?: number
          capacity?: number | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_price?: number
          capacity?: number | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          accessibility_notes: string | null
          attendance_note: string | null
          booking_cutoff_at: string | null
          booking_mode: string
          booking_open: boolean
          booking_url: string | null
          bookings_enabled: boolean
          brief: string | null
          cancellation_policy: string | null
          capacity: number | null
          category_id: string | null
          created_at: string
          date: string
          doors_time: string | null
          duration_minutes: number | null
          end_time: string | null
          event_status: string | null
          event_type: string | null
          facebook_event_description: string | null
          facebook_event_name: string | null
          gallery_image_urls: Json | null
          gbp_event_description: string | null
          gbp_event_title: string | null
          hero_image_url: string | null
          highlight_video_urls: Json | null
          highlights: Json | null
          id: string
          image_alt_text: string | null
          is_free: boolean | null
          keywords: Json | null
          landscape_image_url: string | null
          last_entry_time: string | null
          local_seo_keywords: Json | null
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          online_discount_type: string | null
          online_discount_value: number | null
          opentable_experience_description: string | null
          opentable_experience_title: string | null
          payment_mode: string
          performer_name: string | null
          performer_type: string | null
          poster_image_url: string | null
          previous_event_summary: string | null
          price: number | null
          price_per_seat: number | null
          primary_keywords: Json | null
          print_poster_url: string | null
          promo_sms_enabled: boolean
          promo_video_url: string | null
          seated_capacity: number | null
          secondary_keywords: Json | null
          short_description: string | null
          slug: string
          social_copy_whatsapp: string | null
          social_image_url: string | null
          standing_capacity: number | null
          start_datetime: string | null
          story_image_url: string | null
          thumbnail_image_url: string | null
          time: string
        }
        Insert: {
          accessibility_notes?: string | null
          attendance_note?: string | null
          booking_cutoff_at?: string | null
          booking_mode?: string
          booking_open?: boolean
          booking_url?: string | null
          bookings_enabled?: boolean
          brief?: string | null
          cancellation_policy?: string | null
          capacity?: number | null
          category_id?: string | null
          created_at?: string
          date: string
          doors_time?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          event_status?: string | null
          event_type?: string | null
          facebook_event_description?: string | null
          facebook_event_name?: string | null
          gallery_image_urls?: Json | null
          gbp_event_description?: string | null
          gbp_event_title?: string | null
          hero_image_url?: string | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          id?: string
          image_alt_text?: string | null
          is_free?: boolean | null
          keywords?: Json | null
          landscape_image_url?: string | null
          last_entry_time?: string | null
          local_seo_keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          online_discount_type?: string | null
          online_discount_value?: number | null
          opentable_experience_description?: string | null
          opentable_experience_title?: string | null
          payment_mode?: string
          performer_name?: string | null
          performer_type?: string | null
          poster_image_url?: string | null
          previous_event_summary?: string | null
          price?: number | null
          price_per_seat?: number | null
          primary_keywords?: Json | null
          print_poster_url?: string | null
          promo_sms_enabled?: boolean
          promo_video_url?: string | null
          seated_capacity?: number | null
          secondary_keywords?: Json | null
          short_description?: string | null
          slug: string
          social_copy_whatsapp?: string | null
          social_image_url?: string | null
          standing_capacity?: number | null
          start_datetime?: string | null
          story_image_url?: string | null
          thumbnail_image_url?: string | null
          time: string
        }
        Update: {
          accessibility_notes?: string | null
          attendance_note?: string | null
          booking_cutoff_at?: string | null
          booking_mode?: string
          booking_open?: boolean
          booking_url?: string | null
          bookings_enabled?: boolean
          brief?: string | null
          cancellation_policy?: string | null
          capacity?: number | null
          category_id?: string | null
          created_at?: string
          date?: string
          doors_time?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          event_status?: string | null
          event_type?: string | null
          facebook_event_description?: string | null
          facebook_event_name?: string | null
          gallery_image_urls?: Json | null
          gbp_event_description?: string | null
          gbp_event_title?: string | null
          hero_image_url?: string | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          id?: string
          image_alt_text?: string | null
          is_free?: boolean | null
          keywords?: Json | null
          landscape_image_url?: string | null
          last_entry_time?: string | null
          local_seo_keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          online_discount_type?: string | null
          online_discount_value?: number | null
          opentable_experience_description?: string | null
          opentable_experience_title?: string | null
          payment_mode?: string
          performer_name?: string | null
          performer_type?: string | null
          poster_image_url?: string | null
          previous_event_summary?: string | null
          price?: number | null
          price_per_seat?: number | null
          primary_keywords?: Json | null
          print_poster_url?: string | null
          promo_sms_enabled?: boolean
          promo_video_url?: string | null
          seated_capacity?: number | null
          secondary_keywords?: Json | null
          short_description?: string | null
          slug?: string
          social_copy_whatsapp?: string | null
          social_image_url?: string | null
          standing_capacity?: number | null
          start_datetime?: string | null
          story_image_url?: string | null
          thumbnail_image_url?: string | null
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "event_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_files: {
        Row: {
          expense_id: string
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          expense_id: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          expense_id?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_files_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          company_ref: string
          created_at: string
          created_by: string | null
          expense_date: string
          id: string
          justification: string
          notes: string | null
          updated_at: string
          vat_amount: number
          vat_applicable: boolean
        }
        Insert: {
          amount: number
          company_ref: string
          created_at?: string
          created_by?: string | null
          expense_date: string
          id?: string
          justification: string
          notes?: string | null
          updated_at?: string
          vat_amount?: number
          vat_applicable?: boolean
        }
        Update: {
          amount?: number
          company_ref?: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          id?: string
          justification?: string
          notes?: string | null
          updated_at?: string
          vat_amount?: number
          vat_applicable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          comments: string | null
          created_at: string
          event_booking_id: string | null
          id: string
          private_booking_id: string | null
          rating_food: number | null
          rating_overall: number | null
          rating_service: number | null
          table_booking_id: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string
          event_booking_id?: string | null
          id?: string
          private_booking_id?: string | null
          rating_food?: number | null
          rating_overall?: number | null
          rating_service?: number | null
          table_booking_id?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string
          event_booking_id?: string | null
          id?: string
          private_booking_id?: string | null
          rating_food?: number | null
          rating_overall?: number | null
          rating_service?: number | null
          table_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "feedback_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "feedback_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      greene_king_pnl_benchmark_rows: {
        Row: {
          annual_amount: number | null
          benchmark_id: string
          created_at: string
          gross_profit: number | null
          gross_profit_percent: number | null
          id: string
          label: string
          metadata: Json
          metric_key: string
          percent_of_sales: number | null
          row_order: number
          sales_mix_percent: number | null
          section: string
          updated_at: string
        }
        Insert: {
          annual_amount?: number | null
          benchmark_id: string
          created_at?: string
          gross_profit?: number | null
          gross_profit_percent?: number | null
          id?: string
          label: string
          metadata?: Json
          metric_key: string
          percent_of_sales?: number | null
          row_order?: number
          sales_mix_percent?: number | null
          section: string
          updated_at?: string
        }
        Update: {
          annual_amount?: number | null
          benchmark_id?: string
          created_at?: string
          gross_profit?: number | null
          gross_profit_percent?: number | null
          id?: string
          label?: string
          metadata?: Json
          metric_key?: string
          percent_of_sales?: number | null
          row_order?: number
          sales_mix_percent?: number | null
          section?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "greene_king_pnl_benchmark_rows_benchmark_id_fkey"
            columns: ["benchmark_id"]
            isOneToOne: false
            referencedRelation: "greene_king_pnl_benchmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      greene_king_pnl_benchmarks: {
        Row: {
          agreement_reason: string | null
          agreement_type: string | null
          assessment_date: string
          benchmark_key: string
          created_at: string
          id: string
          is_active: boolean
          proposal_id: string | null
          pub_code: string
          pub_name: string
          report_date: string
          tie_details: string | null
          updated_at: string
        }
        Insert: {
          agreement_reason?: string | null
          agreement_type?: string | null
          assessment_date: string
          benchmark_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          proposal_id?: string | null
          pub_code: string
          pub_name: string
          report_date: string
          tie_details?: string | null
          updated_at?: string
        }
        Update: {
          agreement_reason?: string | null
          agreement_type?: string | null
          assessment_date?: string
          benchmark_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          proposal_id?: string | null
          pub_code?: string
          pub_name?: string
          report_date?: string
          tie_details?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      guest_tokens: {
        Row: {
          action_type: string
          charge_request_id: string | null
          consumed_at: string | null
          created_at: string
          customer_id: string
          event_booking_id: string | null
          expires_at: string
          hashed_token: string
          id: string
          private_booking_id: string | null
          table_booking_id: string | null
          waitlist_offer_id: string | null
        }
        Insert: {
          action_type: string
          charge_request_id?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id: string
          event_booking_id?: string | null
          expires_at: string
          hashed_token: string
          id?: string
          private_booking_id?: string | null
          table_booking_id?: string | null
          waitlist_offer_id?: string | null
        }
        Update: {
          action_type?: string
          charge_request_id?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id?: string
          event_booking_id?: string | null
          expires_at?: string
          hashed_token?: string
          id?: string
          private_booking_id?: string | null
          table_booking_id?: string | null
          waitlist_offer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_tokens_charge_request_id_fkey"
            columns: ["charge_request_id"]
            isOneToOne: false
            referencedRelation: "charge_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "guest_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "guest_tokens_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "guest_tokens_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tokens_waitlist_offer_id_fkey"
            columns: ["waitlist_offer_id"]
            isOneToOne: false
            referencedRelation: "waitlist_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          key: string
          request_hash: string
          response: Json
        }
        Insert: {
          created_at?: string
          expires_at?: string
          key: string
          request_hash: string
          response: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          key?: string
          request_hash?: string
          response?: Json
        }
        Relationships: []
      }
      invoice_audit: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          invoice_id: string | null
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          performed_by: string | null
          performed_by_email: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          invoice_id?: string | null
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
          performed_by_email?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          invoice_id?: string | null
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
          performed_by_email?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_audit_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_email_logs: {
        Row: {
          body: string | null
          created_at: string | null
          error_message: string | null
          id: string
          invoice_id: string | null
          message_id: string | null
          payment_id: string | null
          quote_id: string | null
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          payment_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          payment_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_email_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_email_logs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_email_logs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_email_templates: {
        Row: {
          body_template: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          subject_template: string
          template_type: string
          updated_at: string | null
        }
        Insert: {
          body_template: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          subject_template: string
          template_type: string
          updated_at?: string | null
        }
        Update: {
          body_template?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          subject_template?: string
          template_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      invoice_emails: {
        Row: {
          attachments: Json | null
          bcc_emails: string[] | null
          body: string
          cc_emails: string[] | null
          created_at: string | null
          created_by: string | null
          email_type: string
          error_message: string | null
          id: string
          invoice_id: string | null
          message_id: string | null
          recipient_email: string
          sent_at: string | null
          status: string | null
          subject: string
        }
        Insert: {
          attachments?: Json | null
          bcc_emails?: string[] | null
          body: string
          cc_emails?: string[] | null
          created_at?: string | null
          created_by?: string | null
          email_type: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          recipient_email: string
          sent_at?: string | null
          status?: string | null
          subject: string
        }
        Update: {
          attachments?: Json | null
          bcc_emails?: string[] | null
          body?: string
          cc_emails?: string[] | null
          created_at?: string | null
          created_by?: string | null
          email_type?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          status?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_emails_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          description: string
          discount_amount: number | null
          discount_percentage: number | null
          id: string
          invoice_id: string
          quantity: number | null
          subtotal_amount: number | null
          total_amount: number | null
          unit_price: number | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          description: string
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          invoice_id: string
          quantity?: number | null
          subtotal_amount?: number | null
          total_amount?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          description?: string
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          invoice_id?: string
          quantity?: number | null
          subtotal_amount?: number | null
          total_amount?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "line_item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_reminder_settings: {
        Row: {
          created_at: string | null
          days_after_due: number[] | null
          days_before_due: number[] | null
          enabled: boolean | null
          exclude_vendors: string[] | null
          id: string
          reminder_email: string | null
          reminder_time: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          days_after_due?: number[] | null
          days_before_due?: number[] | null
          enabled?: boolean | null
          exclude_vendors?: string[] | null
          id?: string
          reminder_email?: string | null
          reminder_time?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          days_after_due?: number[] | null
          days_before_due?: number[] | null
          enabled?: boolean | null
          exclude_vendors?: string[] | null
          id?: string
          reminder_email?: string | null
          reminder_time?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invoice_series: {
        Row: {
          created_at: string | null
          current_sequence: number | null
          series_code: string
        }
        Insert: {
          created_at?: string | null
          current_sequence?: number | null
          series_code: string
        }
        Update: {
          created_at?: string | null
          current_sequence?: number | null
          series_code?: string
        }
        Relationships: []
      }
      invoice_vendor_contacts: {
        Row: {
          created_at: string
          email: string
          id: string
          is_primary: boolean
          name: string | null
          phone: string | null
          receive_invoice_copy: boolean
          role: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_primary?: boolean
          name?: string | null
          phone?: string | null
          receive_invoice_copy?: boolean
          role?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_primary?: boolean
          name?: string | null
          phone?: string | null
          receive_invoice_copy?: boolean
          role?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_vendors: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          payment_terms: number | null
          phone: string | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          payment_terms?: number | null
          phone?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          payment_terms?: number | null
          phone?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number | null
          due_date: string
          id: string
          internal_notes: string | null
          invoice_date: string
          invoice_discount_percentage: number | null
          invoice_number: string
          notes: string | null
          paid_amount: number | null
          reference: string | null
          status: string | null
          subtotal_amount: number | null
          total_amount: number | null
          updated_at: string | null
          vat_amount: number | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number | null
          due_date: string
          id?: string
          internal_notes?: string | null
          invoice_date?: string
          invoice_discount_percentage?: number | null
          invoice_number: string
          notes?: string | null
          paid_amount?: number | null
          reference?: string | null
          status?: string | null
          subtotal_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number | null
          due_date?: string
          id?: string
          internal_notes?: string | null
          invoice_date?: string
          invoice_discount_percentage?: number | null
          invoice_number?: string
          notes?: string | null
          paid_amount?: number | null
          reference?: string | null
          status?: string | null
          subtotal_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error: string | null
          id: string
          payload: Json | null
          result: Json | null
          started_at: string | null
          status: string
          type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          payload?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          payload?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          last_heartbeat_at: string | null
          lease_expires_at: string | null
          max_attempts: number | null
          payload: Json
          priority: number | null
          processing_token: string | null
          result: Json | null
          scheduled_for: string | null
          started_at: string | null
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number | null
          payload?: Json
          priority?: number | null
          processing_token?: string | null
          result?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number | null
          payload?: Json
          priority?: number | null
          processing_token?: string | null
          result?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      leave_days: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          leave_date: string
          request_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          leave_date: string
          request_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          leave_date?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_days_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_days_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          end_date: string
          holiday_year: number
          id: string
          manager_note: string | null
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_date: string
          holiday_year: number
          id?: string
          manager_note?: string | null
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_date?: string
          holiday_year?: number
          id?: string
          manager_note?: string | null
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      line_item_catalog: {
        Row: {
          created_at: string | null
          default_price: number | null
          default_vat_rate: number | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_price?: number | null
          default_vat_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_price?: number | null
          default_vat_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_achievements: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          criteria: Json
          description: string | null
          icon: string | null
          id: string
          name: string
          points_value: number | null
          program_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          criteria: Json
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          points_value?: number | null
          program_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          criteria?: Json
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          points_value?: number | null
          program_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_achievements_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_campaigns: {
        Row: {
          active: boolean | null
          bonus_type: string
          bonus_value: number
          created_at: string | null
          criteria: Json | null
          description: string | null
          end_date: string
          id: string
          name: string
          program_id: string | null
          start_date: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          bonus_type: string
          bonus_value: number
          created_at?: string | null
          criteria?: Json | null
          description?: string | null
          end_date: string
          id?: string
          name: string
          program_id?: string | null
          start_date: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          bonus_type?: string
          bonus_value?: number
          created_at?: string | null
          criteria?: Json | null
          description?: string | null
          end_date?: string
          id?: string
          name?: string
          program_id?: string | null
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_campaigns_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_challenges: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          criteria: Json
          description: string | null
          end_date: string
          icon: string | null
          id: string
          max_completions: number | null
          name: string
          points_value: number | null
          program_id: string | null
          sort_order: number | null
          start_date: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          criteria: Json
          description?: string | null
          end_date: string
          icon?: string | null
          id?: string
          max_completions?: number | null
          name: string
          points_value?: number | null
          program_id?: string | null
          sort_order?: number | null
          start_date: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          criteria?: Json
          description?: string | null
          end_date?: string
          icon?: string | null
          id?: string
          max_completions?: number | null
          name?: string
          points_value?: number | null
          program_id?: string | null
          sort_order?: number | null
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_challenges_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_members: {
        Row: {
          access_token: string | null
          available_points: number | null
          created_at: string | null
          customer_id: string | null
          id: string
          join_date: string | null
          last_visit_date: string | null
          lifetime_events: number | null
          lifetime_points: number | null
          metadata: Json | null
          program_id: string | null
          status: string | null
          tier_id: string | null
          total_points: number | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          available_points?: number | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          join_date?: string | null
          last_visit_date?: string | null
          lifetime_events?: number | null
          lifetime_points?: number | null
          metadata?: Json | null
          program_id?: string | null
          status?: string | null
          tier_id?: string | null
          total_points?: number | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          available_points?: number | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          join_date?: string | null
          last_visit_date?: string | null
          lifetime_events?: number | null
          lifetime_points?: number | null
          metadata?: Json | null
          program_id?: string | null
          status?: string | null
          tier_id?: string | null
          total_points?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "loyalty_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_members_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_point_transactions: {
        Row: {
          balance_after: number
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          member_id: string | null
          points: number
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
        }
        Insert: {
          balance_after: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          member_id?: string | null
          points: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
        }
        Update: {
          balance_after?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          member_id?: string | null
          points?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_point_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_point_transactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_programs: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          name: string
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_rewards: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          daily_limit: number | null
          description: string | null
          icon: string | null
          id: string
          inventory: number | null
          metadata: Json | null
          name: string
          points_cost: number
          program_id: string | null
          tier_required: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          daily_limit?: number | null
          description?: string | null
          icon?: string | null
          id?: string
          inventory?: number | null
          metadata?: Json | null
          name: string
          points_cost: number
          program_id?: string | null
          tier_required?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          daily_limit?: number | null
          description?: string | null
          icon?: string | null
          id?: string
          inventory?: number | null
          metadata?: Json | null
          name?: string
          points_cost?: number
          program_id?: string | null
          tier_required?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_tier_required_fkey"
            columns: ["tier_required"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tiers: {
        Row: {
          benefits: Json | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          level: number
          min_events: number | null
          name: string
          point_multiplier: number | null
          program_id: string | null
          updated_at: string | null
        }
        Insert: {
          benefits?: Json | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          level: number
          min_events?: number | null
          name: string
          point_multiplier?: number | null
          program_id?: string | null
          updated_at?: string | null
        }
        Update: {
          benefits?: Json | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          level?: number
          min_events?: number | null
          name?: string
          point_multiplier?: number | null
          program_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_tiers_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "loyalty_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaign_recipients: {
        Row: {
          attempt_count: number
          campaign_id: string
          claimed_at: string | null
          contact_id: string | null
          created_at: string
          customer_id: string | null
          email: string
          email_message_id: string | null
          error: string | null
          failure_class: string | null
          id: string
          last_attempt_at: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string | null
          provider_message_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          campaign_id: string
          claimed_at?: string | null
          contact_id?: string | null
          created_at?: string
          customer_id?: string | null
          email: string
          email_message_id?: string | null
          error?: string | null
          failure_class?: string | null
          id?: string
          last_attempt_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          campaign_id?: string
          claimed_at?: string | null
          contact_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string
          email_message_id?: string | null
          error?: string | null
          failure_class?: string | null
          id?: string
          last_attempt_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaign_recipients_email_message_id_fkey"
            columns: ["email_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          approved_recipient_count: number | null
          audience: Json
          audience_type: string
          audience_version: number
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          content: Json
          content_hash: string | null
          content_schema_version: number
          created_at: string
          created_by: string | null
          id: string
          link_map: Json
          locked_at: string | null
          name: string
          paused_at: string | null
          paused_by: string | null
          preheader: string
          renderer_version: string
          scheduled_by: string | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          subject: string
          updated_at: string
          utm_campaign: string | null
        }
        Insert: {
          approved_recipient_count?: number | null
          audience?: Json
          audience_type?: string
          audience_version?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          content: Json
          content_hash?: string | null
          content_schema_version?: number
          created_at?: string
          created_by?: string | null
          id?: string
          link_map?: Json
          locked_at?: string | null
          name: string
          paused_at?: string | null
          paused_by?: string | null
          preheader: string
          renderer_version?: string
          scheduled_by?: string | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          utm_campaign?: string | null
        }
        Update: {
          approved_recipient_count?: number | null
          audience?: Json
          audience_type?: string
          audience_version?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          content?: Json
          content_hash?: string | null
          content_schema_version?: number
          created_at?: string
          created_by?: string | null
          id?: string
          link_map?: Json
          locked_at?: string | null
          name?: string
          paused_at?: string | null
          paused_by?: string | null
          preheader?: string
          renderer_version?: string
          scheduled_by?: string | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          utm_campaign?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_scheduled_by_fkey"
            columns: ["scheduled_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_conversions: {
        Row: {
          business_contact_id: string | null
          campaign_id: string | null
          company_name: string | null
          conversion_type: string
          created_at: string
          id: string
          landing_path: string | null
          metadata: Json
          occurred_at: string
          party_size: number | null
          recipient_id: string | null
          short_code: string | null
          source_url: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          business_contact_id?: string | null
          campaign_id?: string | null
          company_name?: string | null
          conversion_type: string
          created_at?: string
          id?: string
          landing_path?: string | null
          metadata?: Json
          occurred_at?: string
          party_size?: number | null
          recipient_id?: string | null
          short_code?: string | null
          source_url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          business_contact_id?: string | null
          campaign_id?: string | null
          company_name?: string | null
          conversion_type?: string
          created_at?: string
          id?: string
          landing_path?: string | null
          metadata?: Json
          occurred_at?: string
          party_size?: number | null
          recipient_id?: string | null
          short_code?: string | null
          source_url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_conversions_business_contact_id_fkey"
            columns: ["business_contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_conversions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_conversions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaign_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_do_not_contact: {
        Row: {
          campaign_id: string | null
          created_at: string
          created_by: string | null
          email_hash: string
          email_normalised: string
          reason: string
          removal_note: string | null
          removed_at: string | null
          removed_by: string | null
          source: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          email_hash: string
          email_normalised: string
          reason: string
          removal_note?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          email_hash?: string
          email_normalised?: string
          reason?: string
          removal_note?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source?: string | null
        }
        Relationships: []
      }
      marketing_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          filename: string | null
          id: string
          imported_count: number
          row_count: number
          skipped_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          skipped_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          skipped_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketing_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_import_rows: {
        Row: {
          batch_id: string
          contact_id: string | null
          created_at: string
          decision: string
          email: string | null
          id: string
          reason: string | null
          row_number: number
        }
        Insert: {
          batch_id: string
          contact_id?: string | null
          created_at?: string
          decision: string
          email?: string | null
          id?: string
          reason?: string | null
          row_number: number
        }
        Update: {
          batch_id?: string
          contact_id?: string | null
          created_at?: string
          decision?: string
          email?: string | null
          id?: string
          reason?: string | null
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketing_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "marketing_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_import_rows_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_settings: {
        Row: {
          batch_size: number
          customer_send_days: number[]
          frequency_cap_days: number
          id: boolean
          send_days: number[]
          send_window_end_hour: number
          send_window_start_hour: number
          sends_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          batch_size?: number
          customer_send_days?: number[]
          frequency_cap_days?: number
          id?: boolean
          send_days?: number[]
          send_window_end_hour?: number
          send_window_start_hour?: number
          sends_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          batch_size?: number
          customer_send_days?: number[]
          frequency_cap_days?: number
          id?: boolean
          send_days?: number[]
          send_window_end_hour?: number
          send_window_start_hour?: number
          sends_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      menu_category_menus: {
        Row: {
          category_id: string
          id: string
          menu_id: string
          sort_order: number
        }
        Insert: {
          category_id: string
          id?: string
          menu_id: string
          sort_order?: number
        }
        Update: {
          category_id?: string
          id?: string
          menu_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_category_menus_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_category_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menu_menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dish_ingredients: {
        Row: {
          cost_override: number | null
          created_at: string
          dish_id: string
          id: string
          inclusion_type: string
          ingredient_id: string
          measure_ml: number | null
          notes: string | null
          option_group: string | null
          quantity: number
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at: string
          upgrade_price: number | null
          wastage_pct: number
          yield_pct: number
        }
        Insert: {
          cost_override?: number | null
          created_at?: string
          dish_id: string
          id?: string
          inclusion_type?: string
          ingredient_id: string
          measure_ml?: number | null
          notes?: string | null
          option_group?: string | null
          quantity?: number
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
          upgrade_price?: number | null
          wastage_pct?: number
          yield_pct?: number
        }
        Update: {
          cost_override?: number | null
          created_at?: string
          dish_id?: string
          id?: string
          inclusion_type?: string
          ingredient_id?: string
          measure_ml?: number | null
          notes?: string | null
          option_group?: string | null
          quantity?: number
          unit?: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
          upgrade_price?: number | null
          wastage_pct?: number
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_dish_ingredients_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_ingredients_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes_with_costs"
            referencedColumns: ["dish_id"]
          },
          {
            foreignKeyName: "menu_dish_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients_with_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dish_menu_assignments: {
        Row: {
          available_from: string | null
          available_until: string | null
          category_id: string
          created_at: string
          dish_id: string
          id: string
          is_default_side: boolean
          is_special: boolean
          menu_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          available_from?: string | null
          available_until?: string | null
          category_id: string
          created_at?: string
          dish_id: string
          id?: string
          is_default_side?: boolean
          is_special?: boolean
          menu_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          available_from?: string | null
          available_until?: string | null
          category_id?: string
          created_at?: string
          dish_id?: string
          id?: string
          is_default_side?: boolean
          is_special?: boolean
          menu_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_dish_menu_assignments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_menu_assignments_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_menu_assignments_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes_with_costs"
            referencedColumns: ["dish_id"]
          },
          {
            foreignKeyName: "menu_dish_menu_assignments_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menu_menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dish_recipes: {
        Row: {
          cost_override: number | null
          created_at: string
          dish_id: string
          id: string
          inclusion_type: string
          notes: string | null
          option_group: string | null
          quantity: number
          recipe_id: string
          updated_at: string
          upgrade_price: number | null
          wastage_pct: number
          yield_pct: number
        }
        Insert: {
          cost_override?: number | null
          created_at?: string
          dish_id: string
          id?: string
          inclusion_type?: string
          notes?: string | null
          option_group?: string | null
          quantity?: number
          recipe_id: string
          updated_at?: string
          upgrade_price?: number | null
          wastage_pct?: number
          yield_pct?: number
        }
        Update: {
          cost_override?: number | null
          created_at?: string
          dish_id?: string
          id?: string
          inclusion_type?: string
          notes?: string | null
          option_group?: string | null
          quantity?: number
          recipe_id?: string
          updated_at?: string
          upgrade_price?: number | null
          wastage_pct?: number
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_dish_recipes_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_recipes_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes_with_costs"
            referencedColumns: ["dish_id"]
          },
          {
            foreignKeyName: "menu_dish_recipes_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "menu_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dishes: {
        Row: {
          allergen_flags: string[]
          allergen_verified: boolean | null
          allergen_verified_at: string | null
          calories: number | null
          created_at: string
          description: string | null
          dietary_flags: string[]
          gp_pct: number | null
          id: string
          image_url: string | null
          is_active: boolean
          is_gp_alert: boolean
          is_modifiable_for: Json | null
          is_sunday_lunch: boolean
          name: string
          new_from: string | null
          new_until: string | null
          notes: string | null
          portion_cost: number
          removable_allergens: string[] | null
          selling_price: number
          slug: string | null
          target_gp_pct: number
          updated_at: string
        }
        Insert: {
          allergen_flags?: string[]
          allergen_verified?: boolean | null
          allergen_verified_at?: string | null
          calories?: number | null
          created_at?: string
          description?: string | null
          dietary_flags?: string[]
          gp_pct?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_gp_alert?: boolean
          is_modifiable_for?: Json | null
          is_sunday_lunch?: boolean
          name: string
          new_from?: string | null
          new_until?: string | null
          notes?: string | null
          portion_cost?: number
          removable_allergens?: string[] | null
          selling_price?: number
          slug?: string | null
          target_gp_pct?: number
          updated_at?: string
        }
        Update: {
          allergen_flags?: string[]
          allergen_verified?: boolean | null
          allergen_verified_at?: string | null
          calories?: number | null
          created_at?: string
          description?: string | null
          dietary_flags?: string[]
          gp_pct?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_gp_alert?: boolean
          is_modifiable_for?: Json | null
          is_sunday_lunch?: boolean
          name?: string
          new_from?: string | null
          new_until?: string | null
          notes?: string | null
          portion_cost?: number
          removable_allergens?: string[] | null
          selling_price?: number
          slug?: string | null
          target_gp_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      menu_ingredient_prices: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          ingredient_id: string
          notes: string | null
          pack_cost: number
          supplier_name: string | null
          supplier_sku: string | null
        }
        Insert: {
          created_at?: string
          effective_from?: string
          id?: string
          ingredient_id: string
          notes?: string | null
          pack_cost: number
          supplier_name?: string | null
          supplier_sku?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          ingredient_id?: string
          notes?: string | null
          pack_cost?: number
          supplier_name?: string | null
          supplier_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_ingredient_prices_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_ingredient_prices_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients_with_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_ingredients: {
        Row: {
          abv: number | null
          allergens: string[]
          brand: string | null
          created_at: string
          default_unit: Database["public"]["Enums"]["menu_unit"]
          description: string | null
          dietary_flags: string[]
          id: string
          is_active: boolean
          name: string
          notes: string | null
          pack_cost: number
          pack_size: number | null
          pack_size_unit: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack: number | null
          purchase_department: string
          shelf_life_days: number | null
          storage_type: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name: string | null
          supplier_sku: string | null
          updated_at: string
          wastage_pct: number
        }
        Insert: {
          abv?: number | null
          allergens?: string[]
          brand?: string | null
          created_at?: string
          default_unit?: Database["public"]["Enums"]["menu_unit"]
          description?: string | null
          dietary_flags?: string[]
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          pack_cost?: number
          pack_size?: number | null
          pack_size_unit?: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack?: number | null
          purchase_department?: string
          shelf_life_days?: number | null
          storage_type?: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
          wastage_pct?: number
        }
        Update: {
          abv?: number | null
          allergens?: string[]
          brand?: string | null
          created_at?: string
          default_unit?: Database["public"]["Enums"]["menu_unit"]
          description?: string | null
          dietary_flags?: string[]
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          pack_cost?: number
          pack_size?: number | null
          pack_size_unit?: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack?: number | null
          purchase_department?: string
          shelf_life_days?: number | null
          storage_type?: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
          wastage_pct?: number
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          allergens: Json | null
          available_from: string | null
          available_until: string | null
          calories: number | null
          created_at: string | null
          description: string | null
          dietary_info: Json | null
          id: string
          image_url: string | null
          is_available: boolean | null
          is_special: boolean | null
          name: string
          price: number
          section_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          allergens?: Json | null
          available_from?: string | null
          available_until?: string | null
          calories?: number | null
          created_at?: string | null
          description?: string | null
          dietary_info?: Json | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_special?: boolean | null
          name: string
          price: number
          section_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          allergens?: Json | null
          available_from?: string | null
          available_until?: string | null
          calories?: number | null
          created_at?: string | null
          description?: string | null
          dietary_info?: Json | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_special?: boolean | null
          name?: string
          price?: number
          section_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "menu_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_menus: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_recipe_ingredients: {
        Row: {
          cost_override: number | null
          created_at: string
          id: string
          ingredient_id: string
          notes: string | null
          quantity: number
          recipe_id: string
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at: string
          wastage_pct: number
          yield_pct: number
        }
        Insert: {
          cost_override?: number | null
          created_at?: string
          id?: string
          ingredient_id: string
          notes?: string | null
          quantity?: number
          recipe_id: string
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
          wastage_pct?: number
          yield_pct?: number
        }
        Update: {
          cost_override?: number | null
          created_at?: string
          id?: string
          ingredient_id?: string
          notes?: string | null
          quantity?: number
          recipe_id?: string
          unit?: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
          wastage_pct?: number
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "menu_ingredients_with_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "menu_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_recipes: {
        Row: {
          allergen_flags: string[]
          created_at: string
          description: string | null
          dietary_flags: string[]
          id: string
          instructions: string | null
          is_active: boolean
          name: string
          notes: string | null
          portion_cost: number
          updated_at: string
          yield_quantity: number
          yield_unit: Database["public"]["Enums"]["menu_unit"]
        }
        Insert: {
          allergen_flags?: string[]
          created_at?: string
          description?: string | null
          dietary_flags?: string[]
          id?: string
          instructions?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          portion_cost?: number
          updated_at?: string
          yield_quantity?: number
          yield_unit?: Database["public"]["Enums"]["menu_unit"]
        }
        Update: {
          allergen_flags?: string[]
          created_at?: string
          description?: string | null
          dietary_flags?: string[]
          id?: string
          instructions?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          portion_cost?: number
          updated_at?: string
          yield_quantity?: number
          yield_unit?: Database["public"]["Enums"]["menu_unit"]
        }
        Relationships: []
      }
      menu_sections: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      message_delivery_status: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          message_id: string
          note: string | null
          raw_webhook_data: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_id: string
          note?: string | null
          raw_webhook_data?: Json | null
          status: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_id?: string
          note?: string | null
          raw_webhook_data?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_delivery_status_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_template_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          content: string
          created_at: string
          id: string
          template_id: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          content: string
          created_at?: string
          id?: string
          template_id?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          content?: string
          created_at?: string
          id?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_template_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_template_history_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_template_history_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates_with_timing"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          character_count: number | null
          content: string
          created_at: string
          created_by: string | null
          custom_timing_hours: number | null
          description: string | null
          estimated_segments: number | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          send_timing: string
          template_type: string
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          character_count?: number | null
          content: string
          created_at?: string
          created_by?: string | null
          custom_timing_hours?: number | null
          description?: string | null
          estimated_segments?: number | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          send_timing?: string
          template_type: string
          updated_at?: string
          variables?: string[] | null
        }
        Update: {
          character_count?: number | null
          content?: string
          created_at?: string
          created_by?: string | null
          custom_timing_hours?: number | null
          description?: string | null
          estimated_segments?: number | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          send_timing?: string
          template_type?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          body: string
          cost_usd: number | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_message: string | null
          event_booking_id: string | null
          failed_at: string | null
          from_number: string | null
          has_attachments: boolean
          id: string
          message_sid: string
          message_type: string | null
          metadata: Json | null
          price: number | null
          price_unit: string | null
          private_booking_id: string | null
          read_at: string | null
          segments: number | null
          sent_at: string | null
          status: string
          table_booking_id: string | null
          template_key: string | null
          to_number: string | null
          twilio_message_sid: string | null
          twilio_status: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json | null
          body: string
          cost_usd?: number | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_message?: string | null
          event_booking_id?: string | null
          failed_at?: string | null
          from_number?: string | null
          has_attachments?: boolean
          id?: string
          message_sid: string
          message_type?: string | null
          metadata?: Json | null
          price?: number | null
          price_unit?: string | null
          private_booking_id?: string | null
          read_at?: string | null
          segments?: number | null
          sent_at?: string | null
          status: string
          table_booking_id?: string | null
          template_key?: string | null
          to_number?: string | null
          twilio_message_sid?: string | null
          twilio_status?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json | null
          body?: string
          cost_usd?: number | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_message?: string | null
          event_booking_id?: string | null
          failed_at?: string | null
          from_number?: string | null
          has_attachments?: boolean
          id?: string
          message_sid?: string
          message_type?: string | null
          metadata?: Json | null
          price?: number | null
          price_unit?: string | null
          private_booking_id?: string | null
          read_at?: string | null
          segments?: number | null
          sent_at?: string | null
          status?: string
          table_booking_id?: string | null
          template_key?: string | null
          to_number?: string | null
          twilio_message_sid?: string | null
          twilio_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_private_booking_id_fkey"
            columns: ["private_booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      mgd_collections: {
        Row: {
          collection_date: string
          created_at: string
          created_by: string | null
          id: string
          mgd_amount: number | null
          net_take: number
          notes: string | null
          updated_at: string
          vat_on_supplier: number
        }
        Insert: {
          collection_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          mgd_amount?: number | null
          net_take: number
          notes?: string | null
          updated_at?: string
          vat_on_supplier: number
        }
        Update: {
          collection_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mgd_amount?: number | null
          net_take?: number
          notes?: string | null
          updated_at?: string
          vat_on_supplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "mgd_collections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      mgd_returns: {
        Row: {
          created_at: string
          date_paid: string | null
          id: string
          machine_count: number
          period_end: string
          period_start: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_mgd: number
          total_net_take: number
          total_vat_on_supplier: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_paid?: string | null
          id?: string
          machine_count?: number
          period_end: string
          period_start: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_mgd?: number
          total_net_take?: number
          total_vat_on_supplier?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_paid?: string | null
          id?: string
          machine_count?: number
          period_end?: string
          period_start?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_mgd?: number
          total_net_take?: number
          total_vat_on_supplier?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mgd_returns_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_destination_distances: {
        Row: {
          from_destination_id: string
          id: string
          last_used_at: string
          miles: number
          to_destination_id: string
        }
        Insert: {
          from_destination_id: string
          id?: string
          last_used_at?: string
          miles: number
          to_destination_id: string
        }
        Update: {
          from_destination_id?: string
          id?: string
          last_used_at?: string
          miles?: number
          to_destination_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_destination_distances_from_destination_id_fkey"
            columns: ["from_destination_id"]
            isOneToOne: false
            referencedRelation: "mileage_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_destination_distances_to_destination_id_fkey"
            columns: ["to_destination_id"]
            isOneToOne: false
            referencedRelation: "mileage_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_destinations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_home_base: boolean
          name: string
          postcode: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_home_base?: boolean
          name: string
          postcode?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_home_base?: boolean
          name?: string
          postcode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_destinations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_trip_legs: {
        Row: {
          from_destination_id: string
          id: string
          leg_order: number
          miles: number
          to_destination_id: string
          trip_id: string
        }
        Insert: {
          from_destination_id: string
          id?: string
          leg_order: number
          miles: number
          to_destination_id: string
          trip_id: string
        }
        Update: {
          from_destination_id?: string
          id?: string
          leg_order?: number
          miles?: number
          to_destination_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_trip_legs_from_destination_id_fkey"
            columns: ["from_destination_id"]
            isOneToOne: false
            referencedRelation: "mileage_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_trip_legs_to_destination_id_fkey"
            columns: ["to_destination_id"]
            isOneToOne: false
            referencedRelation: "mileage_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_trip_legs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "mileage_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_trips: {
        Row: {
          amount_due: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          miles_at_reduced_rate: number
          miles_at_standard_rate: number
          oj_entry_id: string | null
          source: string
          total_miles: number
          trip_date: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          miles_at_reduced_rate?: number
          miles_at_standard_rate?: number
          oj_entry_id?: string | null
          source: string
          total_miles: number
          trip_date: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          miles_at_reduced_rate?: number
          miles_at_standard_rate?: number
          oj_entry_id?: string | null
          source?: string
          total_miles?: number
          trip_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_trips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_trips_oj_entry_id_fkey"
            columns: ["oj_entry_id"]
            isOneToOne: true
            referencedRelation: "oj_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_attempts: {
        Row: {
          attempt_order: number
          attempted_at: string
          channel: string
          delivery_id: string
          error: string | null
          id: string
          idempotency_key: string | null
          provider_message_id: string | null
          raw_payload: Json
          resend_message_id: string | null
          status: string
          terminal_at: string | null
          twilio_message_sid: string | null
        }
        Insert: {
          attempt_order: number
          attempted_at?: string
          channel: string
          delivery_id: string
          error?: string | null
          id?: string
          idempotency_key?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          resend_message_id?: string | null
          status: string
          terminal_at?: string | null
          twilio_message_sid?: string | null
        }
        Update: {
          attempt_order?: number
          attempted_at?: string
          channel?: string
          delivery_id?: string
          error?: string | null
          id?: string
          idempotency_key?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          resend_message_id?: string | null
          status?: string
          terminal_at?: string | null
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          category: string
          created_at: string
          customer_id: string | null
          delayed_fallback_allowed: boolean
          delayed_fallback_sent_at: string | null
          final_status: string
          id: string
          metadata: Json
          policy: string
          selected_channel: string | null
          template_key: string
          updated_at: string
          urgency: string
        }
        Insert: {
          category?: string
          created_at?: string
          customer_id?: string | null
          delayed_fallback_allowed?: boolean
          delayed_fallback_sent_at?: string | null
          final_status?: string
          id?: string
          metadata?: Json
          policy: string
          selected_channel?: string | null
          template_key: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          category?: string
          created_at?: string
          customer_id?: string | null
          delayed_fallback_allowed?: boolean
          delayed_fallback_sent_at?: string | null
          final_status?: string
          id?: string
          metadata?: Json
          policy?: string
          selected_channel?: string | null
          template_key?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "notification_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_billing_runs: {
        Row: {
          carried_forward_inc_vat: number | null
          created_at: string
          error_message: string | null
          id: string
          invoice_id: string | null
          period_end: string
          period_start: string
          period_yyyymm: string
          run_finished_at: string | null
          run_started_at: string
          selected_entry_ids: Json | null
          status: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          carried_forward_inc_vat?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          period_end: string
          period_start: string
          period_yyyymm: string
          run_finished_at?: string | null
          run_started_at?: string
          selected_entry_ids?: Json | null
          status: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          carried_forward_inc_vat?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          period_end?: string
          period_start?: string
          period_yyyymm?: string
          run_finished_at?: string | null
          run_started_at?: string
          selected_entry_ids?: Json | null
          status?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_billing_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_billing_runs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_entries: {
        Row: {
          amount_ex_vat_snapshot: number | null
          billable: boolean
          billed_at: string | null
          billing_run_id: string | null
          created_at: string
          description: string | null
          duration_minutes_raw: number | null
          duration_minutes_rounded: number | null
          end_at: string | null
          entry_date: string
          entry_type: string
          hourly_rate_ex_vat_snapshot: number | null
          id: string
          internal_notes: string | null
          invoice_id: string | null
          mileage_rate_snapshot: number | null
          miles: number | null
          paid_at: string | null
          project_id: string
          start_at: string | null
          status: string
          updated_at: string
          vat_rate_snapshot: number | null
          vendor_id: string
          work_type_id: string | null
          work_type_name_snapshot: string | null
        }
        Insert: {
          amount_ex_vat_snapshot?: number | null
          billable?: boolean
          billed_at?: string | null
          billing_run_id?: string | null
          created_at?: string
          description?: string | null
          duration_minutes_raw?: number | null
          duration_minutes_rounded?: number | null
          end_at?: string | null
          entry_date: string
          entry_type: string
          hourly_rate_ex_vat_snapshot?: number | null
          id?: string
          internal_notes?: string | null
          invoice_id?: string | null
          mileage_rate_snapshot?: number | null
          miles?: number | null
          paid_at?: string | null
          project_id: string
          start_at?: string | null
          status?: string
          updated_at?: string
          vat_rate_snapshot?: number | null
          vendor_id: string
          work_type_id?: string | null
          work_type_name_snapshot?: string | null
        }
        Update: {
          amount_ex_vat_snapshot?: number | null
          billable?: boolean
          billed_at?: string | null
          billing_run_id?: string | null
          created_at?: string
          description?: string | null
          duration_minutes_raw?: number | null
          duration_minutes_rounded?: number | null
          end_at?: string | null
          entry_date?: string
          entry_type?: string
          hourly_rate_ex_vat_snapshot?: number | null
          id?: string
          internal_notes?: string | null
          invoice_id?: string | null
          mileage_rate_snapshot?: number | null
          miles?: number | null
          paid_at?: string | null
          project_id?: string
          start_at?: string | null
          status?: string
          updated_at?: string
          vat_rate_snapshot?: number | null
          vendor_id?: string
          work_type_id?: string | null
          work_type_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oj_entries_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "oj_billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_entries_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "oj_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_entries_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_entries_work_type_id_fkey"
            columns: ["work_type_id"]
            isOneToOne: false
            referencedRelation: "oj_work_types"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_project_contacts: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          project_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          project_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_project_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendor_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_project_contacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "oj_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_projects: {
        Row: {
          brief: string | null
          budget_ex_vat: number | null
          budget_hours: number | null
          created_at: string
          deadline: string | null
          id: string
          internal_notes: string | null
          is_retainer: boolean
          project_code: string
          project_name: string
          retainer_period_yyyymm: string | null
          status: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          brief?: string | null
          budget_ex_vat?: number | null
          budget_hours?: number | null
          created_at?: string
          deadline?: string | null
          id?: string
          internal_notes?: string | null
          is_retainer?: boolean
          project_code: string
          project_name: string
          retainer_period_yyyymm?: string | null
          status?: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          brief?: string | null
          budget_ex_vat?: number | null
          budget_hours?: number | null
          created_at?: string
          deadline?: string | null
          id?: string
          internal_notes?: string | null
          is_retainer?: boolean
          project_code?: string
          project_name?: string
          retainer_period_yyyymm?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_projects_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_recurring_charge_instances: {
        Row: {
          amount_ex_vat_snapshot: number
          billed_at: string | null
          billing_run_id: string | null
          coverage_end: string | null
          coverage_start: string | null
          created_at: string
          description_snapshot: string
          id: string
          invoice_id: string | null
          paid_at: string | null
          period_end: string
          period_start: string
          period_yyyymm: string
          recurring_charge_id: string
          sort_order_snapshot: number
          status: string
          updated_at: string
          vat_rate_snapshot: number
          vendor_id: string
        }
        Insert: {
          amount_ex_vat_snapshot: number
          billed_at?: string | null
          billing_run_id?: string | null
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          description_snapshot: string
          id?: string
          invoice_id?: string | null
          paid_at?: string | null
          period_end: string
          period_start: string
          period_yyyymm: string
          recurring_charge_id: string
          sort_order_snapshot?: number
          status?: string
          updated_at?: string
          vat_rate_snapshot?: number
          vendor_id: string
        }
        Update: {
          amount_ex_vat_snapshot?: number
          billed_at?: string | null
          billing_run_id?: string | null
          coverage_end?: string | null
          coverage_start?: string | null
          created_at?: string
          description_snapshot?: string
          id?: string
          invoice_id?: string | null
          paid_at?: string | null
          period_end?: string
          period_start?: string
          period_yyyymm?: string
          recurring_charge_id?: string
          sort_order_snapshot?: number
          status?: string
          updated_at?: string
          vat_rate_snapshot?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_recurring_charge_instances_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "oj_billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_recurring_charge_instances_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_recurring_charge_instances_recurring_charge_id_fkey"
            columns: ["recurring_charge_id"]
            isOneToOne: false
            referencedRelation: "oj_vendor_recurring_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oj_recurring_charge_instances_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_vendor_billing_settings: {
        Row: {
          billing_mode: string
          client_code: string | null
          created_at: string
          hourly_rate_ex_vat: number
          mileage_rate: number
          monthly_cap_inc_vat: number | null
          retainer_included_hours_per_month: number | null
          statement_mode: boolean
          updated_at: string
          vat_rate: number
          vendor_id: string
        }
        Insert: {
          billing_mode?: string
          client_code?: string | null
          created_at?: string
          hourly_rate_ex_vat?: number
          mileage_rate?: number
          monthly_cap_inc_vat?: number | null
          retainer_included_hours_per_month?: number | null
          statement_mode?: boolean
          updated_at?: string
          vat_rate?: number
          vendor_id: string
        }
        Update: {
          billing_mode?: string
          client_code?: string | null
          created_at?: string
          hourly_rate_ex_vat?: number
          mileage_rate?: number
          monthly_cap_inc_vat?: number | null
          retainer_included_hours_per_month?: number | null
          statement_mode?: boolean
          updated_at?: string
          vat_rate?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_vendor_billing_settings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_vendor_recurring_charges: {
        Row: {
          amount_ex_vat: number
          created_at: string
          description: string
          frequency: string
          id: string
          is_active: boolean
          sort_order: number
          updated_at: string
          vat_rate: number
          vendor_id: string
        }
        Insert: {
          amount_ex_vat: number
          created_at?: string
          description: string
          frequency?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
          vat_rate?: number
          vendor_id: string
        }
        Update: {
          amount_ex_vat?: number
          created_at?: string
          description?: string
          frequency?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
          vat_rate?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oj_vendor_recurring_charges_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_work_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      outside_reservations: {
        Row: {
          capacity_basis: number
          created_at: string
          ends_at: string
          id: string
          starts_at: string
          table_booking_id: string
          tables_reserved: number
          updated_at: string
        }
        Insert: {
          capacity_basis: number
          created_at?: string
          ends_at: string
          id?: string
          starts_at: string
          table_booking_id: string
          tables_reserved: number
          updated_at?: string
        }
        Update: {
          capacity_basis?: number
          created_at?: string
          ends_at?: string
          id?: string
          starts_at?: string
          table_booking_id?: string
          tables_reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outside_reservations_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: true
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outside_reservations_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: true
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_booking_notifications: {
        Row: {
          booking_id: string
          channel: Database["public"]["Enums"]["parking_notification_channel"]
          created_at: string
          email_message_id: string | null
          error: string | null
          event_type: Database["public"]["Enums"]["parking_notification_event"]
          id: string
          message_sid: string | null
          payload: Json | null
          retries: number
          sent_at: string | null
          status: string
        }
        Insert: {
          booking_id: string
          channel: Database["public"]["Enums"]["parking_notification_channel"]
          created_at?: string
          email_message_id?: string | null
          error?: string | null
          event_type: Database["public"]["Enums"]["parking_notification_event"]
          id?: string
          message_sid?: string | null
          payload?: Json | null
          retries?: number
          sent_at?: string | null
          status?: string
        }
        Update: {
          booking_id?: string
          channel?: Database["public"]["Enums"]["parking_notification_channel"]
          created_at?: string
          email_message_id?: string | null
          error?: string | null
          event_type?: Database["public"]["Enums"]["parking_notification_event"]
          id?: string
          message_sid?: string | null
          payload?: Json | null
          retries?: number
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_booking_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "parking_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_booking_payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          metadata: Json | null
          paid_at: string | null
          paypal_order_id: string | null
          provider: string
          refund_status: string | null
          refunded_at: string | null
          status: Database["public"]["Enums"]["parking_payment_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          paypal_order_id?: string | null
          provider?: string
          refund_status?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["parking_payment_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          paypal_order_id?: string | null
          provider?: string
          refund_status?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["parking_payment_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "parking_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_bookings: {
        Row: {
          calculated_price: number
          cancelled_at: string | null
          capacity_override: boolean | null
          capacity_override_reason: string | null
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_first_name: string
          customer_id: string | null
          customer_last_name: string | null
          customer_mobile: string
          duration_minutes: number
          end_at: string
          end_notification_sent: boolean | null
          expires_at: string | null
          id: string
          initial_request_sms_sent: boolean
          notes: string | null
          override_price: number | null
          override_reason: string | null
          paid_end_three_day_sms_sent: boolean
          paid_start_three_day_sms_sent: boolean
          payment_due_at: string | null
          payment_overdue_notified: boolean | null
          payment_status: Database["public"]["Enums"]["parking_payment_status"]
          pricing_breakdown: Json
          reference: string
          start_at: string
          start_notification_sent: boolean | null
          status: Database["public"]["Enums"]["parking_booking_status"]
          unpaid_day_before_sms_sent: boolean
          unpaid_week_before_sms_sent: boolean
          updated_at: string
          updated_by: string | null
          vehicle_colour: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_registration: string
        }
        Insert: {
          calculated_price: number
          cancelled_at?: string | null
          capacity_override?: boolean | null
          capacity_override_reason?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_first_name: string
          customer_id?: string | null
          customer_last_name?: string | null
          customer_mobile: string
          duration_minutes: number
          end_at: string
          end_notification_sent?: boolean | null
          expires_at?: string | null
          id?: string
          initial_request_sms_sent?: boolean
          notes?: string | null
          override_price?: number | null
          override_reason?: string | null
          paid_end_three_day_sms_sent?: boolean
          paid_start_three_day_sms_sent?: boolean
          payment_due_at?: string | null
          payment_overdue_notified?: boolean | null
          payment_status?: Database["public"]["Enums"]["parking_payment_status"]
          pricing_breakdown: Json
          reference: string
          start_at: string
          start_notification_sent?: boolean | null
          status?: Database["public"]["Enums"]["parking_booking_status"]
          unpaid_day_before_sms_sent?: boolean
          unpaid_week_before_sms_sent?: boolean
          updated_at?: string
          updated_by?: string | null
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_registration: string
        }
        Update: {
          calculated_price?: number
          cancelled_at?: string | null
          capacity_override?: boolean | null
          capacity_override_reason?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_first_name?: string
          customer_id?: string | null
          customer_last_name?: string | null
          customer_mobile?: string
          duration_minutes?: number
          end_at?: string
          end_notification_sent?: boolean | null
          expires_at?: string | null
          id?: string
          initial_request_sms_sent?: boolean
          notes?: string | null
          override_price?: number | null
          override_reason?: string | null
          paid_end_three_day_sms_sent?: boolean
          paid_start_three_day_sms_sent?: boolean
          payment_due_at?: string | null
          payment_overdue_notified?: boolean | null
          payment_status?: Database["public"]["Enums"]["parking_payment_status"]
          pricing_breakdown?: Json
          reference?: string
          start_at?: string
          start_notification_sent?: boolean | null
          status?: Database["public"]["Enums"]["parking_booking_status"]
          unpaid_day_before_sms_sent?: boolean
          unpaid_week_before_sms_sent?: boolean
          updated_at?: string
          updated_by?: string | null
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_registration?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "parking_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_bookings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_rates: {
        Row: {
          capacity_override: number | null
          created_at: string
          daily_rate: number
          effective_from: string
          hourly_rate: number
          id: string
          monthly_rate: number
          notes: string | null
          weekly_rate: number
        }
        Insert: {
          capacity_override?: number | null
          created_at?: string
          daily_rate: number
          effective_from?: string
          hourly_rate: number
          id?: string
          monthly_rate: number
          notes?: string | null
          weekly_rate: number
        }
        Update: {
          capacity_override?: number | null
          created_at?: string
          daily_rate?: number
          effective_from?: string
          hourly_rate?: number
          id?: string
          monthly_rate?: number
          notes?: string | null
          weekly_rate?: number
        }
        Relationships: []
      }
      pay_age_bands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          max_age: number | null
          min_age: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          max_age?: number | null
          min_age: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          max_age?: number | null
          min_age?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      pay_band_rates: {
        Row: {
          band_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          hourly_rate: number
          id: string
        }
        Insert: {
          band_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          hourly_rate: number
          id?: string
        }
        Update: {
          band_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          hourly_rate?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_band_rates_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "pay_age_bands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_band_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          failed_at: string | null
          failure_message: string | null
          id: string
          initiated_by: string | null
          initiated_by_type: string
          notification_status: string | null
          original_amount: number
          paypal_capture_id: string | null
          paypal_refund_id: string | null
          paypal_request_id: string | null
          paypal_status: string | null
          paypal_status_details: string | null
          reason: string
          refund_method: string
          source_id: string
          source_type: string
          status: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          failure_message?: string | null
          id?: string
          initiated_by?: string | null
          initiated_by_type?: string
          notification_status?: string | null
          original_amount: number
          paypal_capture_id?: string | null
          paypal_refund_id?: string | null
          paypal_request_id?: string | null
          paypal_status?: string | null
          paypal_status_details?: string | null
          reason: string
          refund_method: string
          source_id: string
          source_type: string
          status?: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          failure_message?: string | null
          id?: string
          initiated_by?: string | null
          initiated_by_type?: string
          notification_status?: string | null
          original_amount?: number
          paypal_capture_id?: string | null
          paypal_refund_id?: string | null
          paypal_request_id?: string | null
          paypal_status?: string | null
          paypal_status_details?: string | null
          reason?: string
          refund_method?: string
          source_id?: string
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          charge_type: string
          created_at: string
          currency: string
          event_booking_id: string | null
          id: string
          metadata: Json
          payment_method: string | null
          payment_provider: string | null
          paypal_capture_id: string | null
          paypal_order_id: string | null
          refund_amount: number | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          table_booking_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          charge_type: string
          created_at?: string
          currency?: string
          event_booking_id?: string | null
          id?: string
          metadata?: Json
          payment_method?: string | null
          payment_provider?: string | null
          paypal_capture_id?: string | null
          paypal_order_id?: string | null
          refund_amount?: number | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          table_booking_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          charge_type?: string
          created_at?: string
          currency?: string
          event_booking_id?: string | null
          id?: string
          metadata?: Json
          payment_method?: string | null
          payment_provider?: string | null
          paypal_capture_id?: string | null
          paypal_order_id?: string | null
          refund_amount?: number | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          table_booking_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "payments_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_month_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          email_sent_at: string | null
          email_sent_by: string | null
          id: string
          month: number
          snapshot: Json
          year: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          email_sent_at?: string | null
          email_sent_by?: string | null
          id?: string
          month: number
          snapshot: Json
          year: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          email_sent_at?: string | null
          email_sent_by?: string | null
          id?: string
          month?: number
          snapshot?: Json
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_month_approvals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_month_approvals_email_sent_by_fkey"
            columns: ["email_sent_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          id: string
          month: number
          period_end: string
          period_start: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          period_end: string
          period_start: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          period_end?: string
          period_start?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      pending_bookings: {
        Row: {
          booking_id: string | null
          confirmed_at: string | null
          created_at: string | null
          customer_id: string | null
          event_id: string
          expires_at: string
          id: string
          initiated_by_api_key: string | null
          metadata: Json | null
          mobile_number: string
          seats: number | null
          token: string
          updated_at: string | null
        }
        Insert: {
          booking_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          event_id: string
          expires_at: string
          id?: string
          initiated_by_api_key?: string | null
          metadata?: Json | null
          mobile_number: string
          seats?: number | null
          token: string
          updated_at?: string | null
        }
        Update: {
          booking_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          event_id?: string
          expires_at?: string
          id?: string
          initiated_by_api_key?: string | null
          metadata?: Json | null
          mobile_number?: string
          seats?: number | null
          token?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "pending_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pending_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_bookings_initiated_by_api_key_fkey"
            columns: ["initiated_by_api_key"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      performer_submissions: {
        Row: {
          bio: string
          consent_data_storage: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          internal_notes: string | null
          phone: string
          source: string
          status: Database["public"]["Enums"]["performer_submission_status"]
          submitted_ip: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          bio: string
          consent_data_storage: boolean
          created_at?: string
          email: string
          full_name: string
          id?: string
          internal_notes?: string | null
          phone: string
          source?: string
          status?: Database["public"]["Enums"]["performer_submission_status"]
          submitted_ip?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          bio?: string
          consent_data_storage?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          internal_notes?: string | null
          phone?: string
          source?: string
          status?: Database["public"]["Enums"]["performer_submission_status"]
          submitted_ip?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          action: string
          created_at: string | null
          description: string | null
          id: string
          module_name: string
        }
        Insert: {
          action: string
          created_at?: string | null
          description?: string | null
          id?: string
          module_name: string
        }
        Update: {
          action?: string
          created_at?: string | null
          description?: string | null
          id?: string
          module_name?: string
        }
        Relationships: []
      }
      phone_standardization_issues: {
        Row: {
          created_at: string | null
          id: string
          original_phone: string
          record_id: string
          table_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          original_phone: string
          record_id: string
          table_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          original_phone?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      pl_manual_actuals: {
        Row: {
          metric_key: string
          timeframe: string
          updated_at: string
          value: number | null
        }
        Insert: {
          metric_key: string
          timeframe: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          metric_key?: string
          timeframe?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      pl_targets: {
        Row: {
          metric_key: string
          target_value: number | null
          timeframe: string
          updated_at: string
        }
        Insert: {
          metric_key: string
          target_value?: number | null
          timeframe: string
          updated_at?: string
        }
        Update: {
          metric_key?: string
          target_value?: number | null
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      pnl_sales_imports: {
        Row: {
          created_at: string
          drinks_sales: number
          food_sales: number
          id: string
          other_sales: number
          sale_date: string
          site_id: string
          source: string
          source_section: string
          total_sales: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          drinks_sales?: number
          food_sales?: number
          id?: string
          other_sales?: number
          sale_date: string
          site_id: string
          source?: string
          source_section?: string
          total_sales?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          drinks_sales?: number
          food_sales?: number
          id?: string
          other_sales?: number
          sale_date?: string
          site_id?: string
          source?: string
          source_section?: string
          total_sales?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pnl_sales_imports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_audit: {
        Row: {
          action: string
          booking_id: string
          field_name: string | null
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          performed_at: string
          performed_by: string | null
        }
        Insert: {
          action: string
          booking_id: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          performed_at?: string
          performed_by?: string | null
        }
        Update: {
          action?: string
          booking_id?: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          performed_at?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_audit_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_audit_performed_by_profile_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_complaints: {
        Row: {
          acknowledged_at: string | null
          booking_id: string | null
          channel: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          handled_by: string | null
          id: string
          received_at: string
          resolution: string | null
          resolved_at: string | null
          responded_at: string | null
          status: string
          summary: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          booking_id?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          handled_by?: string | null
          id?: string
          received_at?: string
          resolution?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          status?: string
          summary: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          booking_id?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          handled_by?: string | null
          id?: string
          received_at?: string
          resolution?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          status?: string
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_complaints_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_complaints_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_complaints_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_complaints_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_deductions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          booking_id: string
          created_at: string
          created_by: string | null
          customer_discussion_note: string | null
          evidence_document_id: string | null
          id: string
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          booking_id: string
          created_at?: string
          created_by?: string | null
          customer_discussion_note?: string | null
          evidence_document_id?: string | null
          id?: string
          reason: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          booking_id?: string
          created_at?: string
          created_by?: string | null
          customer_discussion_note?: string | null
          evidence_document_id?: string | null
          id?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_deductions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_deductions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_deductions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_deductions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_deductions_evidence_document_id_fkey"
            columns: ["evidence_document_id"]
            isOneToOne: false
            referencedRelation: "private_booking_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_documents: {
        Row: {
          booking_id: string
          document_type: string
          file_name: string
          file_size_bytes: number | null
          generated_at: string | null
          generated_by: string | null
          id: string
          metadata: Json | null
          mime_type: string | null
          storage_path: string
          version: number | null
        }
        Insert: {
          booking_id: string
          document_type: string
          file_name: string
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          storage_path: string
          version?: number | null
        }
        Update: {
          booking_id?: string
          document_type?: string
          file_name?: string
          file_size_bytes?: number | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          storage_path?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_documents_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_items: {
        Row: {
          booking_id: string
          created_at: string
          description: string
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          display_order: number
          id: string
          item_type: string
          line_total: number | null
          notes: string | null
          package_id: string | null
          quantity: number
          space_id: string | null
          unit_price: number
          vat_rate: number
          vendor_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          description: string
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          display_order?: number
          id?: string
          item_type: string
          line_total?: number | null
          notes?: string | null
          package_id?: string | null
          quantity?: number
          space_id?: string | null
          unit_price: number
          vat_rate?: number
          vendor_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          description?: string
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          display_order?: number
          id?: string
          item_type?: string
          line_total?: number | null
          notes?: string | null
          package_id?: string | null
          quantity?: number
          space_id?: string | null
          unit_price?: number
          vat_rate?: number
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "catering_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_items_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "venue_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          id: string
          method: string
          notes: string | null
          recorded_by: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          id?: string
          method: string
          notes?: string | null
          recorded_by?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_send_idempotency: {
        Row: {
          booking_id: string
          created_at: string | null
          idempotency_key: string
          trigger_type: string
          window_key: string
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          idempotency_key: string
          trigger_type: string
          window_key: string
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          idempotency_key?: string
          trigger_type?: string
          window_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_send_idempotency_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_send_idempotency_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_send_idempotency_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_send_idempotency_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_sms_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          booking_id: string
          created_at: string
          created_by: string | null
          customer_name: string
          customer_phone: string
          error_message: string | null
          id: string
          message_body: string
          metadata: Json | null
          priority: number | null
          recipient_phone: string | null
          scheduled_for: string
          sent_at: string | null
          skip_conditions: Json | null
          status: string | null
          template_key: string
          trigger_type: string
          twilio_message_sid: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          booking_id: string
          created_at?: string
          created_by?: string | null
          customer_name: string
          customer_phone: string
          error_message?: string | null
          id?: string
          message_body: string
          metadata?: Json | null
          priority?: number | null
          recipient_phone?: string | null
          scheduled_for: string
          sent_at?: string | null
          skip_conditions?: Json | null
          status?: string | null
          template_key: string
          trigger_type: string
          twilio_message_sid?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          booking_id?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string
          customer_phone?: string
          error_message?: string | null
          id?: string
          message_body?: string
          metadata?: Json | null
          priority?: number | null
          recipient_phone?: string | null
          scheduled_for?: string
          sent_at?: string | null
          skip_conditions?: Json | null
          status?: string | null
          template_key?: string
          trigger_type?: string
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_sms_queue_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_sms_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_sms_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_sms_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_sms_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_sms_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_suppliers: {
        Row: {
          arrival_time: string | null
          booking_id: string
          contact_details: string | null
          created_at: string
          created_by: string | null
          departure_time: string | null
          documents_received: string[]
          documents_required: string[]
          id: string
          name: string
          notes: string | null
          power_requirements: string | null
          status: string
          supplier_type: string | null
          updated_at: string
          vehicle_notes: string | null
          vendor_id: string | null
        }
        Insert: {
          arrival_time?: string | null
          booking_id: string
          contact_details?: string | null
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          documents_received?: string[]
          documents_required?: string[]
          id?: string
          name: string
          notes?: string | null
          power_requirements?: string | null
          status?: string
          supplier_type?: string | null
          updated_at?: string
          vehicle_notes?: string | null
          vendor_id?: string | null
        }
        Update: {
          arrival_time?: string | null
          booking_id?: string
          contact_details?: string | null
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          documents_received?: string[]
          documents_required?: string[]
          id?: string
          name?: string
          notes?: string | null
          power_requirements?: string | null
          status?: string
          supplier_type?: string | null
          updated_at?: string
          vehicle_notes?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_booking_suppliers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_sms_reminders"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "private_booking_suppliers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_booking_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_suppliers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_suppliers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "private_bookings_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_booking_suppliers_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      private_bookings: {
        Row: {
          accessibility_needs: string | null
          balance_due_date: string | null
          bar_tab_approved_by: string | null
          bar_tab_limit: number | null
          bar_tab_preauth_reference: string | null
          bar_tab_prepaid_amount: number | null
          bar_tab_required: boolean
          calendar_event_id: string | null
          cancellation_channel: string | null
          cancellation_evidence_document_id: string | null
          cancellation_reason: string | null
          cancellation_received_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cleardown_time: string | null
          communication_preference: string | null
          contact_email: string | null
          contact_phone: string | null
          contract_acceptance_method: string | null
          contract_accepted_at: string | null
          contract_note: string | null
          contract_sent_at: string | null
          contract_sent_to: string | null
          contract_version: number | null
          created_at: string
          created_by: string | null
          customer_first_name: string | null
          customer_full_name: string | null
          customer_id: string | null
          customer_last_name: string | null
          customer_name: string
          customer_requests: string | null
          date_tbd: boolean
          decorations_plan: string | null
          deposit_amount: number | null
          deposit_paid_date: string | null
          deposit_payment_method: string | null
          deposit_refund_status: string | null
          deposit_waived: boolean
          deposit_waived_reason: string | null
          discount_amount: number | null
          discount_reason: string | null
          discount_type: string | null
          dogs_expected: boolean
          end_time: string | null
          end_time_next_day: boolean | null
          event_date: string
          event_sheet_status: string
          event_type: string | null
          final_details_status: string
          final_payment_date: string | null
          final_payment_method: string | null
          guest_count: number | null
          guest_count_adults: number | null
          guest_count_under_18: number | null
          has_open_dispute: boolean
          high_power_equipment: boolean
          high_power_equipment_approved_at: string | null
          hold_expiry: string | null
          id: string
          internal_notes: string | null
          layout: string | null
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          outcome_email_sent_at: string | null
          outside_food: boolean
          paypal_deposit_capture_id: string | null
          paypal_deposit_order_id: string | null
          paypal_reconciliation_attempts: number
          paypal_reconciliation_last_error: string | null
          post_event_outcome: string | null
          post_event_outcome_decided_at: string | null
          post_event_status: string | null
          review_clicked_at: string | null
          review_processed_at: string | null
          review_sms_sent_at: string | null
          risk_status: string
          setup_date: string | null
          setup_time: string | null
          source: string | null
          special_requirements: string | null
          special_risk_notes: string | null
          start_time: string
          status: string | null
          supplier_status: string
          total_amount: number | null
          updated_at: string
          waiver_status: string
        }
        Insert: {
          accessibility_needs?: string | null
          balance_due_date?: string | null
          bar_tab_approved_by?: string | null
          bar_tab_limit?: number | null
          bar_tab_preauth_reference?: string | null
          bar_tab_prepaid_amount?: number | null
          bar_tab_required?: boolean
          calendar_event_id?: string | null
          cancellation_channel?: string | null
          cancellation_evidence_document_id?: string | null
          cancellation_reason?: string | null
          cancellation_received_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cleardown_time?: string | null
          communication_preference?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contract_acceptance_method?: string | null
          contract_accepted_at?: string | null
          contract_note?: string | null
          contract_sent_at?: string | null
          contract_sent_to?: string | null
          contract_version?: number | null
          created_at?: string
          created_by?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_name: string
          customer_requests?: string | null
          date_tbd?: boolean
          decorations_plan?: string | null
          deposit_amount?: number | null
          deposit_paid_date?: string | null
          deposit_payment_method?: string | null
          deposit_refund_status?: string | null
          deposit_waived?: boolean
          deposit_waived_reason?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          discount_type?: string | null
          dogs_expected?: boolean
          end_time?: string | null
          end_time_next_day?: boolean | null
          event_date: string
          event_sheet_status?: string
          event_type?: string | null
          final_details_status?: string
          final_payment_date?: string | null
          final_payment_method?: string | null
          guest_count?: number | null
          guest_count_adults?: number | null
          guest_count_under_18?: number | null
          has_open_dispute?: boolean
          high_power_equipment?: boolean
          high_power_equipment_approved_at?: string | null
          hold_expiry?: string | null
          id?: string
          internal_notes?: string | null
          layout?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          outcome_email_sent_at?: string | null
          outside_food?: boolean
          paypal_deposit_capture_id?: string | null
          paypal_deposit_order_id?: string | null
          paypal_reconciliation_attempts?: number
          paypal_reconciliation_last_error?: string | null
          post_event_outcome?: string | null
          post_event_outcome_decided_at?: string | null
          post_event_status?: string | null
          review_clicked_at?: string | null
          review_processed_at?: string | null
          review_sms_sent_at?: string | null
          risk_status?: string
          setup_date?: string | null
          setup_time?: string | null
          source?: string | null
          special_requirements?: string | null
          special_risk_notes?: string | null
          start_time: string
          status?: string | null
          supplier_status?: string
          total_amount?: number | null
          updated_at?: string
          waiver_status?: string
        }
        Update: {
          accessibility_needs?: string | null
          balance_due_date?: string | null
          bar_tab_approved_by?: string | null
          bar_tab_limit?: number | null
          bar_tab_preauth_reference?: string | null
          bar_tab_prepaid_amount?: number | null
          bar_tab_required?: boolean
          calendar_event_id?: string | null
          cancellation_channel?: string | null
          cancellation_evidence_document_id?: string | null
          cancellation_reason?: string | null
          cancellation_received_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cleardown_time?: string | null
          communication_preference?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contract_acceptance_method?: string | null
          contract_accepted_at?: string | null
          contract_note?: string | null
          contract_sent_at?: string | null
          contract_sent_to?: string | null
          contract_version?: number | null
          created_at?: string
          created_by?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_name?: string
          customer_requests?: string | null
          date_tbd?: boolean
          decorations_plan?: string | null
          deposit_amount?: number | null
          deposit_paid_date?: string | null
          deposit_payment_method?: string | null
          deposit_refund_status?: string | null
          deposit_waived?: boolean
          deposit_waived_reason?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          discount_type?: string | null
          dogs_expected?: boolean
          end_time?: string | null
          end_time_next_day?: boolean | null
          event_date?: string
          event_sheet_status?: string
          event_type?: string | null
          final_details_status?: string
          final_payment_date?: string | null
          final_payment_method?: string | null
          guest_count?: number | null
          guest_count_adults?: number | null
          guest_count_under_18?: number | null
          has_open_dispute?: boolean
          high_power_equipment?: boolean
          high_power_equipment_approved_at?: string | null
          hold_expiry?: string | null
          id?: string
          internal_notes?: string | null
          layout?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          outcome_email_sent_at?: string | null
          outside_food?: boolean
          paypal_deposit_capture_id?: string | null
          paypal_deposit_order_id?: string | null
          paypal_reconciliation_attempts?: number
          paypal_reconciliation_last_error?: string | null
          post_event_outcome?: string | null
          post_event_outcome_decided_at?: string | null
          post_event_status?: string | null
          review_clicked_at?: string | null
          review_processed_at?: string | null
          review_sms_sent_at?: string | null
          risk_status?: string
          setup_date?: string | null
          setup_time?: string | null
          source?: string | null
          special_requirements?: string | null
          special_risk_notes?: string | null
          start_time?: string
          status?: string | null
          supplier_status?: string
          total_amount?: number | null
          updated_at?: string
          waiver_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_bookings_cancellation_evidence_document_id_fkey"
            columns: ["cancellation_evidence_document_id"]
            isOneToOne: false
            referencedRelation: "private_booking_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          email_notifications: boolean | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          sms_notifications: boolean | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          email_notifications?: boolean | null
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          sms_notifications?: boolean | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          email_notifications?: boolean | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          sms_notifications?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_sequence: {
        Row: {
          audience_type: string
          created_at: string | null
          customer_id: string
          event_id: string
          id: string
          touch_14d_sent_at: string
          touch_24h_sent_at: string | null
          touch_3d_sent_at: string | null
          touch_7d_sent_at: string | null
        }
        Insert: {
          audience_type: string
          created_at?: string | null
          customer_id: string
          event_id: string
          id?: string
          touch_14d_sent_at: string
          touch_24h_sent_at?: string | null
          touch_3d_sent_at?: string | null
          touch_7d_sent_at?: string | null
        }
        Update: {
          audience_type?: string
          created_at?: string | null
          customer_id?: string
          event_id?: string
          id?: string
          touch_14d_sent_at?: string
          touch_24h_sent_at?: string | null
          touch_3d_sent_at?: string | null
          touch_7d_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_sequence_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "promo_sequence_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_sequence_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_sequence_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          description: string
          discount_amount: number | null
          discount_percentage: number | null
          id: string
          quantity: number | null
          quote_id: string
          subtotal_amount: number | null
          total_amount: number | null
          unit_price: number | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          description: string
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          quantity?: number | null
          quote_id: string
          subtotal_amount?: number | null
          total_amount?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          description?: string
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          quantity?: number | null
          quote_id?: string
          subtotal_amount?: number | null
          total_amount?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "line_item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          converted_to_invoice_id: string | null
          created_at: string | null
          discount_amount: number | null
          id: string
          internal_notes: string | null
          notes: string | null
          quote_date: string
          quote_discount_percentage: number | null
          quote_number: string
          reference: string | null
          status: string | null
          subtotal_amount: number | null
          total_amount: number | null
          updated_at: string | null
          valid_until: string
          vat_amount: number | null
          vendor_id: string | null
        }
        Insert: {
          converted_to_invoice_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          quote_date?: string
          quote_discount_percentage?: number | null
          quote_number: string
          reference?: string | null
          status?: string | null
          subtotal_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          valid_until: string
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Update: {
          converted_to_invoice_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          quote_date?: string
          quote_discount_percentage?: number | null
          quote_number?: string
          reference?: string | null
          status?: string | null
          subtotal_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          valid_until?: string
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_to_invoice_id_fkey"
            columns: ["converted_to_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string | null
          id: string
          key: string
          max_requests: number
          requests: Json | null
          updated_at: string | null
          window_ms: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          max_requests: number
          requests?: Json | null
          updated_at?: string | null
          window_ms: number
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          max_requests?: number
          requests?: Json | null
          updated_at?: string | null
          window_ms?: number
        }
        Relationships: []
      }
      receipt_anomalies: {
        Row: {
          anomaly_type: string
          detected_at: string
          id: string
          payload: Json
          resolved_at: string | null
          severity: string
          transaction_id: string | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          anomaly_type: string
          detected_at?: string
          id?: string
          payload?: Json
          resolved_at?: string | null
          severity?: string
          transaction_id?: string | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          anomaly_type?: string
          detected_at?: string
          id?: string
          payload?: Json
          resolved_at?: string | null
          severity?: string
          transaction_id?: string | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_anomalies_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_anomalies_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_anomalies_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_anomalies_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_batches: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          original_filename: string
          row_count: number
          source_hash: string
          source_type: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          original_filename: string
          row_count?: number
          source_hash: string
          source_type?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          original_filename?: string
          row_count?: number
          source_hash?: string
          source_type?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_classification_signals: {
        Row: {
          ai_confidence: number | null
          id: string
          new_expense_category: string | null
          new_status:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          new_vendor_id: string | null
          new_vendor_name: string | null
          payload: Json
          performed_at: string
          performed_by: string | null
          prior_expense_category: string | null
          prior_status:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          prior_vendor_id: string | null
          prior_vendor_name: string | null
          rule_id: string | null
          signal_type: string
          source: string
          transaction_id: string
        }
        Insert: {
          ai_confidence?: number | null
          id?: string
          new_expense_category?: string | null
          new_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          new_vendor_id?: string | null
          new_vendor_name?: string | null
          payload?: Json
          performed_at?: string
          performed_by?: string | null
          prior_expense_category?: string | null
          prior_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          prior_vendor_id?: string | null
          prior_vendor_name?: string | null
          rule_id?: string | null
          signal_type: string
          source: string
          transaction_id: string
        }
        Update: {
          ai_confidence?: number | null
          id?: string
          new_expense_category?: string | null
          new_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          new_vendor_id?: string | null
          new_vendor_name?: string | null
          payload?: Json
          performed_at?: string
          performed_by?: string | null
          prior_expense_category?: string | null
          prior_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          prior_vendor_id?: string | null
          prior_vendor_name?: string | null
          rule_id?: string | null
          signal_type?: string
          source?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_classification_signals_new_vendor_id_fkey"
            columns: ["new_vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_prior_vendor_id_fkey"
            columns: ["prior_vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_classification_signals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_duplicate_reviews: {
        Row: {
          created_at: string
          decision: string
          duplicate_file_id: string | null
          duplicate_transaction_id: string | null
          file_id: string | null
          id: string
          reason: string | null
          review_type: string
          reviewed_at: string
          reviewed_by: string | null
          transaction_id: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          duplicate_file_id?: string | null
          duplicate_transaction_id?: string | null
          file_id?: string | null
          id?: string
          reason?: string | null
          review_type: string
          reviewed_at?: string
          reviewed_by?: string | null
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          duplicate_file_id?: string | null
          duplicate_transaction_id?: string | null
          file_id?: string | null
          id?: string
          reason?: string | null
          review_type?: string
          reviewed_at?: string
          reviewed_by?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_duplicate_reviews_duplicate_file_id_fkey"
            columns: ["duplicate_file_id"]
            isOneToOne: false
            referencedRelation: "receipt_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_duplicate_transaction_id_fkey"
            columns: ["duplicate_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_duplicate_transaction_id_fkey"
            columns: ["duplicate_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_duplicate_transaction_id_fkey"
            columns: ["duplicate_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "receipt_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_duplicate_reviews_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_files: {
        Row: {
          content_hash: string | null
          file_name: string
          file_size_bytes: number | null
          hash_verified_at: string | null
          id: string
          mime_type: string | null
          storage_path: string
          transaction_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          content_hash?: string | null
          file_name: string
          file_size_bytes?: number | null
          hash_verified_at?: string | null
          id?: string
          mime_type?: string | null
          storage_path: string
          transaction_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          content_hash?: string | null
          file_name?: string
          file_size_bytes?: number | null
          hash_verified_at?: string | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          transaction_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_files_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_files_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_files_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_invoice_matches: {
        Row: {
          amount_match: boolean
          id: string
          invoice_id: string | null
          invoice_number: string
          invoice_paid_amount_before: number | null
          invoice_payment_id: string | null
          invoice_total_amount: number | null
          match_status: string
          matched_amount: number | null
          matched_at: string
          payload: Json
          receipt_transaction_id: string
          transaction_date: string
          updated_at: string
        }
        Insert: {
          amount_match?: boolean
          id?: string
          invoice_id?: string | null
          invoice_number: string
          invoice_paid_amount_before?: number | null
          invoice_payment_id?: string | null
          invoice_total_amount?: number | null
          match_status?: string
          matched_amount?: number | null
          matched_at?: string
          payload?: Json
          receipt_transaction_id: string
          transaction_date: string
          updated_at?: string
        }
        Update: {
          amount_match?: boolean
          id?: string
          invoice_id?: string | null
          invoice_number?: string
          invoice_paid_amount_before?: number | null
          invoice_payment_id?: string | null
          invoice_total_amount?: number | null
          match_status?: string
          matched_amount?: number | null
          matched_at?: string
          payload?: Json
          receipt_transaction_id?: string
          transaction_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_invoice_matches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_invoice_matches_invoice_payment_id_fkey"
            columns: ["invoice_payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_invoice_matches_receipt_transaction_id_fkey"
            columns: ["receipt_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_invoice_matches_receipt_transaction_id_fkey"
            columns: ["receipt_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_invoice_matches_receipt_transaction_id_fkey"
            columns: ["receipt_transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_rule_conflicts: {
        Row: {
          detected_at: string
          id: string
          overlap_count: number
          overlapping_rule_id: string
          resolved_at: string | null
          rule_id: string
          same_priority: boolean
          sample_transaction_ids: string[]
        }
        Insert: {
          detected_at?: string
          id?: string
          overlap_count?: number
          overlapping_rule_id: string
          resolved_at?: string | null
          rule_id: string
          same_priority?: boolean
          sample_transaction_ids?: string[]
        }
        Update: {
          detected_at?: string
          id?: string
          overlap_count?: number
          overlapping_rule_id?: string
          resolved_at?: string | null
          rule_id?: string
          same_priority?: boolean
          sample_transaction_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "receipt_rule_conflicts_overlapping_rule_id_fkey"
            columns: ["overlapping_rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rule_conflicts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_rule_suggestions: {
        Row: {
          approved_rule_id: string | null
          auto_status: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at: string
          declined_reason: string | null
          evidence: Json
          evidence_transaction_ids: string[]
          id: string
          match_description: string | null
          match_direction: string
          match_max_amount: number | null
          match_min_amount: number | null
          match_transaction_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          set_expense_category: string | null
          set_vendor_id: string | null
          set_vendor_name: string | null
          status: string
          suggested_name: string
        }
        Insert: {
          approved_rule_id?: string | null
          auto_status?: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at?: string
          declined_reason?: string | null
          evidence?: Json
          evidence_transaction_ids?: string[]
          id?: string
          match_description?: string | null
          match_direction?: string
          match_max_amount?: number | null
          match_min_amount?: number | null
          match_transaction_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          set_expense_category?: string | null
          set_vendor_id?: string | null
          set_vendor_name?: string | null
          status?: string
          suggested_name: string
        }
        Update: {
          approved_rule_id?: string | null
          auto_status?: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at?: string
          declined_reason?: string | null
          evidence?: Json
          evidence_transaction_ids?: string[]
          id?: string
          match_description?: string | null
          match_direction?: string
          match_max_amount?: number | null
          match_min_amount?: number | null
          match_transaction_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          set_expense_category?: string | null
          set_vendor_id?: string | null
          set_vendor_name?: string | null
          status?: string
          suggested_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_rule_suggestions_approved_rule_id_fkey"
            columns: ["approved_rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rule_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rule_suggestions_set_vendor_id_fkey"
            columns: ["set_vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_rules: {
        Row: {
          auto_status: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          description: string | null
          id: string
          is_active: boolean
          kind: string
          match_description: string | null
          match_direction: string
          match_max_amount: number | null
          match_min_amount: number | null
          match_transaction_type: string | null
          name: string
          priority: number
          reviewed_at: string | null
          reviewed_by: string | null
          set_expense_category: string | null
          set_vendor_name: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
        }
        Insert: {
          auto_status?: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          match_description?: string | null
          match_direction?: string
          match_max_amount?: number | null
          match_min_amount?: number | null
          match_transaction_type?: string | null
          name: string
          priority?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          set_expense_category?: string | null
          set_vendor_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Update: {
          auto_status?: Database["public"]["Enums"]["receipt_transaction_status"]
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          match_description?: string | null
          match_direction?: string
          match_max_amount?: number | null
          match_min_amount?: number | null
          match_transaction_type?: string | null
          name?: string
          priority?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          set_expense_category?: string | null
          set_vendor_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rules_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rules_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rules_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_rules_transaction_type_backup: {
        Row: {
          backed_up_at: string
          id: string
          match_description: string | null
          match_transaction_type: string
        }
        Insert: {
          backed_up_at?: string
          id: string
          match_description?: string | null
          match_transaction_type: string
        }
        Update: {
          backed_up_at?: string
          id?: string
          match_description?: string | null
          match_transaction_type?: string
        }
        Relationships: []
      }
      receipt_transaction_logs: {
        Row: {
          action_type: string
          id: string
          new_status:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          note: string | null
          performed_at: string
          performed_by: string | null
          previous_status:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          rule_id: string | null
          transaction_id: string
        }
        Insert: {
          action_type: string
          id?: string
          new_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          note?: string | null
          performed_at?: string
          performed_by?: string | null
          previous_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          rule_id?: string | null
          transaction_id: string
        }
        Update: {
          action_type?: string
          id?: string
          new_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          note?: string | null
          performed_at?: string
          performed_by?: string | null
          previous_status?:
            | Database["public"]["Enums"]["receipt_transaction_status"]
            | null
          rule_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_transaction_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transaction_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transaction_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_transaction_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_transaction_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_transactions: {
        Row: {
          ai_confidence: number | null
          ai_suggested_keywords: string | null
          amount_in: number | null
          amount_out: number | null
          amount_total: number | null
          auto_completed_reason: string | null
          balance: number | null
          batch_id: string | null
          card_account: string | null
          card_member: string | null
          created_at: string
          dedupe_hash: string
          details: string
          expense_category: string | null
          expense_category_source: string | null
          expense_rule_id: string | null
          expense_updated_at: string | null
          external_reference: string | null
          id: string
          marked_at: string | null
          marked_by: string | null
          marked_by_email: string | null
          marked_by_name: string | null
          marked_method: string | null
          merchant_category: string | null
          merchant_town: string | null
          notes: string | null
          receipt_required: boolean
          rule_applied_id: string | null
          source_type: string
          status: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date: string
          transaction_type: string | null
          updated_at: string
          vendor_id: string | null
          vendor_name: string | null
          vendor_rule_id: string | null
          vendor_source: string | null
          vendor_updated_at: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_suggested_keywords?: string | null
          amount_in?: number | null
          amount_out?: number | null
          amount_total?: number | null
          auto_completed_reason?: string | null
          balance?: number | null
          batch_id?: string | null
          card_account?: string | null
          card_member?: string | null
          created_at?: string
          dedupe_hash: string
          details: string
          expense_category?: string | null
          expense_category_source?: string | null
          expense_rule_id?: string | null
          expense_updated_at?: string | null
          external_reference?: string | null
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          marked_by_email?: string | null
          marked_by_name?: string | null
          marked_method?: string | null
          merchant_category?: string | null
          merchant_town?: string | null
          notes?: string | null
          receipt_required?: boolean
          rule_applied_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date: string
          transaction_type?: string | null
          updated_at?: string
          vendor_id?: string | null
          vendor_name?: string | null
          vendor_rule_id?: string | null
          vendor_source?: string | null
          vendor_updated_at?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_suggested_keywords?: string | null
          amount_in?: number | null
          amount_out?: number | null
          amount_total?: number | null
          auto_completed_reason?: string | null
          balance?: number | null
          batch_id?: string | null
          card_account?: string | null
          card_member?: string | null
          created_at?: string
          dedupe_hash?: string
          details?: string
          expense_category?: string | null
          expense_category_source?: string | null
          expense_rule_id?: string | null
          expense_updated_at?: string | null
          external_reference?: string | null
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          marked_by_email?: string | null
          marked_by_name?: string | null
          marked_method?: string | null
          merchant_category?: string | null
          merchant_town?: string | null
          notes?: string | null
          receipt_required?: boolean
          rule_applied_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date?: string
          transaction_type?: string | null
          updated_at?: string
          vendor_id?: string | null
          vendor_name?: string | null
          vendor_rule_id?: string | null
          vendor_source?: string | null
          vendor_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transactions_expense_rule_id_fkey"
            columns: ["expense_rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transactions_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transactions_rule_applied_id_fkey"
            columns: ["rule_applied_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_transactions_vendor_rule_id_fkey"
            columns: ["vendor_rule_id"]
            isOneToOne: false
            referencedRelation: "receipt_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_upload_intents: {
        Row: {
          completed_at: string | null
          file_size_bytes: number | null
          file_type: string | null
          id: string
          issued_at: string
          issued_to: string
          original_file_name: string | null
          receipt_file_id: string | null
          storage_path: string
          transaction_id: string
        }
        Insert: {
          completed_at?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          issued_at?: string
          issued_to: string
          original_file_name?: string | null
          receipt_file_id?: string | null
          storage_path: string
          transaction_id: string
        }
        Update: {
          completed_at?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          issued_at?: string
          issued_to?: string
          original_file_name?: string | null
          receipt_file_id?: string | null
          storage_path?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_upload_intents_receipt_file_id_fkey"
            columns: ["receipt_file_id"]
            isOneToOne: false
            referencedRelation: "receipt_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_upload_intents_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["duplicate_transaction_id"]
          },
          {
            foreignKeyName: "receipt_upload_intents_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_duplicate_candidates"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "receipt_upload_intents_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_vendor_aliases: {
        Row: {
          alias: string
          alias_key: string
          confidence: number | null
          created_at: string
          id: string
          source: string
          vendor_id: string
        }
        Insert: {
          alias: string
          alias_key: string
          confidence?: number | null
          created_at?: string
          id?: string
          source?: string
          vendor_id: string
        }
        Update: {
          alias?: string
          alias_key?: string
          confidence?: number | null
          created_at?: string
          id?: string
          source?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_vendor_aliases_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_vendor_reviews: {
        Row: {
          comparison: string
          created_at: string
          month_start: string
          status: string
          updated_at: string
          user_id: string
          vendor_key: string
          vendor_label: string
        }
        Insert: {
          comparison: string
          created_at?: string
          month_start: string
          status?: string
          updated_at?: string
          user_id: string
          vendor_key: string
          vendor_label: string
        }
        Update: {
          comparison?: string
          created_at?: string
          month_start?: string
          status?: string
          updated_at?: string
          user_id?: string
          vendor_key?: string
          vendor_label?: string
        }
        Relationships: []
      }
      receipt_vendor_watchlist: {
        Row: {
          created_at: string
          updated_at: string
          user_id: string
          vendor_key: string
          vendor_label: string
        }
        Insert: {
          created_at?: string
          updated_at?: string
          user_id: string
          vendor_key: string
          vendor_label: string
        }
        Update: {
          created_at?: string
          updated_at?: string
          user_id?: string
          vendor_key?: string
          vendor_label?: string
        }
        Relationships: []
      }
      receipt_vendors: {
        Row: {
          canonical_name: string
          category_hint: string | null
          created_at: string
          default_expense_category: string | null
          id: string
          invoice_vendor_id: string | null
          merged_into_vendor_id: string | null
          status: string
          updated_at: string
          vendor_key: string
        }
        Insert: {
          canonical_name: string
          category_hint?: string | null
          created_at?: string
          default_expense_category?: string | null
          id?: string
          invoice_vendor_id?: string | null
          merged_into_vendor_id?: string | null
          status?: string
          updated_at?: string
          vendor_key: string
        }
        Update: {
          canonical_name?: string
          category_hint?: string | null
          created_at?: string
          default_expense_category?: string | null
          id?: string
          invoice_vendor_id?: string | null
          merged_into_vendor_id?: string | null
          status?: string
          updated_at?: string
          vendor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_vendors_invoice_vendor_id_fkey"
            columns: ["invoice_vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_vendors_merged_into_vendor_id_fkey"
            columns: ["merged_into_vendor_id"]
            isOneToOne: false
            referencedRelation: "receipt_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_notes: {
        Row: {
          created_at: string
          created_by: string
          entity_id: string
          entity_type: string
          id: string
          note: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          entity_id: string
          entity_type: string
          id?: string
          note: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_ai_runs: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          completed_at: string | null
          completion_tokens: number | null
          cost: number | null
          created_at: string
          error_message: string | null
          id: string
          input_hash: string
          job_posting_id: string | null
          model: string
          operation: string
          prompt_tokens: number | null
          prompt_version: string
          raw_response: Json | null
          recommendation: string | null
          score: number | null
          status: string
          structured_output: Json | null
          total_tokens: number | null
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          candidate_id?: string | null
          completed_at?: string | null
          completion_tokens?: number | null
          cost?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_hash: string
          job_posting_id?: string | null
          model: string
          operation: string
          prompt_tokens?: number | null
          prompt_version: string
          raw_response?: Json | null
          recommendation?: string | null
          score?: number | null
          status?: string
          structured_output?: Json | null
          total_tokens?: number | null
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          candidate_id?: string | null
          completed_at?: string | null
          completion_tokens?: number | null
          cost?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_hash?: string
          job_posting_id?: string | null
          model?: string
          operation?: string
          prompt_tokens?: number | null
          prompt_version?: string
          raw_response?: Json | null
          recommendation?: string | null
          score?: number | null
          status?: string
          structured_output?: Json | null
          total_tokens?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_ai_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_ai_runs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_ai_runs_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "recruitment_job_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_application_status_events: {
        Row: {
          application_id: string
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          metadata: Json | null
          note: string | null
          to_status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          to_status: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          to_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_application_status_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_application_status_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_applications: {
        Row: {
          ai_concerns: Json | null
          ai_flags: Json | null
          ai_model: string | null
          ai_rationale: string | null
          ai_recommendation: string | null
          ai_score: number | null
          ai_scored_against_version: number | null
          ai_scored_at: string | null
          ai_strengths: Json | null
          archived_at: string | null
          archived_by: string | null
          availability: Json | null
          booking_token_expires_at: string | null
          booking_token_hash: string | null
          booking_token_type: string | null
          booking_token_used_at: string | null
          candidate_id: string
          cover_note: string | null
          created_at: string
          created_by: string | null
          duplicate_of_application_id: string | null
          id: string
          is_general: boolean | null
          job_posting_id: string | null
          latest_ai_run_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          relevant_experience_answer: string | null
          source: string
          start_availability: string | null
          status: string
          travel_answer: string | null
          updated_at: string
        }
        Insert: {
          ai_concerns?: Json | null
          ai_flags?: Json | null
          ai_model?: string | null
          ai_rationale?: string | null
          ai_recommendation?: string | null
          ai_score?: number | null
          ai_scored_against_version?: number | null
          ai_scored_at?: string | null
          ai_strengths?: Json | null
          archived_at?: string | null
          archived_by?: string | null
          availability?: Json | null
          booking_token_expires_at?: string | null
          booking_token_hash?: string | null
          booking_token_type?: string | null
          booking_token_used_at?: string | null
          candidate_id: string
          cover_note?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of_application_id?: string | null
          id?: string
          is_general?: boolean | null
          job_posting_id?: string | null
          latest_ai_run_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          relevant_experience_answer?: string | null
          source: string
          start_availability?: string | null
          status: string
          travel_answer?: string | null
          updated_at?: string
        }
        Update: {
          ai_concerns?: Json | null
          ai_flags?: Json | null
          ai_model?: string | null
          ai_rationale?: string | null
          ai_recommendation?: string | null
          ai_score?: number | null
          ai_scored_against_version?: number | null
          ai_scored_at?: string | null
          ai_strengths?: Json | null
          archived_at?: string | null
          archived_by?: string | null
          availability?: Json | null
          booking_token_expires_at?: string | null
          booking_token_hash?: string | null
          booking_token_type?: string | null
          booking_token_used_at?: string | null
          candidate_id?: string
          cover_note?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of_application_id?: string | null
          id?: string
          is_general?: boolean | null
          job_posting_id?: string | null
          latest_ai_run_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          relevant_experience_answer?: string | null
          source?: string
          start_availability?: string | null
          status?: string
          travel_answer?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_applications_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_applications_duplicate_of_application_id_fkey"
            columns: ["duplicate_of_application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_applications_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "recruitment_job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_applications_latest_ai_run_id_fkey"
            columns: ["latest_ai_run_id"]
            isOneToOne: false
            referencedRelation: "recruitment_ai_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_appointment_slots: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          capacity: number
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          interviewer_user_id: string | null
          location: string
          starts_at: string
          status: string
          supervisor_staff_id: string | null
          timezone: string
          type: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          interviewer_user_id?: string | null
          location?: string
          starts_at: string
          status?: string
          supervisor_staff_id?: string | null
          timezone?: string
          type: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          interviewer_user_id?: string | null
          location?: string
          starts_at?: string
          status?: string
          supervisor_staff_id?: string | null
          timezone?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_appointment_slots_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_appointment_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_appointment_slots_interviewer_user_id_fkey"
            columns: ["interviewer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_appointment_slots_supervisor_staff_id_fkey"
            columns: ["supervisor_staff_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      recruitment_candidate_appointments: {
        Row: {
          application_id: string
          archived_at: string | null
          archived_by: string | null
          booking_token_hash: string | null
          calendar_event_id: string | null
          calendar_last_error: string | null
          calendar_sync_status: string
          candidate_id: string
          created_at: string
          id: string
          location: string
          meal_provided: boolean
          outcome: string | null
          outcome_rating: number | null
          outcome_recorded_at: string | null
          reminder_email_sent_at: string | null
          reminder_sms_sent_at: string | null
          reschedule_count: number
          scheduled_end: string
          scheduled_start: string
          slot_id: string | null
          status: string
          supervisor_staff_id: string | null
          timezone: string
          token_expires_at: string | null
          type: string
          updated_at: string
        }
        Insert: {
          application_id: string
          archived_at?: string | null
          archived_by?: string | null
          booking_token_hash?: string | null
          calendar_event_id?: string | null
          calendar_last_error?: string | null
          calendar_sync_status?: string
          candidate_id: string
          created_at?: string
          id?: string
          location: string
          meal_provided?: boolean
          outcome?: string | null
          outcome_rating?: number | null
          outcome_recorded_at?: string | null
          reminder_email_sent_at?: string | null
          reminder_sms_sent_at?: string | null
          reschedule_count?: number
          scheduled_end: string
          scheduled_start: string
          slot_id?: string | null
          status: string
          supervisor_staff_id?: string | null
          timezone?: string
          token_expires_at?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          archived_at?: string | null
          archived_by?: string | null
          booking_token_hash?: string | null
          calendar_event_id?: string | null
          calendar_last_error?: string | null
          calendar_sync_status?: string
          candidate_id?: string
          created_at?: string
          id?: string
          location?: string
          meal_provided?: boolean
          outcome?: string | null
          outcome_rating?: number | null
          outcome_recorded_at?: string | null
          reminder_email_sent_at?: string | null
          reminder_sms_sent_at?: string | null
          reschedule_count?: number
          scheduled_end?: string
          scheduled_start?: string
          slot_id?: string | null
          status?: string
          supervisor_staff_id?: string | null
          timezone?: string
          token_expires_at?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_candidate_appointments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_appointments_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_appointments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_appointments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "recruitment_appointment_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_appointments_supervisor_staff_id_fkey"
            columns: ["supervisor_staff_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      recruitment_candidate_notes: {
        Row: {
          application_id: string | null
          candidate_id: string
          content: string
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          kind: string
        }
        Insert: {
          application_id?: string | null
          candidate_id: string
          content: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          kind?: string
        }
        Update: {
          application_id?: string | null
          candidate_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_candidate_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_notes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidate_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_candidates: {
        Row: {
          anonymised_at: string | null
          consent_at: string | null
          consent_source: string | null
          converted_employee_id: string | null
          created_at: string
          created_by: string | null
          cv_extraction_status: string
          cv_file_name: string | null
          cv_file_path: string | null
          cv_file_size_bytes: number | null
          cv_mime_type: string | null
          cv_sha256: string | null
          cv_summary: string | null
          cv_text: string | null
          email: string | null
          email_normalized: string | null
          extracted_data: Json | null
          first_name: string | null
          future_recruitment_consent: boolean
          future_recruitment_consent_at: string | null
          id: string
          last_name: string | null
          location: string | null
          notes: string | null
          phone: string | null
          phone_e164: string | null
          phone_normalized: string | null
          privacy_notice_version: string | null
          provided_details: string | null
          retention_until: string | null
          right_to_work_checked_at: string | null
          right_to_work_checked_by: string | null
          right_to_work_document_type: string | null
          right_to_work_status: string
          sms_consent: boolean
          sms_consent_at: string | null
          source: string
          updated_at: string
        }
        Insert: {
          anonymised_at?: string | null
          consent_at?: string | null
          consent_source?: string | null
          converted_employee_id?: string | null
          created_at?: string
          created_by?: string | null
          cv_extraction_status?: string
          cv_file_name?: string | null
          cv_file_path?: string | null
          cv_file_size_bytes?: number | null
          cv_mime_type?: string | null
          cv_sha256?: string | null
          cv_summary?: string | null
          cv_text?: string | null
          email?: string | null
          email_normalized?: string | null
          extracted_data?: Json | null
          first_name?: string | null
          future_recruitment_consent?: boolean
          future_recruitment_consent_at?: string | null
          id?: string
          last_name?: string | null
          location?: string | null
          notes?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_normalized?: string | null
          privacy_notice_version?: string | null
          provided_details?: string | null
          retention_until?: string | null
          right_to_work_checked_at?: string | null
          right_to_work_checked_by?: string | null
          right_to_work_document_type?: string | null
          right_to_work_status?: string
          sms_consent?: boolean
          sms_consent_at?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          anonymised_at?: string | null
          consent_at?: string | null
          consent_source?: string | null
          converted_employee_id?: string | null
          created_at?: string
          created_by?: string | null
          cv_extraction_status?: string
          cv_file_name?: string | null
          cv_file_path?: string | null
          cv_file_size_bytes?: number | null
          cv_mime_type?: string | null
          cv_sha256?: string | null
          cv_summary?: string | null
          cv_text?: string | null
          email?: string | null
          email_normalized?: string | null
          extracted_data?: Json | null
          first_name?: string | null
          future_recruitment_consent?: boolean
          future_recruitment_consent_at?: string | null
          id?: string
          last_name?: string | null
          location?: string | null
          notes?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_normalized?: string | null
          privacy_notice_version?: string | null
          provided_details?: string | null
          retention_until?: string | null
          right_to_work_checked_at?: string | null
          right_to_work_checked_by?: string | null
          right_to_work_document_type?: string | null
          right_to_work_status?: string
          sms_consent?: boolean
          sms_consent_at?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_candidates_converted_employee_id_fkey"
            columns: ["converted_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "recruitment_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_candidates_right_to_work_checked_by_fkey"
            columns: ["right_to_work_checked_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_communications: {
        Row: {
          ai_run_id: string | null
          application_id: string | null
          candidate_id: string
          channel: string
          created_at: string
          delivery_status: string
          edited_by: string | null
          final_body: string
          id: string
          idempotency_key: string | null
          metadata: Json | null
          provider: string | null
          provider_message_id: string | null
          sent_at: string | null
          sent_by: string | null
          subject: string | null
          type: string
          updated_at: string
          was_ai_assisted: boolean
        }
        Insert: {
          ai_run_id?: string | null
          application_id?: string | null
          candidate_id: string
          channel: string
          created_at?: string
          delivery_status?: string
          edited_by?: string | null
          final_body: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          subject?: string | null
          type: string
          updated_at?: string
          was_ai_assisted?: boolean
        }
        Update: {
          ai_run_id?: string | null
          application_id?: string | null
          candidate_id?: string
          channel?: string
          created_at?: string
          delivery_status?: string
          edited_by?: string | null
          final_body?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          subject?: string | null
          type?: string
          updated_at?: string
          was_ai_assisted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_communications_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "recruitment_ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_communications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_communications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_communications_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_communications_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          subject: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_interview_scorecards: {
        Row: {
          application_id: string
          appointment_id: string
          candidate_id: string
          comments: string | null
          created_at: string
          created_by: string | null
          criteria: Json
          id: string
          overall_rating: number | null
          recommendation: string
          updated_at: string
        }
        Insert: {
          application_id: string
          appointment_id: string
          candidate_id: string
          comments?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          overall_rating?: number | null
          recommendation?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          appointment_id?: string
          candidate_id?: string
          comments?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          overall_rating?: number | null
          recommendation?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_interview_scorecards_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "recruitment_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_interview_scorecards_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidate_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_interview_scorecards_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "recruitment_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_interview_scorecards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_job_postings: {
        Row: {
          ai_scoring_notes: string | null
          application_closing_date: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          employment_type: string
          id: string
          is_public: boolean
          opened_at: string | null
          positions_available: number
          requirements: string
          role_type: string
          slug: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          ai_scoring_notes?: string | null
          application_closing_date?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          employment_type: string
          id?: string
          is_public?: boolean
          opened_at?: string | null
          positions_available?: number
          requirements: string
          role_type: string
          slug: string
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          ai_scoring_notes?: string | null
          application_closing_date?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          employment_type?: string
          id?: string
          is_public?: boolean
          opened_at?: string | null
          positions_available?: number
          requirements?: string
          role_type?: string
          slug?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_job_postings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoice_history: {
        Row: {
          created_at: string | null
          error_message: string | null
          generation_date: string | null
          id: string
          invoice_id: string | null
          recurring_invoice_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          generation_date?: string | null
          id?: string
          invoice_id?: string | null
          recurring_invoice_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          generation_date?: string | null
          id?: string
          invoice_id?: string | null
          recurring_invoice_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      recurring_invoice_line_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          description: string
          discount_percentage: number | null
          id: string
          quantity: number | null
          recurring_invoice_id: string
          unit_price: number | null
          vat_rate: number | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          description: string
          discount_percentage?: number | null
          id?: string
          quantity?: number | null
          recurring_invoice_id: string
          unit_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          description?: string
          discount_percentage?: number | null
          id?: string
          quantity?: number | null
          recurring_invoice_id?: string
          unit_price?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_line_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "line_item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_line_items_recurring_invoice_id_fkey"
            columns: ["recurring_invoice_id"]
            isOneToOne: false
            referencedRelation: "recurring_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoices: {
        Row: {
          created_at: string | null
          days_before_due: number | null
          end_date: string | null
          frequency: string | null
          id: string
          internal_notes: string | null
          invoice_discount_percentage: number | null
          is_active: boolean | null
          last_invoice_id: string | null
          next_invoice_date: string
          notes: string | null
          reference: string | null
          start_date: string
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          days_before_due?: number | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          internal_notes?: string | null
          invoice_discount_percentage?: number | null
          is_active?: boolean | null
          last_invoice_id?: string | null
          next_invoice_date: string
          notes?: string | null
          reference?: string | null
          start_date: string
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          days_before_due?: number | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          internal_notes?: string | null
          invoice_discount_percentage?: number | null
          is_active?: boolean | null
          last_invoice_id?: string | null
          next_invoice_date?: string
          notes?: string | null
          reference?: string | null
          start_date?: string
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_last_invoice_id_fkey"
            columns: ["last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "invoice_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_processing_logs: {
        Row: {
          booking_id: string | null
          created_at: string | null
          customer_id: string | null
          error_details: Json | null
          event_id: string | null
          id: string
          message: string | null
          metadata: Json | null
          processing_type: string
          reminder_type: string | null
          template_type: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          error_details?: Json | null
          event_id?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          processing_type: string
          reminder_type?: string | null
          template_type?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          error_details?: Json | null
          event_id?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          processing_type?: string
          reminder_type?: string | null
          template_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_processing_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_processing_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "reminder_processing_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reminder_processing_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_processing_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_processing_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      review_feedback: {
        Row: {
          comments: string | null
          contact_consent: boolean
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          rating: number
          source: string
          staff_notes: string | null
          status: string
          submitted_ip: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          comments?: string | null
          contact_consent?: boolean
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          rating: number
          source?: string
          staff_notes?: string | null
          status?: string
          submitted_ip?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          comments?: string | null
          contact_consent?: boolean
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          rating?: number
          source?: string
          staff_notes?: string | null
          status?: string
          submitted_ip?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_feedback_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_redemptions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          generated_at: string | null
          id: string
          member_id: string | null
          metadata: Json | null
          points_spent: number
          redeemed_at: string | null
          redeemed_by: string | null
          redemption_code: string | null
          reward_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json | null
          points_spent: number
          redeemed_at?: string | null
          redeemed_by?: string | null
          redemption_code?: string | null
          reward_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json | null
          points_spent?: number
          redeemed_at?: string | null
          redeemed_by?: string | null
          redemption_code?: string | null
          reward_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loyalty_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string | null
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string | null
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      rota_email_log: {
        Row: {
          cc_addresses: string[] | null
          created_at: string
          email_type: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          message_id: string | null
          sent_at: string
          sent_by: string | null
          status: string
          subject: string
          to_addresses: string[]
        }
        Insert: {
          cc_addresses?: string[] | null
          created_at?: string
          email_type: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status: string
          subject: string
          to_addresses: string[]
        }
        Update: {
          cc_addresses?: string[] | null
          created_at?: string
          email_type?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          subject?: string
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "rota_email_log_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_google_calendar_events: {
        Row: {
          google_event_id: string
          shift_id: string
          updated_at: string | null
          week_id: string
        }
        Insert: {
          google_event_id: string
          shift_id: string
          updated_at?: string | null
          week_id: string
        }
        Update: {
          google_event_id?: string
          shift_id?: string
          updated_at?: string | null
          week_id?: string
        }
        Relationships: []
      }
      rota_open_shift_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          employee_id: string
          id: string
          manager_note: string | null
          note: string | null
          requested_at: string
          shift_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id: string
          id?: string
          manager_note?: string | null
          note?: string | null
          requested_at?: string
          shift_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id?: string
          id?: string
          manager_note?: string | null
          note?: string | null
          requested_at?: string
          shift_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rota_open_shift_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rota_open_shift_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_open_shift_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "rota_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_published_shifts: {
        Row: {
          acceptance_decided_at: string | null
          acceptance_decided_by: string | null
          acceptance_note: string | null
          acceptance_status: string | null
          auto_accept_reason: string | null
          auto_accept_warning_sent_at: string | null
          department: string
          employee_id: string | null
          end_time: string
          id: string
          is_open_shift: boolean
          is_overnight: boolean
          name: string | null
          notes: string | null
          premium_end_time: string | null
          premium_reason: string | null
          premium_start_time: string | null
          published_at: string
          rate_multiplier: number | null
          rate_override: number | null
          shift_date: string
          start_time: string
          status: string
          unpaid_break_minutes: number
          week_id: string
        }
        Insert: {
          acceptance_decided_at?: string | null
          acceptance_decided_by?: string | null
          acceptance_note?: string | null
          acceptance_status?: string | null
          auto_accept_reason?: string | null
          auto_accept_warning_sent_at?: string | null
          department: string
          employee_id?: string | null
          end_time: string
          id: string
          is_open_shift?: boolean
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          premium_end_time?: string | null
          premium_reason?: string | null
          premium_start_time?: string | null
          published_at?: string
          rate_multiplier?: number | null
          rate_override?: number | null
          shift_date: string
          start_time: string
          status?: string
          unpaid_break_minutes?: number
          week_id: string
        }
        Update: {
          acceptance_decided_at?: string | null
          acceptance_decided_by?: string | null
          acceptance_note?: string | null
          acceptance_status?: string | null
          auto_accept_reason?: string | null
          auto_accept_warning_sent_at?: string | null
          department?: string
          employee_id?: string | null
          end_time?: string
          id?: string
          is_open_shift?: boolean
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          premium_end_time?: string | null
          premium_reason?: string | null
          premium_start_time?: string | null
          published_at?: string
          rate_multiplier?: number | null
          rate_override?: number | null
          shift_date?: string
          start_time?: string
          status?: string
          unpaid_break_minutes?: number
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rota_published_shifts_acceptance_decided_by_fkey"
            columns: ["acceptance_decided_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_published_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_published_shifts_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "rota_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_shift_calendar_cancellations: {
        Row: {
          cancelled_at: string
          created_at: string
          department: string
          employee_id: string
          end_time: string
          id: string
          is_overnight: boolean
          name: string | null
          notes: string | null
          reason: string
          shift_date: string
          shift_id: string
          start_time: string
          unpaid_break_minutes: number
          week_id: string | null
        }
        Insert: {
          cancelled_at?: string
          created_at?: string
          department: string
          employee_id: string
          end_time: string
          id?: string
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          reason: string
          shift_date: string
          shift_id: string
          start_time: string
          unpaid_break_minutes?: number
          week_id?: string | null
        }
        Update: {
          cancelled_at?: string
          created_at?: string
          department?: string
          employee_id?: string
          end_time?: string
          id?: string
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          reason?: string
          shift_date?: string
          shift_id?: string
          start_time?: string
          unpaid_break_minutes?: number
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rota_shift_calendar_cancellations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shift_calendar_cancellations_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "rota_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_shift_rejections: {
        Row: {
          created_at: string
          department: string
          employee_id: string
          end_time: string
          id: string
          is_overnight: boolean
          name: string | null
          notes: string | null
          rejected_at: string
          rejected_by: string | null
          rejection_note: string | null
          shift_date: string
          shift_id: string
          start_time: string
          unpaid_break_minutes: number
          week_id: string | null
        }
        Insert: {
          created_at?: string
          department: string
          employee_id: string
          end_time: string
          id?: string
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          rejected_at?: string
          rejected_by?: string | null
          rejection_note?: string | null
          shift_date: string
          shift_id: string
          start_time: string
          unpaid_break_minutes?: number
          week_id?: string | null
        }
        Update: {
          created_at?: string
          department?: string
          employee_id?: string
          end_time?: string
          id?: string
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          rejected_at?: string
          rejected_by?: string | null
          rejection_note?: string | null
          shift_date?: string
          shift_id?: string
          start_time?: string
          unpaid_break_minutes?: number
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rota_shift_rejections_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shift_rejections_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shift_rejections_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "rota_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_shift_templates: {
        Row: {
          colour: string | null
          created_at: string
          created_by: string | null
          day_of_week: number | null
          department: string
          employee_id: string | null
          end_time: string
          id: string
          is_active: boolean
          name: string
          start_time: string
          unpaid_break_minutes: number
          updated_at: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          department: string
          employee_id?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          name: string
          start_time: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          department?: string
          employee_id?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          name?: string
          start_time?: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rota_shift_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rota_shift_templates_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      rota_shifts: {
        Row: {
          acceptance_decided_at: string | null
          acceptance_decided_by: string | null
          acceptance_note: string | null
          acceptance_status: string | null
          auto_accept_reason: string | null
          auto_accept_warning_sent_at: string | null
          created_at: string
          created_by: string | null
          department: string
          employee_id: string | null
          end_time: string
          id: string
          is_open_shift: boolean
          is_overnight: boolean
          name: string | null
          notes: string | null
          original_employee_id: string | null
          premium_end_time: string | null
          premium_reason: string | null
          premium_start_time: string | null
          rate_multiplier: number | null
          rate_override: number | null
          reassigned_at: string | null
          reassigned_by: string | null
          reassigned_from_id: string | null
          reassignment_reason: string | null
          shift_date: string
          sick_reason: string | null
          start_time: string
          status: string
          template_id: string | null
          unpaid_break_minutes: number
          updated_at: string
          week_id: string
        }
        Insert: {
          acceptance_decided_at?: string | null
          acceptance_decided_by?: string | null
          acceptance_note?: string | null
          acceptance_status?: string | null
          auto_accept_reason?: string | null
          auto_accept_warning_sent_at?: string | null
          created_at?: string
          created_by?: string | null
          department: string
          employee_id?: string | null
          end_time: string
          id?: string
          is_open_shift?: boolean
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          original_employee_id?: string | null
          premium_end_time?: string | null
          premium_reason?: string | null
          premium_start_time?: string | null
          rate_multiplier?: number | null
          rate_override?: number | null
          reassigned_at?: string | null
          reassigned_by?: string | null
          reassigned_from_id?: string | null
          reassignment_reason?: string | null
          shift_date: string
          sick_reason?: string | null
          start_time: string
          status?: string
          template_id?: string | null
          unpaid_break_minutes?: number
          updated_at?: string
          week_id: string
        }
        Update: {
          acceptance_decided_at?: string | null
          acceptance_decided_by?: string | null
          acceptance_note?: string | null
          acceptance_status?: string | null
          auto_accept_reason?: string | null
          auto_accept_warning_sent_at?: string | null
          created_at?: string
          created_by?: string | null
          department?: string
          employee_id?: string | null
          end_time?: string
          id?: string
          is_open_shift?: boolean
          is_overnight?: boolean
          name?: string | null
          notes?: string | null
          original_employee_id?: string | null
          premium_end_time?: string | null
          premium_reason?: string | null
          premium_start_time?: string | null
          rate_multiplier?: number | null
          rate_override?: number | null
          reassigned_at?: string | null
          reassigned_by?: string | null
          reassigned_from_id?: string | null
          reassignment_reason?: string | null
          shift_date?: string
          sick_reason?: string | null
          start_time?: string
          status?: string
          template_id?: string | null
          unpaid_break_minutes?: number
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rota_shifts_acceptance_decided_by_fkey"
            columns: ["acceptance_decided_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rota_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shifts_original_employee_id_fkey"
            columns: ["original_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shifts_reassigned_by_fkey"
            columns: ["reassigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rota_shifts_reassigned_from_id_fkey"
            columns: ["reassigned_from_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "rota_shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "rota_shift_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rota_shifts_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "rota_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      rota_weeks: {
        Row: {
          created_at: string
          has_unpublished_changes: boolean
          id: string
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          has_unpublished_changes?: boolean
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          has_unpublished_changes?: boolean
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rota_weeks_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      service_slot_config: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          created_at: string | null
          day_of_week: number
          ends_at: string
          id: string
          is_active: boolean | null
          slot_type: string
          starts_at: string
          updated_at: string | null
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          created_at?: string | null
          day_of_week: number
          ends_at: string
          id?: string
          is_active?: boolean | null
          slot_type: string
          starts_at: string
          updated_at?: string | null
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          created_at?: string | null
          day_of_week?: number
          ends_at?: string
          id?: string
          is_active?: boolean | null
          slot_type?: string
          starts_at?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      service_slot_overrides: {
        Row: {
          created_at: string | null
          custom_capacity: number | null
          custom_hours: Json | null
          id: string
          is_closed: boolean | null
          override_date: string
          reason: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          custom_capacity?: number | null
          custom_hours?: Json | null
          id?: string
          is_closed?: boolean | null
          override_date: string
          reason?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          custom_capacity?: number | null
          custom_hours?: Json | null
          id?: string
          is_closed?: boolean | null
          override_date?: string
          reason?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      service_slots: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          created_at: string
          ends_at: string
          id: string
          is_active: boolean
          service_date: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          created_at?: string
          ends_at: string
          id?: string
          is_active?: boolean
          service_date: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          created_at?: string
          ends_at?: string
          id?: string
          is_active?: boolean
          service_date?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_status_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_enabled: boolean
          message: string | null
          service_code: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          is_enabled?: boolean
          message?: string | null
          service_code: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          is_enabled?: boolean
          message?: string | null
          service_code?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_status_overrides_service_code_fkey"
            columns: ["service_code"]
            isOneToOne: false
            referencedRelation: "service_statuses"
            referencedColumns: ["service_code"]
          },
        ]
      }
      service_statuses: {
        Row: {
          display_name: string
          is_enabled: boolean
          message: string | null
          metadata: Json
          service_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          display_name: string
          is_enabled?: boolean
          message?: string | null
          metadata?: Json
          service_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          display_name?: string
          is_enabled?: boolean
          message?: string | null
          metadata?: Json
          service_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      settings_revisions: {
        Row: {
          revision: number
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          revision?: number
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          revision?: number
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      short_link_aliases: {
        Row: {
          alias_code: string
          created_at: string
          created_by: string | null
          short_link_id: string
        }
        Insert: {
          alias_code: string
          created_at?: string
          created_by?: string | null
          short_link_id: string
        }
        Update: {
          alias_code?: string
          created_at?: string
          created_by?: string | null
          short_link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_link_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_link_aliases_short_link_id_fkey"
            columns: ["short_link_id"]
            isOneToOne: false
            referencedRelation: "short_link_daily_stats"
            referencedColumns: ["short_link_id"]
          },
          {
            foreignKeyName: "short_link_aliases_short_link_id_fkey"
            columns: ["short_link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      short_link_clicks: {
        Row: {
          browser: string | null
          city: string | null
          clicked_at: string | null
          country: string | null
          device_type: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          os: string | null
          referrer: string | null
          region: string | null
          request_host: string | null
          short_link_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          request_host?: string | null
          short_link_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          request_host?: string | null
          short_link_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "short_link_clicks_short_link_id_fkey"
            columns: ["short_link_id"]
            isOneToOne: false
            referencedRelation: "short_link_daily_stats"
            referencedColumns: ["short_link_id"]
          },
          {
            foreignKeyName: "short_link_clicks_short_link_id_fkey"
            columns: ["short_link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          click_count: number | null
          created_at: string | null
          created_by: string | null
          destination_url: string
          expires_at: string | null
          id: string
          last_clicked_at: string | null
          link_type: string
          metadata: Json | null
          name: string | null
          parent_link_id: string | null
          short_code: string
          updated_at: string | null
        }
        Insert: {
          click_count?: number | null
          created_at?: string | null
          created_by?: string | null
          destination_url: string
          expires_at?: string | null
          id?: string
          last_clicked_at?: string | null
          link_type: string
          metadata?: Json | null
          name?: string | null
          parent_link_id?: string | null
          short_code: string
          updated_at?: string | null
        }
        Update: {
          click_count?: number | null
          created_at?: string | null
          created_by?: string | null
          destination_url?: string
          expires_at?: string | null
          id?: string
          last_clicked_at?: string | null
          link_type?: string
          metadata?: Json | null
          name?: string | null
          parent_link_id?: string | null
          short_code?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "short_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_links_parent_link_id_fkey"
            columns: ["parent_link_id"]
            isOneToOne: false
            referencedRelation: "short_link_daily_stats"
            referencedColumns: ["short_link_id"]
          },
          {
            foreignKeyName: "short_links_parent_link_id_fkey"
            columns: ["parent_link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          admin_email: string | null
          advance_booking_days: number
          auto_confirm_bookings: boolean
          booking_duration_mins: number
          cc_email: string | null
          created_at: string
          currency: string
          default_party_size: number
          deposit_amount: number
          email: string | null
          id: string
          min_group_size_deposit: number
          name: string
          online_bookings_enabled: boolean
          phone: string | null
          reminder_hours_before: number
          sms_notifications_enabled: boolean
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          admin_email?: string | null
          advance_booking_days?: number
          auto_confirm_bookings?: boolean
          booking_duration_mins?: number
          cc_email?: string | null
          created_at?: string
          currency?: string
          default_party_size?: number
          deposit_amount?: number
          email?: string | null
          id?: string
          min_group_size_deposit?: number
          name: string
          online_bookings_enabled?: boolean
          phone?: string | null
          reminder_hours_before?: number
          sms_notifications_enabled?: boolean
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          admin_email?: string | null
          advance_booking_days?: number
          auto_confirm_bookings?: boolean
          booking_duration_mins?: number
          cc_email?: string | null
          created_at?: string
          currency?: string
          default_party_size?: number
          deposit_amount?: number
          email?: string | null
          id?: string
          min_group_size_deposit?: number
          name?: string
          online_bookings_enabled?: boolean
          phone?: string | null
          reminder_hours_before?: number
          sms_notifications_enabled?: boolean
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      sms_promo_context: {
        Row: {
          booking_created: boolean | null
          booking_created_at: string | null
          created_at: string | null
          customer_id: string
          event_id: string
          id: string
          inbound_message_id: string | null
          inbound_twilio_message_sid: string | null
          message_id: string | null
          phone_number: string
          reply_window_expires_at: string
          template_key: string
        }
        Insert: {
          booking_created?: boolean | null
          booking_created_at?: string | null
          created_at?: string | null
          customer_id: string
          event_id: string
          id?: string
          inbound_message_id?: string | null
          inbound_twilio_message_sid?: string | null
          message_id?: string | null
          phone_number: string
          reply_window_expires_at: string
          template_key: string
        }
        Update: {
          booking_created?: boolean | null
          booking_created_at?: string | null
          created_at?: string | null
          customer_id?: string
          event_id?: string
          id?: string
          inbound_message_id?: string | null
          inbound_twilio_message_sid?: string | null
          message_id?: string | null
          phone_number?: string
          reply_window_expires_at?: string
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_promo_context_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sms_promo_context_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_promo_context_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_promo_context_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_promo_context_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_promo_context_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      special_hours: {
        Row: {
          closes: string | null
          created_at: string | null
          date: string
          id: string
          is_closed: boolean | null
          is_kitchen_closed: boolean | null
          kitchen_closes: string | null
          kitchen_opens: string | null
          kitchen_pace_covers: number | null
          kitchen_walk_in_reserve: number | null
          note: string | null
          opens: string | null
          schedule_config: Json | null
          updated_at: string | null
        }
        Insert: {
          closes?: string | null
          created_at?: string | null
          date: string
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          kitchen_pace_covers?: number | null
          kitchen_walk_in_reserve?: number | null
          note?: string | null
          opens?: string | null
          schedule_config?: Json | null
          updated_at?: string | null
        }
        Update: {
          closes?: string | null
          created_at?: string | null
          date?: string
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          kitchen_pace_covers?: number | null
          kitchen_walk_in_reserve?: number | null
          note?: string | null
          opens?: string | null
          schedule_config?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sunday_lunch_menu_items: {
        Row: {
          allergens: string[] | null
          category: string
          created_at: string | null
          description: string | null
          dietary_info: string[] | null
          display_order: number
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string | null
        }
        Insert: {
          allergens?: string[] | null
          category: string
          created_at?: string | null
          description?: string | null
          dietary_info?: string[] | null
          display_order?: number
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          updated_at?: string | null
        }
        Update: {
          allergens?: string[] | null
          category?: string
          created_at?: string | null
          description?: string | null
          dietary_info?: string[] | null
          display_order?: number
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string | null
          description: string | null
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      table_areas: {
        Row: {
          created_at: string
          id: string
          name: string
          normalized_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          normalized_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      table_booking_confirm_reminders: {
        Row: {
          id: string
          sent_at: string
          table_booking_id: string
        }
        Insert: {
          id?: string
          sent_at?: string
          table_booking_id: string
        }
        Update: {
          id?: string
          sent_at?: string
          table_booking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_booking_confirm_reminders_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: true
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_confirm_reminders_table_booking_id_fkey"
            columns: ["table_booking_id"]
            isOneToOne: true
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      table_booking_items: {
        Row: {
          booking_id: string
          created_at: string | null
          custom_item_name: string | null
          guest_name: string | null
          id: string
          item_type: Database["public"]["Enums"]["booking_item_type"]
          menu_dish_id: string | null
          menu_item_id: string | null
          price_at_booking: number
          quantity: number
          special_requests: string | null
          updated_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          custom_item_name?: string | null
          guest_name?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["booking_item_type"]
          menu_dish_id?: string | null
          menu_item_id?: string | null
          price_at_booking: number
          quantity?: number
          special_requests?: string | null
          updated_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          custom_item_name?: string | null
          guest_name?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["booking_item_type"]
          menu_dish_id?: string | null
          menu_item_id?: string | null
          price_at_booking?: number
          quantity?: number
          special_requests?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_items_menu_dish_id_fkey"
            columns: ["menu_dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_items_menu_dish_id_fkey"
            columns: ["menu_dish_id"]
            isOneToOne: false
            referencedRelation: "menu_dishes_with_costs"
            referencedColumns: ["dish_id"]
          },
        ]
      }
      table_booking_modifications: {
        Row: {
          booking_id: string
          created_at: string | null
          id: string
          modification_type: string
          modified_by: string | null
          new_values: Json | null
          old_values: Json | null
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          id?: string
          modification_type: string
          modified_by?: string | null
          new_values?: Json | null
          old_values?: Json | null
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          id?: string
          modification_type?: string
          modified_by?: string | null
          new_values?: Json | null
          old_values?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "table_booking_modifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_modifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      table_booking_payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string | null
          currency: string | null
          id: string
          paid_at: string | null
          payment_metadata: Json | null
          payment_method: string
          refund_amount: number | null
          refund_transaction_id: string | null
          refunded_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          transaction_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string | null
          currency?: string | null
          id?: string
          paid_at?: string | null
          payment_metadata?: Json | null
          payment_method?: string
          refund_amount?: number | null
          refund_transaction_id?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          paid_at?: string | null
          payment_metadata?: Json | null
          payment_method?: string
          refund_amount?: number | null
          refund_transaction_id?: string | null
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      table_booking_reminder_history: {
        Row: {
          booking_id: string
          created_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          reminder_type: string
          sent_at: string | null
          status: string
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          reminder_type: string
          sent_at?: string | null
          status: string
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          reminder_type?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_booking_reminder_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_booking_reminder_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings_awaiting_confirmation"
            referencedColumns: ["id"]
          },
        ]
      }
      table_booking_sms_templates: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          template_key: string
          template_text: string
          updated_at: string | null
          variables: string[] | null
        }
        Insert: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          template_key: string
          template_text: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Update: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          template_key?: string
          template_text?: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Relationships: []
      }
      table_bookings: {
        Row: {
          allergies: string[] | null
          assignment_soft: boolean
          booking_date: string
          booking_period_answer: boolean | null
          booking_period_code: string | null
          booking_period_id: string | null
          booking_period_name: string | null
          booking_period_requires_preorder: boolean | null
          booking_purpose: string
          booking_reference: string
          booking_time: string
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          card_capture_completed_at: string | null
          celebration_type: string | null
          committed_party_size: number
          completed_at: string | null
          confirmed_at: string | null
          correlation_id: string | null
          created_at: string | null
          customer_id: string | null
          deposit_amount: number | null
          deposit_amount_locked: number | null
          deposit_basis: string | null
          deposit_rate: number | null
          deposit_refund_cutoff_days: number | null
          deposit_refund_policy: string | null
          deposit_refund_status: string | null
          deposit_rule: string | null
          deposit_waived: boolean
          dietary_requirements: string[] | null
          duration_minutes: number | null
          email_verification_token: string | null
          email_verified_at: string | null
          end_datetime: string | null
          event_booking_id: string | null
          event_id: string | null
          guest_confirmed_at: string | null
          high_chair_count: number
          hold_expires_at: string | null
          id: string
          internal_notes: string | null
          is_outside_seating: boolean
          is_venue_event: boolean
          left_at: string | null
          modification_count: number | null
          no_show_at: string | null
          no_show_marked_at: string | null
          no_show_marked_by: string | null
          original_booking_data: Json | null
          party_size: number
          payment_method:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          paypal_deposit_capture_id: string | null
          paypal_deposit_order_id: string | null
          reminder_sent: boolean | null
          requires_accessible_table: boolean
          review_clicked_at: string | null
          review_sms_sent_at: string | null
          review_suppressed_at: string | null
          seated_at: string | null
          source: string | null
          special_requirements: string | null
          start_datetime: string | null
          status: Database["public"]["Enums"]["table_booking_status"]
          sunday_preorder_completed_at: string | null
          sunday_preorder_cutoff_at: string | null
          table_pinned: boolean
          tables_assigned: Json | null
          updated_at: string | null
        }
        Insert: {
          allergies?: string[] | null
          assignment_soft?: boolean
          booking_date: string
          booking_period_answer?: boolean | null
          booking_period_code?: string | null
          booking_period_id?: string | null
          booking_period_name?: string | null
          booking_period_requires_preorder?: boolean | null
          booking_purpose?: string
          booking_reference: string
          booking_time: string
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          card_capture_completed_at?: string | null
          celebration_type?: string | null
          committed_party_size: number
          completed_at?: string | null
          confirmed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          deposit_amount?: number | null
          deposit_amount_locked?: number | null
          deposit_basis?: string | null
          deposit_rate?: number | null
          deposit_refund_cutoff_days?: number | null
          deposit_refund_policy?: string | null
          deposit_refund_status?: string | null
          deposit_rule?: string | null
          deposit_waived?: boolean
          dietary_requirements?: string[] | null
          duration_minutes?: number | null
          email_verification_token?: string | null
          email_verified_at?: string | null
          end_datetime?: string | null
          event_booking_id?: string | null
          event_id?: string | null
          guest_confirmed_at?: string | null
          high_chair_count?: number
          hold_expires_at?: string | null
          id?: string
          internal_notes?: string | null
          is_outside_seating?: boolean
          is_venue_event?: boolean
          left_at?: string | null
          modification_count?: number | null
          no_show_at?: string | null
          no_show_marked_at?: string | null
          no_show_marked_by?: string | null
          original_booking_data?: Json | null
          party_size: number
          payment_method?:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          paypal_deposit_capture_id?: string | null
          paypal_deposit_order_id?: string | null
          reminder_sent?: boolean | null
          requires_accessible_table?: boolean
          review_clicked_at?: string | null
          review_sms_sent_at?: string | null
          review_suppressed_at?: string | null
          seated_at?: string | null
          source?: string | null
          special_requirements?: string | null
          start_datetime?: string | null
          status?: Database["public"]["Enums"]["table_booking_status"]
          sunday_preorder_completed_at?: string | null
          sunday_preorder_cutoff_at?: string | null
          table_pinned?: boolean
          tables_assigned?: Json | null
          updated_at?: string | null
        }
        Update: {
          allergies?: string[] | null
          assignment_soft?: boolean
          booking_date?: string
          booking_period_answer?: boolean | null
          booking_period_code?: string | null
          booking_period_id?: string | null
          booking_period_name?: string | null
          booking_period_requires_preorder?: boolean | null
          booking_purpose?: string
          booking_reference?: string
          booking_time?: string
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          card_capture_completed_at?: string | null
          celebration_type?: string | null
          committed_party_size?: number
          completed_at?: string | null
          confirmed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          deposit_amount?: number | null
          deposit_amount_locked?: number | null
          deposit_basis?: string | null
          deposit_rate?: number | null
          deposit_refund_cutoff_days?: number | null
          deposit_refund_policy?: string | null
          deposit_refund_status?: string | null
          deposit_rule?: string | null
          deposit_waived?: boolean
          dietary_requirements?: string[] | null
          duration_minutes?: number | null
          email_verification_token?: string | null
          email_verified_at?: string | null
          end_datetime?: string | null
          event_booking_id?: string | null
          event_id?: string | null
          guest_confirmed_at?: string | null
          high_chair_count?: number
          hold_expires_at?: string | null
          id?: string
          internal_notes?: string | null
          is_outside_seating?: boolean
          is_venue_event?: boolean
          left_at?: string | null
          modification_count?: number | null
          no_show_at?: string | null
          no_show_marked_at?: string | null
          no_show_marked_by?: string | null
          original_booking_data?: Json | null
          party_size?: number
          payment_method?:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          paypal_deposit_capture_id?: string | null
          paypal_deposit_order_id?: string | null
          reminder_sent?: boolean | null
          requires_accessible_table?: boolean
          review_clicked_at?: string | null
          review_sms_sent_at?: string | null
          review_suppressed_at?: string | null
          seated_at?: string | null
          source?: string | null
          special_requirements?: string | null
          start_datetime?: string | null
          status?: Database["public"]["Enums"]["table_booking_status"]
          sunday_preorder_completed_at?: string | null
          sunday_preorder_cutoff_at?: string | null
          table_pinned?: boolean
          tables_assigned?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_bookings_booking_period_id_fkey"
            columns: ["booking_period_id"]
            isOneToOne: false
            referencedRelation: "booking_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_bookings_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_bookings_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "reminder_timing_debug"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "table_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      table_combination_tables: {
        Row: {
          combination_id: string
          created_at: string | null
          id: string
          table_id: string
        }
        Insert: {
          combination_id: string
          created_at?: string | null
          id?: string
          table_id: string
        }
        Update: {
          combination_id?: string
          created_at?: string | null
          id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_combination_tables_combination_id_fkey"
            columns: ["combination_id"]
            isOneToOne: false
            referencedRelation: "table_combinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_combination_tables_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "table_configuration"
            referencedColumns: ["id"]
          },
        ]
      }
      table_combinations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string | null
          preferred_for_size: number[] | null
          table_ids: string[]
          total_capacity: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          preferred_for_size?: number[] | null
          table_ids: string[]
          total_capacity: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          preferred_for_size?: number[] | null
          table_ids?: string[]
          total_capacity?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      table_configuration: {
        Row: {
          capacity: number
          created_at: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          table_number: string
          updated_at: string | null
        }
        Insert: {
          capacity: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          table_number: string
          updated_at?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          table_number?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      table_holds: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          day_of_week: number | null
          ends_at: string
          ends_on: string | null
          hold_type: string
          id: string
          note: string | null
          scope: string
          starts_at: string
          starts_on: string
          status: string
          table_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          ends_at?: string
          ends_on?: string | null
          hold_type: string
          id?: string
          note?: string | null
          scope?: string
          starts_at?: string
          starts_on: string
          status?: string
          table_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          ends_at?: string
          ends_on?: string | null
          hold_type?: string
          id?: string
          note?: string | null
          scope?: string
          starts_at?: string
          starts_on?: string
          status?: string
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_holds_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_join_group_members: {
        Row: {
          group_id: string
          table_id: string
        }
        Insert: {
          group_id: string
          table_id: string
        }
        Update: {
          group_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_join_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "table_join_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_join_group_members_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_join_groups: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      table_join_links: {
        Row: {
          created_at: string
          created_by: string | null
          join_table_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          join_table_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          join_table_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_join_links_join_table_id_fkey"
            columns: ["join_table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_join_links_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          area: string | null
          area_id: string | null
          bar_priority: number
          capacity: number
          created_at: string | null
          heated: boolean
          high_chair_capable: boolean
          id: string
          is_active: boolean | null
          is_bookable: boolean
          min_party_size: number
          name: string | null
          notes: string | null
          priority: number
          standard_height: boolean
          step_free: boolean
          table_number: string
          updated_at: string | null
        }
        Insert: {
          area?: string | null
          area_id?: string | null
          bar_priority?: number
          capacity: number
          created_at?: string | null
          heated?: boolean
          high_chair_capable?: boolean
          id?: string
          is_active?: boolean | null
          is_bookable?: boolean
          min_party_size?: number
          name?: string | null
          notes?: string | null
          priority?: number
          standard_height?: boolean
          step_free?: boolean
          table_number: string
          updated_at?: string | null
        }
        Update: {
          area?: string | null
          area_id?: string | null
          bar_priority?: number
          capacity?: number
          created_at?: string | null
          heated?: boolean
          high_chair_capable?: boolean
          id?: string
          is_active?: boolean | null
          is_bookable?: boolean
          min_party_size?: number
          name?: string | null
          notes?: string | null
          priority?: number
          standard_height?: boolean
          step_free?: boolean
          table_number?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tables_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "table_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_versions: {
        Row: {
          clauses: Json
          created_at: string
          effective_from: string
          published_by: string | null
          version: string
        }
        Insert: {
          clauses: Json
          created_at?: string
          effective_from: string
          published_by?: string | null
          version: string
        }
        Update: {
          clauses?: Json
          created_at?: string
          effective_from?: string
          published_by?: string | null
          version?: string
        }
        Relationships: []
      }
      timeclock_sessions: {
        Row: {
          auto_close_reason: string | null
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          employee_id: string
          id: string
          is_auto_close: boolean
          is_reviewed: boolean
          is_unscheduled: boolean
          linked_shift_id: string | null
          manager_note: string | null
          notes: string | null
          premium_end_at: string | null
          premium_reason: string | null
          premium_start_at: string | null
          rate_multiplier: number | null
          rate_override: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          work_date: string
        }
        Insert: {
          auto_close_reason?: string | null
          clock_in_at: string
          clock_out_at?: string | null
          created_at?: string
          employee_id: string
          id?: string
          is_auto_close?: boolean
          is_reviewed?: boolean
          is_unscheduled?: boolean
          linked_shift_id?: string | null
          manager_note?: string | null
          notes?: string | null
          premium_end_at?: string | null
          premium_reason?: string | null
          premium_start_at?: string | null
          rate_multiplier?: number | null
          rate_override?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          work_date: string
        }
        Update: {
          auto_close_reason?: string | null
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          is_auto_close?: boolean
          is_reviewed?: boolean
          is_unscheduled?: boolean
          linked_shift_id?: string | null
          manager_note?: string | null
          notes?: string | null
          premium_end_at?: string | null
          premium_reason?: string | null
          premium_start_at?: string | null
          rate_multiplier?: number | null
          rate_override?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeclock_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "timeclock_sessions_linked_shift_id_fkey"
            columns: ["linked_shift_id"]
            isOneToOne: false
            referencedRelation: "rota_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeclock_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      unmatched_communications: {
        Row: {
          attachments: Json | null
          body_html: string | null
          body_text: string | null
          candidate_customer_ids: string[]
          channel: string
          created_at: string
          direction: string
          from_address: string | null
          id: string
          linked_customer_id: string | null
          linked_email_message_id: string | null
          linked_message_id: string | null
          raw_payload: Json
          received_at: string
          resend_message_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string | null
          to_address: string | null
          twilio_message_sid: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          candidate_customer_ids?: string[]
          channel: string
          created_at?: string
          direction?: string
          from_address?: string | null
          id?: string
          linked_customer_id?: string | null
          linked_email_message_id?: string | null
          linked_message_id?: string | null
          raw_payload?: Json
          received_at?: string
          resend_message_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          candidate_customer_ids?: string[]
          channel?: string
          created_at?: string
          direction?: string
          from_address?: string | null
          id?: string
          linked_customer_id?: string | null
          linked_email_message_id?: string | null
          linked_message_id?: string | null
          raw_payload?: Json
          received_at?: string
          resend_message_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_communications_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "unmatched_communications_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_communications_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_communications_linked_email_message_id_fkey"
            columns: ["linked_email_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_communications_linked_message_id_fkey"
            columns: ["linked_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_communications_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_contacts: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          is_primary: boolean | null
          name: string
          phone: string | null
          receives_invoices: boolean | null
          receives_statements: boolean | null
          role: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name: string
          phone?: string | null
          receives_invoices?: boolean | null
          receives_statements?: boolean | null
          role?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name?: string
          phone?: string | null
          receives_invoices?: boolean | null
          receives_statements?: boolean | null
          role?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          active: boolean | null
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          credit_limit: number | null
          id: string
          invoice_categories: string[] | null
          invoice_contact_name: string | null
          invoice_email: string | null
          name: string
          notes: string | null
          payment_terms: number | null
          preferred: boolean | null
          preferred_delivery_method: string | null
          purchase_order_required: boolean | null
          service_type: string
          tax_exempt: boolean | null
          tax_exempt_number: string | null
          typical_rate: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          active?: boolean | null
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          credit_limit?: number | null
          id?: string
          invoice_categories?: string[] | null
          invoice_contact_name?: string | null
          invoice_email?: string | null
          name: string
          notes?: string | null
          payment_terms?: number | null
          preferred?: boolean | null
          preferred_delivery_method?: string | null
          purchase_order_required?: boolean | null
          service_type: string
          tax_exempt?: boolean | null
          tax_exempt_number?: string | null
          typical_rate?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          active?: boolean | null
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          credit_limit?: number | null
          id?: string
          invoice_categories?: string[] | null
          invoice_contact_name?: string | null
          invoice_email?: string | null
          name?: string
          notes?: string | null
          payment_terms?: number | null
          preferred?: boolean | null
          preferred_delivery_method?: string | null
          purchase_order_required?: boolean | null
          service_type?: string
          tax_exempt?: boolean | null
          tax_exempt_number?: string | null
          typical_rate?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      venue_space_table_areas: {
        Row: {
          created_at: string
          id: string
          table_area_id: string
          venue_space_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          table_area_id: string
          venue_space_id: string
        }
        Update: {
          created_at?: string
          id?: string
          table_area_id?: string
          venue_space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_space_table_areas_table_area_id_fkey"
            columns: ["table_area_id"]
            isOneToOne: false
            referencedRelation: "table_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_space_table_areas_venue_space_id_fkey"
            columns: ["venue_space_id"]
            isOneToOne: false
            referencedRelation: "venue_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_spaces: {
        Row: {
          active: boolean | null
          blocks_all_spaces: boolean
          capacity_seated: number | null
          capacity_standing: number | null
          created_at: string
          description: string | null
          display_order: number | null
          id: string
          minimum_hours: number | null
          name: string
          rate_per_hour: number
          setup_fee: number | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          active?: boolean | null
          blocks_all_spaces?: boolean
          capacity_seated?: number | null
          capacity_standing?: number | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          minimum_hours?: number | null
          name: string
          rate_per_hour: number
          setup_fee?: number | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          active?: boolean | null
          blocks_all_spaces?: boolean
          capacity_seated?: number | null
          capacity_standing?: number | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          minimum_hours?: number | null
          name?: string
          rate_per_hour?: number
          setup_fee?: number | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      voucher_batches: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string
          id: string
          note: string | null
          pdf_bytes: number | null
          pdf_pages: number | null
          pdf_path: string | null
          pdf_status: string
          render_attempts: number
          render_error: string | null
          terms_version: string
          total_count: number
          type_definitions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name: string
          id?: string
          note?: string | null
          pdf_bytes?: number | null
          pdf_pages?: number | null
          pdf_path?: string | null
          pdf_status?: string
          render_attempts?: number
          render_error?: string | null
          terms_version: string
          total_count: number
          type_definitions: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          id?: string
          note?: string | null
          pdf_bytes?: number | null
          pdf_pages?: number | null
          pdf_path?: string | null
          pdf_status?: string
          render_attempts?: number
          render_error?: string | null
          terms_version?: string
          total_count?: number
          type_definitions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_batches_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "terms_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      voucher_events: {
        Row: {
          action: string
          actor_employee_id: string | null
          actor_name: string
          actor_user_id: string | null
          at: string
          detail: Json | null
          id: string
          source: string
          voucher_id: string
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          actor_name: string
          actor_user_id?: string | null
          at?: string
          detail?: Json | null
          id?: string
          source: string
          voucher_id: string
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          actor_name?: string
          actor_user_id?: string | null
          at?: string
          detail?: Json | null
          id?: string
          source?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_events_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_number_counters: {
        Row: {
          last_seq: number
          month_key: string
        }
        Insert: {
          last_seq?: number
          month_key: string
        }
        Update: {
          last_seq?: number
          month_key?: string
        }
        Relationships: []
      }
      voucher_reminders: {
        Row: {
          attempts: number
          channel: string | null
          created_at: string
          customer_id: string | null
          id: string
          last_error: string | null
          message_sid: string | null
          reminder_kind: string
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
          voucher_id: string
        }
        Insert: {
          attempts?: number
          channel?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          message_sid?: string | null
          reminder_kind: string
          scheduled_for: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          voucher_id: string
        }
        Update: {
          attempts?: number
          channel?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          message_sid?: string | null
          reminder_kind?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voucher_reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_reminders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_reminders_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_types: {
        Row: {
          active: boolean
          alcohol: boolean
          copy: Json
          cover_title: string
          created_at: string
          display_title: string
          entitlement_html: string
          hero: Json
          id: string
          requires_booking: boolean
          sort_order: number
          updated_at: string
          value_pence: number | null
        }
        Insert: {
          active?: boolean
          alcohol: boolean
          copy: Json
          cover_title: string
          created_at?: string
          display_title: string
          entitlement_html: string
          hero: Json
          id: string
          requires_booking: boolean
          sort_order: number
          updated_at?: string
          value_pence?: number | null
        }
        Update: {
          active?: boolean
          alcohol?: boolean
          copy?: Json
          cover_title?: string
          created_at?: string
          display_title?: string
          entitlement_html?: string
          hero?: Json
          id?: string
          requires_booking?: boolean
          sort_order?: number
          updated_at?: string
          value_pence?: number | null
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          batch_id: string
          booking_ref: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          created_at: string
          customer_id: string | null
          event_id: string | null
          expiry_date: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          issued_by_name: string | null
          issued_by_user_id: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          redeemed_by_name: string | null
          redeemed_by_user_id: string | null
          replaced_by_id: string | null
          replaces_id: string | null
          status: string
          terms_version: string
          transaction_ref: string | null
          type_id: string
          updated_at: string
          value_pence: number | null
          voucher_number: string
          won_at_label: string | null
        }
        Insert: {
          batch_id: string
          booking_ref?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          customer_id?: string | null
          event_id?: string | null
          expiry_date?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          issued_by_name?: string | null
          issued_by_user_id?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          redeemed_by_name?: string | null
          redeemed_by_user_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          status: string
          terms_version: string
          transaction_ref?: string | null
          type_id: string
          updated_at?: string
          value_pence?: number | null
          voucher_number: string
          won_at_label?: string | null
        }
        Update: {
          batch_id?: string
          booking_ref?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          customer_id?: string | null
          event_id?: string | null
          expiry_date?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          issued_by_name?: string | null
          issued_by_user_id?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          redeemed_by_name?: string | null
          redeemed_by_user_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          status?: string
          terms_version?: string
          transaction_ref?: string | null
          type_id?: string
          updated_at?: string
          value_pence?: number | null
          voucher_number?: string
          won_at_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "voucher_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "vouchers_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "vouchers_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "terms_versions"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "vouchers_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "voucher_types"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          customer_id: string
          event_id: string
          expired_at: string | null
          id: string
          offered_at: string | null
          requested_seats: number
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id: string
          event_id: string
          expired_at?: string | null
          id?: string
          offered_at?: string | null
          requested_seats: number
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string
          event_id?: string
          expired_at?: string | null
          id?: string
          offered_at?: string | null
          requested_seats?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "waitlist_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_offers: {
        Row: {
          accepted_at: string | null
          created_at: string
          customer_id: string
          event_id: string
          expired_at: string | null
          expires_at: string
          id: string
          scheduled_sms_send_time: string | null
          seats_held: number
          sent_at: string | null
          status: string
          waitlist_entry_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          customer_id: string
          event_id: string
          expired_at?: string | null
          expires_at: string
          id?: string
          scheduled_sms_send_time?: string | null
          seats_held: number
          sent_at?: string | null
          status?: string
          waitlist_entry_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          customer_id?: string
          event_id?: string
          expired_at?: string | null
          expires_at?: string
          id?: string
          scheduled_sms_send_time?: string | null
          seats_held?: number
          sent_at?: string | null
          status?: string
          waitlist_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_offers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "waitlist_offers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offers_waitlist_entry_id_fkey"
            columns: ["waitlist_entry_id"]
            isOneToOne: false
            referencedRelation: "waitlist_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number | null
          created_at: string | null
          delivered_at: string | null
          event_type: string
          id: string
          payload: Json
          response_body: string | null
          response_status: number | null
          webhook_id: string
        }
        Insert: {
          attempt_count?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event_type: string
          id?: string
          payload: Json
          response_body?: string | null
          response_status?: number | null
          webhook_id: string
        }
        Update: {
          attempt_count?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          body: string | null
          customer_id: string | null
          error_details: Json | null
          error_message: string | null
          from_number: string | null
          headers: Json | null
          id: string
          message_body: string | null
          message_id: string | null
          message_sid: string | null
          params: Json | null
          processed_at: string
          status: string
          to_number: string | null
          webhook_type: string
        }
        Insert: {
          body?: string | null
          customer_id?: string | null
          error_details?: Json | null
          error_message?: string | null
          from_number?: string | null
          headers?: Json | null
          id?: string
          message_body?: string | null
          message_id?: string | null
          message_sid?: string | null
          params?: Json | null
          processed_at?: string
          status: string
          to_number?: string | null
          webhook_type?: string
        }
        Update: {
          body?: string | null
          customer_id?: string | null
          error_details?: Json | null
          error_message?: string | null
          from_number?: string | null
          headers?: Json | null
          id?: string
          message_body?: string | null
          message_id?: string | null
          message_sid?: string | null
          params?: Json | null
          processed_at?: string
          status?: string
          to_number?: string | null
          webhook_type?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          created_at: string | null
          events: Json | null
          failure_count: number | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          secret: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          events?: Json | null
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          secret?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          events?: Json | null
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          secret?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_users_view: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          last_sign_in_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_sign_in_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_sign_in_at?: string | null
        }
        Relationships: []
      }
      cashup_weekly_view: {
        Row: {
          session_date: string | null
          site_id: string | null
          status: string | null
          total_counted_amount: number | null
          total_expected_amount: number | null
          total_variance_amount: number | null
          week_start_date: string | null
        }
        Insert: {
          session_date?: string | null
          site_id?: string | null
          status?: string | null
          total_counted_amount?: number | null
          total_expected_amount?: number | null
          total_variance_amount?: number | null
          week_start_date?: never
        }
        Update: {
          session_date?: string | null
          site_id?: string | null
          status?: string | null
          total_counted_amount?: number | null
          total_expected_amount?: number | null
          total_variance_amount?: number | null
          week_start_date?: never
        }
        Relationships: [
          {
            foreignKeyName: "cashup_sessions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communications: {
        Row: {
          attachments: Json | null
          body_html: string | null
          body_text: string | null
          bounced_at: string | null
          channel: string | null
          clicked_at: string | null
          context: Json | null
          cost: number | null
          created_at: string | null
          customer_id: string | null
          delivered_at: string | null
          delivery_history: Json | null
          direction: string | null
          engagement: Json | null
          failed_at: string | null
          from_address: string | null
          has_attachments: boolean | null
          id: string | null
          opened_at: string | null
          read_at: string | null
          replied_at: string | null
          resend_message_id: string | null
          segments: number | null
          sent_at: string | null
          staff_read_at: string | null
          status: string | null
          subject: string | null
          to_address: string | null
          twilio_message_sid: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      customer_consent_legacy_gaps: {
        Row: {
          channel: string | null
          customer_id: string | null
          email: string | null
          first_name: string | null
          last_name: string | null
          mobile_number: string | null
          purpose: string | null
          summary_field: string | null
          summary_value: boolean | null
        }
        Relationships: []
      }
      customer_messaging_health: {
        Row: {
          consecutive_failures: number | null
          delivery_rate: number | null
          first_name: string | null
          id: string | null
          last_failure_type: string | null
          last_message_date: string | null
          last_name: string | null
          last_successful_delivery: string | null
          messages_delivered: number | null
          messages_failed: number | null
          messaging_status: string | null
          mobile_number: string | null
          sms_opt_in: boolean | null
          total_cost_usd: number | null
          total_failures_30d: number | null
          total_messages_sent: number | null
        }
        Relationships: []
      }
      employee_version_history: {
        Row: {
          created_at: string | null
          employee_id: string | null
          employee_name: string | null
          id: string | null
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          operation_type: string | null
          user_email: string | null
          user_id: string | null
          version_number: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dishes_with_costs: {
        Row: {
          allergen_flags: string[] | null
          allergen_verified: boolean | null
          allergen_verified_at: string | null
          available_from: string | null
          available_until: string | null
          calories: number | null
          category_code: string | null
          category_id: string | null
          category_name: string | null
          description: string | null
          dietary_flags: string[] | null
          dish_id: string | null
          gp_pct: number | null
          image_url: string | null
          is_active: boolean | null
          is_default_side: boolean | null
          is_gp_alert: boolean | null
          is_modifiable_for: Json | null
          is_special: boolean | null
          is_sunday_lunch: boolean | null
          menu_code: string | null
          menu_id: string | null
          menu_name: string | null
          name: string | null
          new_from: string | null
          new_until: string | null
          notes: string | null
          portion_cost: number | null
          removable_allergens: string[] | null
          selling_price: number | null
          slug: string | null
          sort_order: number | null
          target_gp_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_dish_menu_assignments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_dish_menu_assignments_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menu_menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_ingredients_with_prices: {
        Row: {
          abv: number | null
          allergens: string[] | null
          brand: string | null
          created_at: string | null
          default_unit: Database["public"]["Enums"]["menu_unit"] | null
          description: string | null
          dietary_flags: string[] | null
          id: string | null
          is_active: boolean | null
          latest_pack_cost: number | null
          latest_price_effective_from: string | null
          latest_unit_cost: number | null
          name: string | null
          notes: string | null
          pack_cost: number | null
          pack_size: number | null
          pack_size_unit: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack: number | null
          purchase_department: string | null
          shelf_life_days: number | null
          storage_type: Database["public"]["Enums"]["menu_storage_type"] | null
          supplier_name: string | null
          supplier_sku: string | null
          updated_at: string | null
          wastage_pct: number | null
        }
        Insert: {
          abv?: number | null
          allergens?: string[] | null
          brand?: string | null
          created_at?: string | null
          default_unit?: Database["public"]["Enums"]["menu_unit"] | null
          description?: string | null
          dietary_flags?: string[] | null
          id?: string | null
          is_active?: boolean | null
          latest_pack_cost?: never
          latest_price_effective_from?: never
          latest_unit_cost?: never
          name?: string | null
          notes?: string | null
          pack_cost?: number | null
          pack_size?: number | null
          pack_size_unit?: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack?: number | null
          purchase_department?: string | null
          shelf_life_days?: number | null
          storage_type?: Database["public"]["Enums"]["menu_storage_type"] | null
          supplier_name?: string | null
          supplier_sku?: string | null
          updated_at?: string | null
          wastage_pct?: number | null
        }
        Update: {
          abv?: number | null
          allergens?: string[] | null
          brand?: string | null
          created_at?: string | null
          default_unit?: Database["public"]["Enums"]["menu_unit"] | null
          description?: string | null
          dietary_flags?: string[] | null
          id?: string | null
          is_active?: boolean | null
          latest_pack_cost?: never
          latest_price_effective_from?: never
          latest_unit_cost?: never
          name?: string | null
          notes?: string | null
          pack_cost?: number | null
          pack_size?: number | null
          pack_size_unit?: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack?: number | null
          purchase_department?: string | null
          shelf_life_days?: number | null
          storage_type?: Database["public"]["Enums"]["menu_storage_type"] | null
          supplier_name?: string | null
          supplier_sku?: string | null
          updated_at?: string | null
          wastage_pct?: number | null
        }
        Relationships: []
      }
      message_templates_with_timing: {
        Row: {
          character_count: number | null
          content: string | null
          created_at: string | null
          created_by: string | null
          custom_timing_hours: number | null
          description: string | null
          estimated_segments: number | null
          id: string | null
          is_active: boolean | null
          is_default: boolean | null
          name: string | null
          send_timing: string | null
          template_type: string | null
          timing_description: string | null
          updated_at: string | null
          variables: string[] | null
        }
        Insert: {
          character_count?: number | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_timing_hours?: number | null
          description?: string | null
          estimated_segments?: number | null
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string | null
          send_timing?: string | null
          template_type?: string | null
          timing_description?: never
          updated_at?: string | null
          variables?: string[] | null
        }
        Update: {
          character_count?: number | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_timing_hours?: number | null
          description?: string | null
          estimated_segments?: number | null
          id?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string | null
          send_timing?: string | null
          template_type?: string | null
          timing_description?: never
          updated_at?: string | null
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      oj_project_stats: {
        Row: {
          project_id: string | null
          total_hours_used: number | null
          total_spend_ex_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "oj_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "oj_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      private_booking_sms_reminders: {
        Row: {
          balance_amount: number | null
          balance_due_date: string | null
          balance_reminder_due: string | null
          booking_id: string | null
          contact_phone: string | null
          customer_first_name: string | null
          deposit_paid_date: string | null
          event_date: string | null
          final_payment_date: string | null
          guest_count: number | null
          reminder_14d_due: string | null
          reminder_1d_due: string | null
          start_time: string | null
          status: string | null
        }
        Insert: {
          balance_amount?: never
          balance_due_date?: string | null
          balance_reminder_due?: never
          booking_id?: string | null
          contact_phone?: string | null
          customer_first_name?: string | null
          deposit_paid_date?: string | null
          event_date?: string | null
          final_payment_date?: string | null
          guest_count?: number | null
          reminder_14d_due?: never
          reminder_1d_due?: never
          start_time?: string | null
          status?: string | null
        }
        Update: {
          balance_amount?: never
          balance_due_date?: string | null
          balance_reminder_due?: never
          booking_id?: string | null
          contact_phone?: string | null
          customer_first_name?: string | null
          deposit_paid_date?: string | null
          event_date?: string | null
          final_payment_date?: string | null
          guest_count?: number | null
          reminder_14d_due?: never
          reminder_1d_due?: never
          start_time?: string | null
          status?: string | null
        }
        Relationships: []
      }
      private_booking_summary: {
        Row: {
          balance_due_date: string | null
          calculated_total: number | null
          calendar_event_id: string | null
          contact_email: string | null
          contact_phone: string | null
          contract_version: number | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_requests: string | null
          days_until_event: number | null
          deposit_amount: number | null
          deposit_paid_date: string | null
          deposit_payment_method: string | null
          deposit_status: string | null
          end_time: string | null
          event_date: string | null
          event_type: string | null
          final_payment_date: string | null
          final_payment_method: string | null
          first_name: string | null
          guest_count: number | null
          id: string | null
          internal_notes: string | null
          last_name: string | null
          setup_time: string | null
          start_time: string | null
          status: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "private_bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      private_bookings_with_details: {
        Row: {
          balance_due_date: string | null
          balance_remaining: number | null
          calculated_total: number | null
          calendar_event_id: string | null
          contact_email: string | null
          contact_phone: string | null
          contract_note: string | null
          contract_version: number | null
          created_at: string | null
          created_by: string | null
          customer_first_name: string | null
          customer_full_name: string | null
          customer_id: string | null
          customer_last_name: string | null
          customer_mobile: string | null
          customer_name: string | null
          customer_requests: string | null
          date_tbd: boolean | null
          days_until_event: number | null
          deposit_amount: number | null
          deposit_paid_date: string | null
          deposit_payment_method: string | null
          deposit_status: string | null
          discount_amount: number | null
          discount_reason: string | null
          discount_type: string | null
          end_time: string | null
          end_time_next_day: boolean | null
          event_date: string | null
          event_type: string | null
          final_payment_date: string | null
          final_payment_method: string | null
          gross_total: number | null
          guest_count: number | null
          hold_expiry: string | null
          id: string | null
          internal_notes: string | null
          payment_status: string | null
          setup_date: string | null
          setup_time: string | null
          start_time: string | null
          status: string | null
          total_amount: number | null
          total_balance_paid: number | null
          updated_at: string | null
          vat_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "private_bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_duplicate_candidates: {
        Row: {
          amount_diff_pence: number | null
          days_apart: number | null
          detail_similarity: number | null
          duplicate_transaction_id: string | null
          transaction_id: string | null
        }
        Relationships: []
      }
      recent_reminder_activity: {
        Row: {
          created_at: string | null
          customer_name: string | null
          error_details: Json | null
          event_date: string | null
          event_name: string | null
          event_time: string | null
          message: string | null
          processing_type: string | null
          reminder_type: string | null
          template_type: string | null
        }
        Relationships: []
      }
      reminder_timing_debug: {
        Row: {
          booking_id: string | null
          customer_name: string | null
          event_datetime: string | null
          event_name: string | null
          has_any_reminder_sent: boolean | null
          hours_before_event: number | null
          reminder_already_sent: boolean | null
          reminder_should_send_at: string | null
          send_status: string | null
          send_timing: string | null
          template_type: string | null
        }
        Relationships: []
      }
      short_link_daily_stats: {
        Row: {
          click_date: string | null
          desktop_clicks: number | null
          link_type: string | null
          mobile_clicks: number | null
          short_code: string | null
          short_link_id: string | null
          tablet_clicks: number | null
          total_clicks: number | null
          unique_visitors: number | null
        }
        Relationships: []
      }
      table_bookings_awaiting_confirmation: {
        Row: {
          booking_date: string | null
          booking_reference: string | null
          booking_time: string | null
          customer_id: string | null
          id: string | null
          party_size: number | null
          reminder_sent_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_consent_legacy_gaps"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_messaging_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_waitlist_offer_v05: {
        Args: { p_hashed_token: string; p_source?: string }
        Returns: Json
      }
      allocate_event_communal_seats_v01: {
        Args: {
          p_end_datetime: string
          p_event_booking_id: string
          p_event_id: string
          p_seats: number
          p_start_datetime: string
        }
        Returns: Json
      }
      allocate_event_communal_seats_v02: {
        Args: {
          p_end_datetime: string
          p_event_booking_id: string
          p_event_id: string
          p_seats: number
          p_start_datetime: string
        }
        Returns: Json
      }
      apply_balance_payment_status: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      apply_customer_labels_retroactively: { Args: never; Returns: undefined }
      apply_event_seat_increase_payment_v05: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_currency?: string
          p_event_booking_id: string
          p_payment_intent_id: string
          p_target_seats: number
        }
        Returns: Json
      }
      apply_receipt_group_classification_atomic: {
        Args: {
          p_details: string
          p_expense_category: string
          p_expense_provided: boolean
          p_note: string
          p_statuses: Database["public"]["Enums"]["receipt_transaction_status"][]
          p_user_id: string
          p_vendor_id: string
          p_vendor_name: string
          p_vendor_provided: boolean
        }
        Returns: Json
      }
      approve_receipt_rule_suggestion: {
        Args: { p_active: boolean; p_suggestion_id: string; p_user_id: string }
        Returns: string
      }
      approve_rota_open_shift_request: {
        Args: {
          p_actor_user_id: string
          p_employee_id: string
          p_expected_department: string
          p_expected_end_time: string
          p_expected_is_overnight: boolean
          p_expected_name: string
          p_expected_shift_date: string
          p_expected_start_time: string
          p_expected_unpaid_break_minutes: number
          p_request_id: string
          p_shift_id: string
        }
        Returns: {
          reason: string
          shift_id: string
          status: string
          week_start: string
        }[]
      }
      atomic_insert_parking_booking: {
        Args: {
          p_calculated_price: number
          p_capacity_override: boolean
          p_capacity_override_reason: string
          p_created_by: string
          p_customer_email: string
          p_customer_first_name: string
          p_customer_id: string
          p_customer_last_name: string
          p_customer_mobile: string
          p_duration_minutes: number
          p_end_at: string
          p_expires_at: string
          p_initial_request_sms_sent: boolean
          p_notes: string
          p_override_price: number
          p_override_reason: string
          p_paid_end_three_day_sms_sent: boolean
          p_paid_start_three_day_sms_sent: boolean
          p_payment_due_at: string
          p_payment_status: string
          p_pricing_breakdown: Json
          p_start_at: string
          p_status: string
          p_unpaid_day_before_sms_sent: boolean
          p_unpaid_week_before_sms_sent: boolean
          p_updated_by: string
          p_vehicle_colour: string
          p_vehicle_make: string
          p_vehicle_model: string
          p_vehicle_registration: string
        }
        Returns: {
          calculated_price: number
          cancelled_at: string | null
          capacity_override: boolean | null
          capacity_override_reason: string | null
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_first_name: string
          customer_id: string | null
          customer_last_name: string | null
          customer_mobile: string
          duration_minutes: number
          end_at: string
          end_notification_sent: boolean | null
          expires_at: string | null
          id: string
          initial_request_sms_sent: boolean
          notes: string | null
          override_price: number | null
          override_reason: string | null
          paid_end_three_day_sms_sent: boolean
          paid_start_three_day_sms_sent: boolean
          payment_due_at: string | null
          payment_overdue_notified: boolean | null
          payment_status: Database["public"]["Enums"]["parking_payment_status"]
          pricing_breakdown: Json
          reference: string
          start_at: string
          start_notification_sent: boolean | null
          status: Database["public"]["Enums"]["parking_booking_status"]
          unpaid_day_before_sms_sent: boolean
          unpaid_week_before_sms_sent: boolean
          updated_at: string
          updated_by: string | null
          vehicle_colour: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_registration: string
        }[]
        SetofOptions: {
          from: "*"
          to: "parking_bookings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      auto_close_past_event_tasks: { Args: never; Returns: undefined }
      auto_generate_weekly_slots: { Args: never; Returns: Json }
      booking_period_menu_ready: {
        Args: { p_period_id: string }
        Returns: boolean
      }
      business_hours_for_date: {
        Args: { p_date: string }
        Returns: {
          closes: string | null
          created_at: string | null
          day_of_week: number
          id: string
          is_closed: boolean | null
          is_kitchen_closed: boolean | null
          kitchen_closes: string | null
          kitchen_opens: string | null
          opens: string | null
          schedule_config: Json | null
          updated_at: string | null
          version_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_hours"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      calculate_event_points: {
        Args: {
          p_base_points: number
          p_event_id: string
          p_member_id: string
          p_tier_id: string
        }
        Returns: number
      }
      calculate_message_cost: { Args: { segments: number }; Returns: number }
      calculate_next_generation_date: {
        Args: {
          p_current_date: string
          p_day_of_month?: number
          p_day_of_week?: number
          p_frequency: string
          p_frequency_interval: number
        }
        Returns: string
      }
      calculate_private_booking_balance: {
        Args: { p_booking_id: string }
        Returns: number
      }
      calculate_refund_amount: {
        Args: { p_booking_id: string }
        Returns: {
          refund_amount: number
          refund_percentage: number
          refund_reason: string
        }[]
      }
      calculate_refundable_balance: {
        Args: {
          p_original_amount: number
          p_source_id: string
          p_source_type: string
        }
        Returns: number
      }
      calculate_reminder_dates: {
        Args: { event_date: string; event_time: string; has_seats: boolean }
        Returns: {
          reminder_type: string
          scheduled_for: string
        }[]
      }
      calculate_send_time: {
        Args: {
          p_custom_hours?: number
          p_event_timestamp: string
          p_send_timing: string
        }
        Returns: string
      }
      can_edit_invoice: { Args: { invoice_id: string }; Returns: boolean }
      cancel_event_booking_v05: {
        Args: { p_cancelled_by?: string; p_hashed_token: string }
        Returns: Json
      }
      cancel_marketing_campaign: {
        Args: { p_campaign_id: string; p_user_id: string }
        Returns: number
      }
      categorize_historical_events: { Args: never; Returns: number }
      check_and_reserve_capacity: {
        Args: {
          p_booking_time: string
          p_booking_type: Database["public"]["Enums"]["table_booking_type"]
          p_duration_minutes?: number
          p_party_size: number
          p_service_date: string
        }
        Returns: {
          available: boolean
          available_capacity: number
          message: string
        }[]
      }
      check_booking_seat_sum: {
        Args: { p_booking: string }
        Returns: undefined
      }
      check_expired_quotes: { Args: never; Returns: undefined }
      check_overdue_invoices: { Args: never; Returns: undefined }
      check_parking_capacity: {
        Args: { p_end: string; p_ignore_booking?: string; p_start: string }
        Returns: {
          active: number
          capacity: number
          remaining: number
        }[]
      }
      check_table_availability: {
        Args: {
          p_date: string
          p_duration_minutes?: number
          p_exclude_booking_id?: string
          p_party_size: number
          p_time: string
        }
        Returns: {
          available_capacity: number
          is_available: boolean
          tables_available: number[]
        }[]
      }
      check_table_availability_v06: {
        Args: {
          p_booking_date: string
          p_channel?: string
          p_high_chair_count?: number
          p_outside?: boolean
          p_party_size: number
          p_purpose?: string
          p_requires_accessible_table?: boolean
        }
        Returns: Json
      }
      claim_calendar_note_google_sync: {
        Args: {
          p_expected_generation?: number
          p_lease_seconds?: number
          p_note_id: string
        }
        Returns: {
          attempts: number
          generation: number
          note_id: string
          operation: string
          processing_token: string
        }[]
      }
      claim_jobs: {
        Args: {
          batch_size: number
          job_types?: string[]
          lease_seconds?: number
        }
        Returns: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          last_heartbeat_at: string | null
          lease_expires_at: string | null
          max_attempts: number | null
          payload: Json
          priority: number | null
          processing_token: string | null
          result: Json | null
          scheduled_for: string | null
          started_at: string | null
          status: string | null
          type: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_marketing_recipients: {
        Args: { p_batch: number }
        Returns: {
          attempt_count: number
          campaign_id: string
          claimed_at: string | null
          contact_id: string | null
          created_at: string
          customer_id: string | null
          email: string
          email_message_id: string | null
          error: string | null
          failure_class: string | null
          id: string
          last_attempt_at: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string | null
          provider_message_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_campaign_recipients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_expired_idempotency_keys: { Args: never; Returns: number }
      cleanup_import: { Args: never; Returns: undefined }
      cleanup_old_jobs: { Args: never; Returns: number }
      cleanup_old_rate_limits: { Args: never; Returns: undefined }
      cleanup_old_reminder_logs: { Args: never; Returns: undefined }
      cleanup_old_service_slots: { Args: never; Returns: number }
      cleanup_old_webhook_logs: { Args: never; Returns: undefined }
      compare_employee_versions: {
        Args: { p_employee_id: string; p_version1: number; p_version2: number }
        Returns: {
          changed: boolean
          field_name: string
          version1_value: string
          version2_value: string
        }[]
      }
      complete_employee_onboarding: { Args: { p_token: string }; Returns: Json }
      complete_finished_marketing_campaigns: { Args: never; Returns: number }
      confirm_event_manual_payment_v01: {
        Args: {
          p_amount: number
          p_currency?: string
          p_event_booking_id: string
          p_note?: string
          p_payment_method: string
          p_performed_by?: string
        }
        Returns: Json
      }
      confirm_event_payment_v05: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_currency?: string
          p_event_booking_id: string
          p_payment_intent_id: string
        }
        Returns: Json
      }
      confirm_event_paypal_payment_v01: {
        Args: {
          p_amount: number
          p_currency?: string
          p_event_booking_id: string
          p_paypal_capture_id: string
          p_paypal_order_id: string
          p_source?: string
        }
        Returns: Json
      }
      confirm_table_payment_v05: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_currency?: string
          p_payment_intent_id: string
          p_table_booking_id: string
        }
        Returns: Json
      }
      convert_event_table_bookings_to_communal_v01: {
        Args: { p_actor?: string; p_event_id: string }
        Returns: Json
      }
      convert_quote_to_invoice_atomic: {
        Args: { p_due_date: string; p_invoice_date: string; p_quote_id: string }
        Returns: Json
      }
      count_high_chairs_in_window: {
        Args: { p_end: string; p_exclude: string; p_start: string }
        Returns: number
      }
      count_receipt_statuses: {
        Args: never
        Returns: {
          auto_completed: number
          cant_find: number
          completed: number
          no_receipt_required: number
          pending: number
        }[]
      }
      create_credit_note_atomic: {
        Args: {
          p_amount_ex_vat: number
          p_created_by: string
          p_invoice_id: string
          p_reason: string
        }
        Returns: {
          amount_inc_vat: number
          credit_note_number: string
          id: string
        }[]
      }
      create_dish_transaction: {
        Args: {
          p_assignments?: Json
          p_dish_data: Json
          p_ingredients?: Json
          p_recipes?: Json
        }
        Returns: Json
      }
      create_employee_invite:
        | { Args: { p_email: string }; Returns: Json }
        | { Args: { p_email: string; p_job_title?: string }; Returns: Json }
      create_employee_transaction: {
        Args: {
          p_employee_data: Json
          p_financial_data?: Json
          p_health_data?: Json
        }
        Returns: Json
      }
      create_event_booking_v05: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_seating_preference?: string
          p_seats: number
          p_source?: string
        }
        Returns: Json
      }
      create_event_booking_v06: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_payment_hold_minutes?: number
          p_seating_preference?: string
          p_seats: number
          p_source?: string
        }
        Returns: Json
      }
      create_event_booking_v07: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_payment_hold_minutes: number
          p_seating_preference: string
          p_source: string
          p_ticket_selections: Json
        }
        Returns: Json
      }
      create_event_table_reservation_v05: {
        Args: {
          p_customer_id: string
          p_event_booking_id: string
          p_event_id: string
          p_notes?: string
          p_party_size: number
          p_source?: string
        }
        Returns: Json
      }
      create_event_table_reservation_v05_legacy: {
        Args: {
          p_customer_id: string
          p_event_booking_id: string
          p_event_id: string
          p_notes?: string
          p_party_size: number
          p_source?: string
        }
        Returns: Json
      }
      create_event_transaction: {
        Args: { p_event_data: Json; p_faqs?: Json }
        Returns: Json
      }
      create_event_waitlist_entry_v05: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_requested_seats: number
        }
        Returns: Json
      }
      create_invoice_transaction: {
        Args: { p_invoice_data: Json; p_line_items: Json }
        Returns: Json
      }
      create_manual_mileage_trip_v01: {
        Args: {
          p_created_by: string
          p_description: string
          p_legs: Json
          p_total_miles: number
          p_trip_date: string
        }
        Returns: string
      }
      create_next_waitlist_offer_v05: {
        Args: { p_event_id: string }
        Returns: Json
      }
      create_parking_booking_transaction: {
        Args: { p_booking_data: Json; p_payment_order_data?: Json }
        Returns: Json
      }
      create_private_booking_transaction: {
        Args: { p_booking_data: Json; p_customer_data?: Json; p_items?: Json }
        Returns: Json
      }
      create_quote_transaction: {
        Args: { p_line_items: Json; p_quote_data: Json }
        Returns: Json
      }
      create_recipe_transaction: {
        Args: { p_ingredients: Json; p_recipe_data: Json }
        Returns: Json
      }
      create_short_link: {
        Args: {
          p_custom_code?: string
          p_destination_url: string
          p_expires_at?: string
          p_link_type: string
          p_metadata?: Json
        }
        Returns: {
          full_url: string
          short_code: string
        }[]
      }
      create_sunday_lunch_booking: {
        Args: {
          p_allergies?: string[]
          p_booking_date: string
          p_booking_time: string
          p_correlation_id?: string
          p_customer_id: string
          p_dietary_requirements?: string[]
          p_party_size: number
          p_special_requirements?: string
        }
        Returns: {
          booking_id: string
          booking_reference: string
          message: string
          status: Database["public"]["Enums"]["table_booking_status"]
        }[]
      }
      create_table_booking_core_v06: {
        Args: {
          p_actor_id: string
          p_booking_date: string
          p_booking_period_answer: boolean
          p_booking_period_id: string
          p_booking_purpose: string
          p_booking_time: string
          p_bypass_cutoff: boolean
          p_bypass_pacing: boolean
          p_channel: string
          p_customer_id: string
          p_deposit_waived: boolean
          p_high_chair_count: number
          p_max_party_size: number
          p_notes: string
          p_outside_seating: boolean
          p_overrides: Database["public"]["CompositeTypes"]["table_allocation_overrides"]
          p_party_size: number
          p_pin: boolean
          p_requires_accessible_table: boolean
          p_source: string
          p_sunday_lunch: boolean
        }
        Returns: Json
      }
      create_table_booking_public_v06: {
        Args: {
          p_booking_date: string
          p_booking_period_answer?: boolean
          p_booking_period_id?: string
          p_booking_purpose?: string
          p_booking_time: string
          p_bypass_cutoff?: boolean
          p_bypass_pacing?: boolean
          p_customer_id: string
          p_deposit_waived?: boolean
          p_high_chair_count?: number
          p_notes?: string
          p_outside_seating?: boolean
          p_party_size: number
          p_requires_accessible_table?: boolean
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      create_table_booking_staff_v06: {
        Args: {
          p_actor_id?: string
          p_booking_date: string
          p_booking_period_answer?: boolean
          p_booking_period_id?: string
          p_booking_purpose?: string
          p_booking_time: string
          p_bypass_cutoff?: boolean
          p_bypass_pacing?: boolean
          p_channel?: string
          p_customer_id: string
          p_deposit_waived?: boolean
          p_high_chair_count?: number
          p_notes?: string
          p_outside_seating?: boolean
          p_overrides?: Database["public"]["CompositeTypes"]["table_allocation_overrides"]
          p_party_size: number
          p_pin?: boolean
          p_requires_accessible_table?: boolean
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      create_table_booking_transaction: {
        Args: {
          p_booking_data: Json
          p_menu_items?: Json
          p_payment_data?: Json
        }
        Returns: Json
      }
      create_table_booking_v05: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_bypass_cutoff?: boolean
          p_bypass_pacing?: boolean
          p_customer_id: string
          p_deposit_waived?: boolean
          p_high_chair_count?: number
          p_notes?: string
          p_outside_seating?: boolean
          p_party_size: number
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      create_table_booking_v05_core: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_customer_id: string
          p_notes?: string
          p_party_size: number
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      create_table_booking_v05_core_legacy: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_customer_id: string
          p_notes?: string
          p_party_size: number
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      create_table_booking_v05_core_sunday_deposit_legacy: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_customer_id: string
          p_notes?: string
          p_party_size: number
          p_source?: string
          p_sunday_lunch?: boolean
        }
        Returns: Json
      }
      debug_booking_hours: {
        Args: { p_date: string; p_time?: string }
        Returns: {
          check_name: string
          detail: string
          result: string
        }[]
      }
      decide_charge_request_v05: {
        Args: {
          p_approved_amount?: number
          p_decision: string
          p_hashed_token: string
        }
        Returns: Json
      }
      delete_booking_period_menu_item: {
        Args: { p_actor_id: string; p_id: string }
        Returns: Json
      }
      delete_event_image_variant: {
        Args: { p_event_id: string; p_variant: string }
        Returns: string
      }
      delete_expense_atomic: {
        Args: { p_expense_id: string }
        Returns: string[]
      }
      derive_short_link_name: {
        Args: { p_destination_url: string }
        Returns: string
      }
      draw_daily_spot_checks: {
        Args: { p_business_date: string; p_count: number }
        Returns: {
          business_date: string
          checked_by_user_id: string | null
          checked_employee_id: string
          draw_number: number
          drawn_at: string
          id: string
          instance_id: string
          note: string | null
          recorded_at: string | null
          result: string | null
          state: string
        }[]
        SetofOptions: {
          from: "*"
          to: "checklist_spot_checks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      encrypt_sensitive_audit_data: {
        Args: { p_encryption_key: string }
        Returns: undefined
      }
      event_booking_table_capacity_ok_v01: {
        Args: { p_event_booking_id: string; p_party_size: number }
        Returns: boolean
      }
      event_communal_window_v01: {
        Args: { p_event_id: string }
        Returns: Record<string, unknown>
      }
      event_ticket_type_unit_price: {
        Args: {
          p_base: number
          p_discount_type: string
          p_discount_value: number
        }
        Returns: number
      }
      finalise_marketing_send: {
        Args: {
          p_email_message_id: string
          p_needs_review?: boolean
          p_provider_message_id: string
          p_recipient_id: string
        }
        Returns: undefined
      }
      find_table_allocation_candidates: {
        Args: {
          p_channel?: string
          p_end_at: string
          p_exclude_booking?: string
          p_high_chair_count?: number
          p_now?: string
          p_overrides?: Database["public"]["CompositeTypes"]["table_allocation_overrides"]
          p_party_size: number
          p_preferred_table_ids?: string[]
          p_purpose?: string
          p_requires_accessible_table?: boolean
          p_start_at: string
        }
        Returns: {
          rank: number
          reason_code: string
          table_count: number
          table_ids: string[]
          table_names: string[]
          total_capacity: number
          worst_priority: number
        }[]
      }
      generate_booking_reference: { Args: never; Returns: string }
      generate_invoice_reminder_digest: {
        Args: never
        Returns: {
          amount: number
          category: string
          days_until_due: number
          due_date: string
          invoice_id: string
          invoice_number: string
          vendor_name: string
        }[]
      }
      generate_loyalty_access_token: { Args: never; Returns: string }
      generate_service_slots_for_period: {
        Args: { days_ahead?: number; start_date?: string }
        Returns: number
      }
      generate_service_slots_from_config: {
        Args: { days_ahead?: number; start_date?: string }
        Returns: number
      }
      generate_short_code: { Args: { length?: number }; Returns: string }
      generate_slots_from_business_hours: {
        Args: { p_days_ahead?: number; p_start_date?: string }
        Returns: Json
      }
      generate_slots_simple: { Args: never; Returns: string }
      get_ai_usage_breakdown: { Args: never; Returns: Json }
      get_all_links_analytics: {
        Args: { p_days?: number }
        Returns: {
          click_counts: number[]
          click_dates: string[]
          destination_url: string
          link_type: string
          short_code: string
          total_clicks: number
          unique_visitors: number
        }[]
      }
      get_all_links_analytics_v2: {
        Args: {
          p_end_at: string
          p_granularity: string
          p_include_bots?: boolean
          p_start_at: string
          p_timezone?: string
        }
        Returns: {
          click_counts: number[]
          click_dates: string[]
          created_at: string
          destination_url: string
          id: string
          link_type: string
          metadata: Json
          name: string
          parent_link_id: string
          short_code: string
          total_clicks: number
          unique_visitors: number
        }[]
      }
      get_all_users_unsafe: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          last_sign_in_at: string
        }[]
      }
      get_all_users_with_roles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          last_sign_in_at: string
          roles: Json
        }[]
      }
      get_amex_card_members: {
        Args: never
        Returns: {
          card_member: string
        }[]
      }
      get_and_increment_invoice_series: {
        Args: { p_series_code: string }
        Returns: {
          next_sequence: number
        }[]
      }
      get_booking_discounted_total: {
        Args: { p_booking_id: string }
        Returns: number
      }
      get_booking_gross_total: {
        Args: { p_booking_id: string }
        Returns: number
      }
      get_booking_period_for_date: {
        Args: { p_date: string }
        Returns: {
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          deposit_amount: number
          deposit_basis: string
          ends_on: string
          guest_blurb: string | null
          guest_question: string
          id: string
          is_active: boolean
          legacy_booking_type:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          max_party_size: number | null
          min_notice_hours: number
          min_party_size: number | null
          name: string
          period_kind: string
          preorder_cutoff_days: number
          refund_cutoff_days: number
          requires_preorder: boolean
          starts_on: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_booking_periods: { Args: never; Returns: Json }
      get_booking_vat_amount: {
        Args: { p_booking_id: string }
        Returns: number
      }
      get_bookings_needing_reminders: {
        Args: never
        Returns: {
          booking_id: string
          custom_timing_hours: number
          customer_id: string
          event_id: string
          reminder_type: string
          send_timing: string
          template_type: string
        }[]
      }
      get_bulk_sms_recipients:
        | {
            Args: {
              p_booking_status?: string
              p_category_id?: string
              p_created_after?: string
              p_created_before?: string
              p_event_id?: string
              p_search?: string
              p_sms_opt_in_only?: boolean
            }
            Returns: {
              first_name: string
              id: string
              last_booking_date: string
              last_name: string
              mobile_number: string
            }[]
          }
        | {
            Args: {
              p_booking_status?: string
              p_category_id?: string
              p_created_after?: string
              p_created_before?: string
              p_event_id?: string
              p_page?: number
              p_page_size?: number
              p_search?: string
              p_sms_opt_in_only?: boolean
            }
            Returns: {
              first_name: string
              id: string
              last_booking_date: string
              last_name: string
              mobile_number: string
              total_count: number
            }[]
          }
      get_category_regulars: {
        Args: { p_category_id: string; p_days_back?: number }
        Returns: {
          customer_id: string
          days_since_last_visit: number
          first_name: string
          last_attended_date: string
          last_name: string
          mobile_number: string
          times_attended: number
        }[]
      }
      get_charge_request_approval_preview_v05: {
        Args: { p_hashed_token: string }
        Returns: Json
      }
      get_cross_category_suggestions: {
        Args: {
          p_limit?: number
          p_source_category_id: string
          p_target_category_id: string
        }
        Returns: {
          already_attended_target: boolean
          customer_id: string
          first_name: string
          last_name: string
          mobile_number: string
          source_last_attended: string
          source_times_attended: number
        }[]
      }
      get_cross_promo_audience: {
        Args: {
          p_category_id: string
          p_event_id: string
          p_frequency_window_days?: number
          p_general_recency_days?: number
          p_max_events_per_window?: number
          p_max_recipients?: number
          p_recency_days?: number
        }
        Returns: {
          audience_type: string
          customer_id: string
          first_name: string
          last_event_category: string
          last_event_name: string
          last_name: string
          phone_number: string
          times_attended: number
        }[]
      }
      get_customer_labels: {
        Args: { p_customer_id: string }
        Returns: {
          assigned_at: string
          auto_assigned: boolean
          color: string
          icon: string
          label_id: string
          name: string
        }[]
      }
      get_dashboard_stats: {
        Args: never
        Returns: {
          active_employees: number
          new_customers_week: number
          recent_bookings: number
          total_customers: number
          unread_messages: number
          upcoming_events: number
        }[]
      }
      get_employee_at_timestamp: {
        Args: { p_employee_id: string; p_timestamp?: string }
        Returns: Json
      }
      get_employee_changes_summary: {
        Args: {
          p_employee_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          change_date: string
          changed_by: string
          fields_changed: string[]
          operation_type: string
          summary: string
        }[]
      }
      get_event_booking_manage_preview_v05: {
        Args: { p_hashed_token: string }
        Returns: Json
      }
      get_event_capacity_snapshot_v05: {
        Args: { p_event_ids?: string[] }
        Returns: {
          capacity: number
          communal_seated_capacity: number
          communal_seated_reserved: number
          confirmed_seats: number
          event_id: string
          held_seats: number
          is_full: boolean
          seated_remaining: number
          seats_remaining: number
          standing_capacity: number
          standing_remaining: number
          total_remaining: number
        }[]
      }
      get_event_ticket_type_capacity_v01: {
        Args: { p_event_id: string }
        Returns: {
          capacity_mode: string
          remaining: number
          ticket_type_id: string
        }[]
      }
      get_follow_up_recipients: {
        Args: {
          p_event_id: string
          p_min_gap_iso: string
          p_touch_type: string
        }
        Returns: {
          customer_id: string
          first_name: string
          phone_number: string
        }[]
      }
      get_invoice_summary_stats: {
        Args: never
        Returns: {
          count_draft: number
          count_outstanding: number
          count_overdue: number
          total_draft: number
          total_outstanding: number
          total_overdue: number
          total_this_month: number
        }[]
      }
      get_menu_outstanding_count: { Args: never; Returns: number }
      get_message_template: {
        Args: { p_event_id: string; p_template_type: string }
        Returns: {
          content: string
          custom_timing_hours: number
          send_timing: string
          variables: string[]
        }[]
      }
      get_next_booking_reference: { Args: never; Returns: string }
      get_openai_usage_total: { Args: never; Returns: number }
      get_private_booking_conflicts: {
        Args: {
          p_cleardown_time?: string
          p_end_time: string
          p_event_date: string
          p_exclude_booking_id?: string
          p_setup_date?: string
          p_setup_time?: string
          p_space_ids?: string[]
          p_start_time: string
        }
        Returns: {
          blocks_all: boolean
          booking_id: string
          booking_status: string
          customer_name: string
          occupies_from: string
          occupies_until: string
          space_name: string
        }[]
      }
      get_quarter_date_range: {
        Args: { p_quarter: number; p_year: number }
        Returns: {
          end_date: string
          start_date: string
        }[]
      }
      get_receipt_detail_groups:
        | {
            Args: {
              include_statuses?: string[]
              limit_groups?: number
              only_unclassified?: boolean
              use_fuzzy_grouping?: boolean
            }
            Returns: {
              details: string
              dominant_expense: string
              dominant_vendor: string
              first_date: string
              last_date: string
              needs_expense_count: number
              needs_vendor_count: number
              sample_transaction: Json
              total_in: number
              total_out: number
              transaction_count: number
              transaction_ids: string[]
            }[]
          }
        | {
            Args: {
              include_statuses?: string[]
              limit_groups?: number
              only_unclassified?: boolean
            }
            Returns: {
              details: string
              dominant_expense: string
              dominant_vendor: string
              first_date: string
              last_date: string
              needs_expense_count: number
              needs_vendor_count: number
              sample_transaction: Json
              total_in: number
              total_out: number
              transaction_count: number
              transaction_ids: string[]
            }[]
          }
      get_receipt_monthly_category_breakdown: {
        Args: { limit_months?: number; top_categories?: number }
        Returns: {
          category: string
          month_start: string
          total_outgoing: number
        }[]
      }
      get_receipt_monthly_income_breakdown: {
        Args: { limit_months?: number; top_sources?: number }
        Returns: {
          month_start: string
          source: string
          total_income: number
        }[]
      }
      get_receipt_monthly_status_counts: {
        Args: { limit_months?: number }
        Returns: {
          month_start: string
          status: Database["public"]["Enums"]["receipt_transaction_status"]
          total: number
        }[]
      }
      get_receipt_monthly_summary: {
        Args: { limit_months?: number }
        Returns: {
          month_start: string
          top_income: Json
          top_outgoing: Json
          total_income: number
          total_outgoing: number
        }[]
      }
      get_receipt_vendor_monthly_totals: {
        Args: { range_months?: number }
        Returns: {
          month_start: string
          total_income: number
          total_outgoing: number
          transaction_count: number
          vendor_key: string
          vendor_label: string
        }[]
      }
      get_receipt_vendor_transactions: {
        Args: { target_vendor_label: string }
        Returns: {
          amount_in: number
          amount_out: number
          details: string
          expense_category: string
          expense_category_source: string
          id: string
          status: string
          transaction_date: string
          transaction_type: string
          vendor_name: string
          vendor_source: string
        }[]
      }
      get_receipt_vendor_trends: {
        Args: { month_window?: number }
        Returns: {
          month_start: string
          total_income: number
          total_outgoing: number
          transaction_count: number
          vendor_label: string
        }[]
      }
      get_setting_bool: {
        Args: { p_default: boolean; p_key: string }
        Returns: boolean
      }
      get_setting_int: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      get_short_link_analytics: {
        Args: { p_days?: number; p_short_code: string }
        Returns: {
          click_date: string
          desktop_clicks: number
          mobile_clicks: number
          tablet_clicks: number
          top_browsers: Json
          top_countries: Json
          top_referrers: Json
          total_clicks: number
          unique_visitors: number
        }[]
      }
      get_table_booking_settings: { Args: never; Returns: Json }
      get_user_permissions: {
        Args: { p_user_id: string }
        Returns: {
          action: string
          module_name: string
        }[]
      }
      get_user_roles: {
        Args: { p_user_id: string }
        Returns: {
          role_id: string
          role_name: string
        }[]
      }
      get_users_for_admin: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          last_sign_in_at: string
        }[]
      }
      get_vendor_invoice_email: {
        Args: { p_vendor_id: string }
        Returns: string
      }
      import_customers_atomic: { Args: { p_customers: Json }; Returns: Json }
      import_receipt_batch_transaction: {
        Args: { p_batch_data: Json; p_transactions: Json }
        Returns: Json
      }
      increment_private_booking_contract_version: {
        Args: { p_booking_id: string }
        Returns: number
      }
      increment_short_link_clicks: {
        Args: { p_short_link_id: string }
        Returns: {
          click_count: number
          last_clicked_at: string
        }[]
      }
      insert_mileage_trip_legs_v01: {
        Args: { p_legs: Json; p_order_offset?: number; p_trip_id: string }
        Returns: number
      }
      is_active_event_booking_for_capacity_v01: {
        Args: { p_hold_expires_at: string; p_status: string }
        Returns: boolean
      }
      is_booking_live: {
        Args: {
          p_hold_expires_at: string
          p_left_at: string
          p_now?: string
          p_payment_status: Database["public"]["Enums"]["payment_status"]
          p_status: Database["public"]["Enums"]["table_booking_status"]
        }
        Returns: boolean
      }
      is_super_admin: { Args: { check_user_id: string }; Returns: boolean }
      is_table_blocked_by_private_booking_v05: {
        Args: {
          p_exclude_private_booking_id?: string
          p_table_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: boolean
      }
      link_employee_invite_account: {
        Args: { p_auth_user_id: string; p_token: string }
        Returns: Json
      }
      log_audit_event: {
        Args: {
          p_additional_info?: Json
          p_error_message?: string
          p_ip_address?: unknown
          p_new_values?: Json
          p_old_values?: Json
          p_operation_status: string
          p_operation_type: string
          p_resource_id: string
          p_resource_type: string
          p_user_agent?: string
          p_user_email: string
          p_user_id: string
        }
        Returns: string
      }
      log_invoice_audit: {
        Args: {
          p_action: string
          p_details?: Json
          p_invoice_id: string
          p_new_values?: Json
          p_old_values?: Json
        }
        Returns: undefined
      }
      log_reminder_processing: {
        Args: {
          p_booking_id?: string
          p_customer_id?: string
          p_error_details?: Json
          p_event_id?: string
          p_message: string
          p_metadata?: Json
          p_processing_type: string
          p_reminder_type?: string
          p_template_type?: string
        }
        Returns: string
      }
      marketing_send_window_open:
        | { Args: never; Returns: boolean }
        | { Args: { p_audience_type?: string }; Returns: boolean }
      menu_create_ingredient_with_price: {
        Args: {
          p_abv: number
          p_allergens: string[]
          p_brand: string
          p_default_unit: Database["public"]["Enums"]["menu_unit"]
          p_description: string
          p_dietary_flags: string[]
          p_is_active: boolean
          p_name: string
          p_notes: string
          p_pack_cost: number
          p_pack_size: number
          p_pack_size_unit: Database["public"]["Enums"]["menu_unit"]
          p_portions_per_pack: number
          p_purchase_department: string
          p_shelf_life_days: number
          p_storage_type: Database["public"]["Enums"]["menu_storage_type"]
          p_supplier_name: string
          p_supplier_sku: string
          p_wastage_pct: number
        }
        Returns: {
          abv: number | null
          allergens: string[]
          brand: string | null
          created_at: string
          default_unit: Database["public"]["Enums"]["menu_unit"]
          description: string | null
          dietary_flags: string[]
          id: string
          is_active: boolean
          name: string
          notes: string | null
          pack_cost: number
          pack_size: number | null
          pack_size_unit: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack: number | null
          purchase_department: string
          shelf_life_days: number | null
          storage_type: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name: string | null
          supplier_sku: string | null
          updated_at: string
          wastage_pct: number
        }
        SetofOptions: {
          from: "*"
          to: "menu_ingredients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      menu_get_latest_pack_cost: {
        Args: { p_ingredient_id: string }
        Returns: number
      }
      menu_get_latest_unit_cost: {
        Args: { p_ingredient_id: string }
        Returns: number
      }
      menu_refresh_dish_calculations: {
        Args: { p_dish_id: string }
        Returns: undefined
      }
      menu_refresh_recipe_calculations: {
        Args: { p_recipe_id: string }
        Returns: undefined
      }
      menu_resolve_dietary_claims: {
        Args: { p_component_flags: Json }
        Returns: string[]
      }
      menu_update_ingredient_pack_cost: {
        Args: { p_ingredient_id: string; p_pack_cost: number }
        Returns: number
      }
      menu_update_ingredient_with_price: {
        Args: {
          p_abv: number
          p_allergens: string[]
          p_brand: string
          p_default_unit: Database["public"]["Enums"]["menu_unit"]
          p_description: string
          p_dietary_flags: string[]
          p_ingredient_id: string
          p_is_active: boolean
          p_name: string
          p_notes: string
          p_pack_cost: number
          p_pack_size: number
          p_pack_size_unit: Database["public"]["Enums"]["menu_unit"]
          p_portions_per_pack: number
          p_purchase_department: string
          p_shelf_life_days: number
          p_storage_type: Database["public"]["Enums"]["menu_storage_type"]
          p_supplier_name: string
          p_supplier_sku: string
          p_wastage_pct: number
        }
        Returns: {
          abv: number | null
          allergens: string[]
          brand: string | null
          created_at: string
          default_unit: Database["public"]["Enums"]["menu_unit"]
          description: string | null
          dietary_flags: string[]
          id: string
          is_active: boolean
          name: string
          notes: string | null
          pack_cost: number
          pack_size: number | null
          pack_size_unit: Database["public"]["Enums"]["menu_unit"] | null
          portions_per_pack: number | null
          purchase_department: string
          shelf_life_days: number | null
          storage_type: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name: string | null
          supplier_sku: string | null
          updated_at: string
          wastage_pct: number
        }
        SetofOptions: {
          from: "*"
          to: "menu_ingredients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_table_booking_assignments_v05: {
        Args: {
          p_end_datetime: string
          p_start_datetime: string
          p_table_booking_id: string
          p_table_ids: string[]
        }
        Returns: Json
      }
      move_table_booking_time_v05: {
        Args: {
          p_booking_time: string
          p_end_datetime: string
          p_start_datetime: string
          p_table_booking_id: string
        }
        Returns: Json
      }
      neutralise_under10_table_deposit_state_v01: {
        Args: { p_reason?: string; p_table_booking_id: string }
        Returns: undefined
      }
      normalize_receipt_details: {
        Args: { p_details: string }
        Returns: string
      }
      normalize_receipt_vendor_key: { Args: { input: string }; Returns: string }
      preorder_sync_covers: { Args: { p_booking_id: string }; Returns: Json }
      preview_customer_marketing_audience: {
        Args: never
        Returns: {
          do_not_contact_count: number
          eligible_count: number
          not_eligible_count: number
          suppressed_count: number
          unsubscribed_count: number
        }[]
      }
      process_pending_jobs: {
        Args: never
        Returns: {
          job_id: string
          job_type: string
        }[]
      }
      promote_due_marketing_campaigns: {
        Args: never
        Returns: {
          promoted_campaign_id: string
          promoted_recipients: number
        }[]
      }
      public_booking_message: {
        Args: { p_public_reason: string }
        Returns: string
      }
      public_booking_reason: { Args: { p_internal: string }; Returns: string }
      queue_private_booking_sms: {
        Args: {
          p_booking_id: string
          p_customer_name: string
          p_message_body: string
          p_metadata?: Json
          p_priority?: number
          p_recipient_phone: string
          p_scheduled_for?: string
          p_skip_conditions?: Json
          p_template_key: string
          p_trigger_type: string
        }
        Returns: string
      }
      reallocate_event_communal_booking_v01: {
        Args: { p_booking_id: string; p_target_seats: number }
        Returns: Json
      }
      rebuild_customer_category_stats: { Args: never; Returns: number }
      recalculate_mileage_tax_year_v01: {
        Args: { p_trip_date: string }
        Returns: undefined
      }
      record_balance_payment: {
        Args: {
          p_amount: number
          p_booking_id: string
          p_method: string
          p_recorded_by?: string
        }
        Returns: Json
      }
      record_customer_consent: {
        Args: {
          p_capture_method: string
          p_captured_by_user_id?: string
          p_channel: string
          p_consent_text?: string
          p_consent_text_version?: string
          p_customer_id: string
          p_ip_hash?: string
          p_legal_basis: string
          p_metadata?: Json
          p_purpose: string
          p_related_entity_id?: string
          p_related_entity_type?: string
          p_source: string
          p_source_url?: string
          p_status: string
          p_update_summary?: boolean
          p_user_agent?: string
        }
        Returns: string
      }
      record_invoice_payment_transaction: {
        Args: { p_payment_data: Json }
        Returns: Json
      }
      record_table_cash_deposit_v05: {
        Args: {
          p_amount?: number
          p_currency?: string
          p_table_booking_id: string
        }
        Returns: Json
      }
      record_unsubscribe_token_use: {
        Args: { p_token: string }
        Returns: undefined
      }
      recover_stale_marketing_claims: {
        Args: never
        Returns: {
          quarantined: number
          recovered: number
        }[]
      }
      recruitment_application_transition_allowed: {
        Args: { p_from_status: string; p_to_status: string }
        Returns: boolean
      }
      recruitment_claim_appointment_slot: {
        Args: {
          p_application_id: string
          p_booking_token_hash: string
          p_candidate_id: string
          p_slot_id: string
          p_token_expires_at: string
        }
        Returns: string
      }
      recruitment_reschedule_appointment: {
        Args: {
          p_actor_user_id?: string
          p_appointment_id: string
          p_booking_token_hash?: string
          p_enforce_reschedule_limit?: boolean
          p_new_slot_id: string
          p_note?: string
        }
        Returns: {
          application_id: string
          archived_at: string | null
          archived_by: string | null
          booking_token_hash: string | null
          calendar_event_id: string | null
          calendar_last_error: string | null
          calendar_sync_status: string
          candidate_id: string
          created_at: string
          id: string
          location: string
          meal_provided: boolean
          outcome: string | null
          outcome_rating: number | null
          outcome_recorded_at: string | null
          reminder_email_sent_at: string | null
          reminder_sms_sent_at: string | null
          reschedule_count: number
          scheduled_end: string
          scheduled_start: string
          slot_id: string | null
          status: string
          supervisor_staff_id: string | null
          timezone: string
          token_expires_at: string | null
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recruitment_candidate_appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recruitment_staff_schedule_appointment: {
        Args: {
          p_actor_user_id: string
          p_application_id: string
          p_appointment_type?: string
          p_booking_token_hash: string
          p_slot_id: string
          p_token_expires_at: string
        }
        Returns: string
      }
      recruitment_transition_application_status: {
        Args: {
          p_application_id: string
          p_metadata?: Json
          p_note?: string
          p_to_status: string
        }
        Returns: {
          ai_concerns: Json | null
          ai_flags: Json | null
          ai_model: string | null
          ai_rationale: string | null
          ai_recommendation: string | null
          ai_score: number | null
          ai_scored_against_version: number | null
          ai_scored_at: string | null
          ai_strengths: Json | null
          archived_at: string | null
          archived_by: string | null
          availability: Json | null
          booking_token_expires_at: string | null
          booking_token_hash: string | null
          booking_token_type: string | null
          booking_token_used_at: string | null
          candidate_id: string
          cover_note: string | null
          created_at: string
          created_by: string | null
          duplicate_of_application_id: string | null
          id: string
          is_general: boolean | null
          job_posting_id: string | null
          latest_ai_run_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          relevant_experience_answer: string | null
          source: string
          start_availability: string | null
          status: string
          travel_answer: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recruitment_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recruitment_transition_application_status_actor: {
        Args: {
          p_actor_user_id?: string
          p_application_id: string
          p_force?: boolean
          p_metadata?: Json
          p_note?: string
          p_to_status: string
        }
        Returns: {
          ai_concerns: Json | null
          ai_flags: Json | null
          ai_model: string | null
          ai_rationale: string | null
          ai_recommendation: string | null
          ai_score: number | null
          ai_scored_against_version: number | null
          ai_scored_at: string | null
          ai_strengths: Json | null
          archived_at: string | null
          archived_by: string | null
          availability: Json | null
          booking_token_expires_at: string | null
          booking_token_hash: string | null
          booking_token_type: string | null
          booking_token_used_at: string | null
          candidate_id: string
          cover_note: string | null
          created_at: string
          created_by: string | null
          duplicate_of_application_id: string | null
          id: string
          is_general: boolean | null
          job_posting_id: string | null
          latest_ai_run_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          relevant_experience_answer: string | null
          source: string
          start_availability: string | null
          status: string
          travel_answer: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recruitment_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_receipt_duplicate_candidates: { Args: never; Returns: undefined }
      register_guest_transaction: {
        Args: {
          p_customer_data: Json
          p_event_id: string
          p_labels?: Json
          p_staff_id: string
        }
        Returns: Json
      }
      reissue_oj_invoice_transaction: {
        Args: {
          p_entry_ids?: string[]
          p_invoice_data: Json
          p_line_items: Json
          p_mode: string
          p_recurring_instance_ids?: string[]
          p_source_invoice_id: string
          p_virtual_recurring_instances?: Json
        }
        Returns: Json
      }
      release_marketing_claim: {
        Args: {
          p_backoff_seconds?: number
          p_error: string
          p_failure_class: string
          p_recipient_id: string
        }
        Returns: undefined
      }
      render_template: {
        Args: { p_template: string; p_variables: Json }
        Returns: string
      }
      replace_employee_emergency_contacts: {
        Args: { p_contacts: Json; p_employee_id: string }
        Returns: Json
      }
      replace_oj_invoice_transaction: {
        Args: {
          p_changed_entry_id?: string
          p_entry_ids?: string[]
          p_line_items: Json
          p_old_invoice_id: string
          p_recurring_instance_ids?: string[]
          p_replacement_invoice_data: Json
          p_void_reason?: string
        }
        Returns: Json
      }
      replace_role_permissions: {
        Args: { p_permission_ids: string[]; p_role_id: string }
        Returns: undefined
      }
      replace_user_roles: {
        Args: { p_assigned_by: string; p_role_ids: string[]; p_user_id: string }
        Returns: undefined
      }
      requeue_calendar_note_google_sync: {
        Args: { p_note_id: string; p_processing_token?: string }
        Returns: number
      }
      requeue_stale_calendar_note_google_sync: {
        Args: { p_limit?: number; p_synced_before: string; p_today: string }
        Returns: {
          attempts: number
          generation: number
          note_id: string
          operation: string
        }[]
      }
      reserve_high_chairs: {
        Args: {
          p_booking_id: string
          p_end: string
          p_requested: number
          p_start: string
        }
        Returns: number
      }
      reserve_refund_balance: {
        Args: {
          p_amount: number
          p_initiated_by: string
          p_original_amount: number
          p_paypal_capture_id?: string
          p_paypal_request_id?: string
          p_reason: string
          p_refund_method: string
          p_source_id: string
          p_source_type: string
        }
        Returns: {
          refund_id: string
          remaining: number
        }[]
      }
      resolve_table_booking_deposit: {
        Args: {
          p_booking_date: string
          p_deposit_waived?: boolean
          p_party_size: number
          p_period_answer?: boolean
          p_period_id?: string
        }
        Returns: Json
      }
      restore_employee_version: {
        Args: {
          p_employee_id: string
          p_user_id: string
          p_version_number: number
        }
        Returns: Json
      }
      set_booking_period: {
        Args: { p_actor_id: string; p_payload: Json }
        Returns: Json
      }
      set_booking_period_active: {
        Args: {
          p_actor_id: string
          p_archive: boolean
          p_id: string
          p_is_active: boolean
        }
        Returns: Json
      }
      set_table_booking_settings: {
        Args: {
          p_actor_id: string
          p_expected_revision: number
          p_payload: Json
          p_section: string
        }
        Returns: Json
      }
      short_link_is_known_bot: {
        Args: { p_device_type?: string; p_user_agent: string }
        Returns: boolean
      }
      should_send_private_booking_sms: {
        Args: {
          p_booking_id: string
          p_phone: string
          p_priority: number
          p_trigger_type: string
        }
        Returns: boolean
      }
      standardize_phone_flexible: { Args: { phone: string }; Returns: string }
      sync_booking_default_item_v01: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      sync_outside_reservation: {
        Args: { p_table_booking_id: string }
        Returns: undefined
      }
      table_booking_assigned_capacity_v01: {
        Args: { p_table_booking_id: string }
        Returns: {
          assigned_capacity: number
          assignment_count: number
        }[]
      }
      table_booking_assignment_capacity_ok_v01: {
        Args: { p_party_size: number; p_table_booking_id: string }
        Returns: boolean
      }
      table_booking_matches_service_window_v05: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_sunday_lunch?: boolean
        }
        Returns: boolean
      }
      table_booking_setting_type: { Args: { p_key: string }; Returns: string }
      table_booking_settings_keys: {
        Args: { p_section: string }
        Returns: string[]
      }
      table_booking_within_service_window_v06: {
        Args: {
          p_booking_date: string
          p_booking_purpose?: string
          p_booking_time: string
          p_sunday_lunch?: boolean
        }
        Returns: boolean
      }
      table_is_held: {
        Args: {
          p_channel: string
          p_end_at: string
          p_ignore_hold?: boolean
          p_now?: string
          p_release_lead_hours: number
          p_start_at: string
          p_table_id: string
        }
        Returns: boolean
      }
      table_names_in_order: { Args: { p_ids: string[] }; Returns: string[] }
      tables_are_connected: { Args: { p_ids: string[] }; Returns: boolean }
      update_dish_transaction: {
        Args: {
          p_assignments?: Json
          p_dish_data: Json
          p_dish_id: string
          p_ingredients?: Json
          p_recipes?: Json
        }
        Returns: Json
      }
      update_event_booking_seats_staff_v05: {
        Args: { p_actor?: string; p_booking_id: string; p_new_seats: number }
        Returns: Json
      }
      update_event_booking_seats_v05: {
        Args: { p_actor?: string; p_hashed_token: string; p_new_seats: number }
        Returns: Json
      }
      update_event_transaction: {
        Args: { p_event_data: Json; p_event_id: string; p_faqs?: Json }
        Returns: Json
      }
      update_invoice_payment_status: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      update_invoice_with_line_items: {
        Args: { p_invoice_data: Json; p_invoice_id: string; p_line_items: Json }
        Returns: {
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number | null
          due_date: string
          id: string
          internal_notes: string | null
          invoice_date: string
          invoice_discount_percentage: number | null
          invoice_number: string
          notes: string | null
          paid_amount: number | null
          reference: string | null
          status: string | null
          subtotal_amount: number | null
          total_amount: number | null
          updated_at: string | null
          vat_amount: number | null
          vendor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_leave_request_dates: {
        Args: {
          p_end_date: string
          p_holiday_year: number
          p_request_id: string
          p_start_date: string
        }
        Returns: Json
      }
      update_manual_mileage_trip_v01: {
        Args: {
          p_description: string
          p_legs: Json
          p_total_miles: number
          p_trip_date: string
          p_trip_id: string
        }
        Returns: Json
      }
      update_menu_target_gp_transaction: {
        Args: {
          p_new_target_gp: number
          p_user_email?: string
          p_user_id?: string
        }
        Returns: Json
      }
      update_recipe_transaction: {
        Args: { p_ingredients?: Json; p_recipe_data: Json; p_recipe_id: string }
        Returns: Json
      }
      upsert_booking_period_menu_item: {
        Args: { p_actor_id: string; p_payload: Json }
        Returns: Json
      }
      upsert_cashup_session_atomic: {
        Args: {
          p_cash_counts: Json
          p_existing_id: string
          p_notes: string
          p_payment_breakdowns: Json
          p_sales_breakdowns: Json
          p_session_date: string
          p_site_id: string
          p_status: string
          p_user_id: string
        }
        Returns: string
      }
      upsert_event_image_variant: {
        Args: {
          p_event_id: string
          p_file_name: string
          p_file_size_bytes: number
          p_mime_type: string
          p_public_url: string
          p_storage_path: string
          p_uploaded_by: string
          p_variant: string
        }
        Returns: string
      }
      user_has_permission: {
        Args: { p_action: string; p_module_name: string; p_user_id: string }
        Returns: boolean
      }
      validate_booking_against_policy: {
        Args: {
          p_booking_date: string
          p_booking_time: string
          p_booking_type: Database["public"]["Enums"]["table_booking_type"]
          p_party_size: number
        }
        Returns: {
          error_message: string
          is_valid: boolean
        }[]
      }
      validate_table_booking_settings: {
        Args: { p_payload: Json; p_section: string }
        Returns: string
      }
      voucher_assign_customer: {
        Args: {
          p_actor_name: string
          p_customer_id: string
          p_employee_id: string
          p_source: string
          p_user_id: string
          p_voucher_number: string
        }
        Returns: Json
      }
      voucher_cancel: {
        Args: {
          p_actor_name: string
          p_employee_id: string
          p_idempotency_key: string
          p_reason: string
          p_source: string
          p_user_id: string
          p_voucher_number: string
        }
        Returns: Json
      }
      voucher_edit_handout: {
        Args: {
          p_actor_name: string
          p_employee_id: string
          p_london_today: string
          p_patch: Json
          p_reason: string
          p_source: string
          p_user_id: string
          p_voucher_number: string
        }
        Returns: Json
      }
      voucher_expire_due: { Args: { p_london_today: string }; Returns: Json }
      voucher_generate_batch: {
        Args: {
          p_created_by: string
          p_created_by_name: string
          p_items: Json
          p_note: string
        }
        Returns: Json
      }
      voucher_issue: {
        Args: {
          p_customer_id: string
          p_employee_id: string
          p_employee_name: string
          p_event_id: string
          p_expiry_date: string
          p_idempotency_key: string
          p_source: string
          p_user_id: string
          p_voucher_number: string
          p_won_at_label: string
        }
        Returns: Json
      }
      voucher_override_redeem: {
        Args: {
          p_booking_ref: string
          p_employee_id: string
          p_employee_name: string
          p_idempotency_key: string
          p_london_today: string
          p_manager_user_id: string
          p_reason: string
          p_source: string
          p_transaction_ref: string
          p_voucher_number: string
        }
        Returns: Json
      }
      voucher_redeem: {
        Args: {
          p_booking_ref: string
          p_customer_id: string
          p_employee_id: string
          p_employee_name: string
          p_idempotency_key: string
          p_london_today: string
          p_source: string
          p_transaction_ref: string
          p_user_id: string
          p_voucher_number: string
        }
        Returns: Json
      }
      voucher_reminder_mark: {
        Args: {
          p_channel?: string
          p_error: string
          p_id: string
          p_message_sid: string
          p_status: string
        }
        Returns: Json
      }
      voucher_reminders_claim_due: {
        Args: { p_limit?: number; p_london_today: string }
        Returns: Json
      }
      voucher_reminders_recompute: {
        Args: { p_voucher_id: string }
        Returns: Json
      }
      voucher_replace: {
        Args: {
          p_actor_name: string
          p_employee_id: string
          p_idempotency_key: string
          p_original_number: string
          p_reason: string
          p_replacement_number: string
          p_source: string
          p_user_id: string
        }
        Returns: Json
      }
      voucher_undo_redeem: {
        Args: {
          p_actor_name: string
          p_employee_id: string
          p_idempotency_key: string
          p_reason: string
          p_require_recent: boolean
          p_source: string
          p_user_id: string
          p_voucher_number: string
        }
        Returns: Json
      }
      windows_overlap: {
        Args: {
          p_a_end: string
          p_a_start: string
          p_b_end: string
          p_b_start: string
        }
        Returns: boolean
      }
    }
    Enums: {
      booking_item_type: "main" | "side" | "extra"
      menu_storage_type: "ambient" | "chilled" | "frozen" | "dry" | "other"
      menu_unit:
        | "each"
        | "portion"
        | "gram"
        | "kilogram"
        | "millilitre"
        | "litre"
        | "ounce"
        | "pound"
        | "teaspoon"
        | "tablespoon"
        | "cup"
        | "slice"
        | "piece"
        | "pint"
        | "measure"
        | "glass"
      parking_booking_status:
        | "pending_payment"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "expired"
      parking_notification_channel: "sms" | "email"
      parking_notification_event:
        | "payment_request"
        | "payment_reminder"
        | "payment_confirmation"
        | "session_start"
        | "session_end"
        | "payment_overdue"
        | "refund_confirmation"
      parking_payment_status:
        | "pending"
        | "paid"
        | "refunded"
        | "failed"
        | "expired"
      payment_status:
        | "pending"
        | "completed"
        | "failed"
        | "refunded"
        | "partial_refund"
      performer_submission_status:
        | "new"
        | "shortlisted"
        | "contacted"
        | "booked"
        | "not_a_fit"
        | "do_not_contact"
      receipt_transaction_status:
        | "pending"
        | "completed"
        | "auto_completed"
        | "no_receipt_required"
        | "cant_find"
      table_booking_payment_method: "payment_link" | "cash" | "paypal"
      table_booking_status:
        | "pending_payment"
        | "confirmed"
        | "cancelled"
        | "no_show"
        | "completed"
        | "pending_card_capture"
        | "visited_waiting_for_review"
        | "review_clicked"
      table_booking_type: "regular" | "sunday_lunch" | "christmas"
    }
    CompositeTypes: {
      table_allocation_overrides: {
        ignore_minimum: boolean | null
        ignore_hold: boolean | null
        allow_unjoined: boolean | null
        ignore_accessibility: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_item_type: ["main", "side", "extra"],
      menu_storage_type: ["ambient", "chilled", "frozen", "dry", "other"],
      menu_unit: [
        "each",
        "portion",
        "gram",
        "kilogram",
        "millilitre",
        "litre",
        "ounce",
        "pound",
        "teaspoon",
        "tablespoon",
        "cup",
        "slice",
        "piece",
        "pint",
        "measure",
        "glass",
      ],
      parking_booking_status: [
        "pending_payment",
        "confirmed",
        "completed",
        "cancelled",
        "expired",
      ],
      parking_notification_channel: ["sms", "email"],
      parking_notification_event: [
        "payment_request",
        "payment_reminder",
        "payment_confirmation",
        "session_start",
        "session_end",
        "payment_overdue",
        "refund_confirmation",
      ],
      parking_payment_status: [
        "pending",
        "paid",
        "refunded",
        "failed",
        "expired",
      ],
      payment_status: [
        "pending",
        "completed",
        "failed",
        "refunded",
        "partial_refund",
      ],
      performer_submission_status: [
        "new",
        "shortlisted",
        "contacted",
        "booked",
        "not_a_fit",
        "do_not_contact",
      ],
      receipt_transaction_status: [
        "pending",
        "completed",
        "auto_completed",
        "no_receipt_required",
        "cant_find",
      ],
      table_booking_payment_method: ["payment_link", "cash", "paypal"],
      table_booking_status: [
        "pending_payment",
        "confirmed",
        "cancelled",
        "no_show",
        "completed",
        "pending_card_capture",
        "visited_waiting_for_review",
        "review_clicked",
      ],
      table_booking_type: ["regular", "sunday_lunch", "christmas"],
    },
  },
} as const
