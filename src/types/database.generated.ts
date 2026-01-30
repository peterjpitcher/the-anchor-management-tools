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
          current_value: number | null
          updated_at: string | null
        }
        Insert: {
          current_value?: number | null
          updated_at?: string | null
        }
        Update: {
          current_value?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_usage_events: {
        Row: {
          completion_tokens: number
          cost: number
          model: string
          prompt_tokens: number
          total_tokens: number
        }
        Insert: {
          completion_tokens?: number
          cost?: number
          model: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Update: {
          completion_tokens?: number
          cost?: number
          model?: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          description: string | null
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
          email_on_upload: boolean
        }
        Insert: {
          category_id?: string
          category_name: string
          email_on_upload?: boolean
        }
        Update: {
          category_id?: string
          category_name?: string
          email_on_upload?: boolean
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
          created_at: string | null
          duration_ms: number | null
          id: string
          payload: Json
          priority: number | null
          scheduled_for: string
          status: string
          type: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          payload?: Json
          priority?: number | null
          scheduled_for?: string
          status?: string
          type: string
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          payload?: Json
          priority?: number | null
          scheduled_for?: string
          status?: string
          type?: string
        }
        Relationships: []
      }
      booking_audit: {
        Row: {
          booking_id: string
          event: string
          meta: Json | null
          new_status: string | null
        }
        Insert: {
          booking_id: string
          event: string
          meta?: Json | null
          new_status?: string | null
        }
        Update: {
          booking_id?: string
          event?: string
          meta?: Json | null
          new_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "table_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_policies: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          created_at: string | null
          full_refund_hours: number
          max_advance_days: number | null
          min_advance_hours: number | null
          partial_refund_hours: number
          partial_refund_percentage: number
          updated_at: string | null
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          created_at?: string | null
          full_refund_hours?: number
          max_advance_days?: number | null
          min_advance_hours?: number | null
          partial_refund_hours?: number
          partial_refund_percentage?: number
          updated_at?: string | null
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          created_at?: string | null
          full_refund_hours?: number
          max_advance_days?: number | null
          min_advance_hours?: number | null
          partial_refund_hours?: number
          partial_refund_percentage?: number
          updated_at?: string | null
        }
        Relationships: []
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
      booking_time_slots: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"] | null
          day_of_week: number
          is_active: boolean | null
          max_covers: number
          slot_time: string
          updated_at: string | null
        }
        Insert: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          day_of_week: number
          is_active?: boolean | null
          max_covers: number
          slot_time: string
          updated_at?: string | null
        }
        Update: {
          booking_type?:
            | Database["public"]["Enums"]["table_booking_type"]
            | null
          day_of_week?: number
          is_active?: boolean | null
          max_covers?: number
          slot_time?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_source: string | null
          created_at: string
          customer_id: string
          event_id: string
          id: string
          is_reminder_only: boolean
          last_reminder_sent: string | null
          notes: string | null
          seats: number | null
        }
        Insert: {
          booking_source?: string | null
          created_at?: string
          customer_id: string
          event_id: string
          id?: string
          is_reminder_only?: boolean
          last_reminder_sent?: string | null
          notes?: string | null
          seats?: number | null
        }
        Update: {
          booking_source?: string | null
          created_at?: string
          customer_id?: string
          event_id?: string
          id?: string
          is_reminder_only?: boolean
          last_reminder_sent?: string | null
          notes?: string | null
          seats?: number | null
        }
        Relationships: [
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
          type: string
        }
        Insert: {
          type: string
        }
        Update: {
          type?: string
        }
        Relationships: []
      }
      business_hours: {
        Row: {
          day_of_week: number
          is_closed: boolean | null
          is_kitchen_closed: boolean | null
          kitchen_closes: string | null
          kitchen_opens: string | null
          schedule_config: Json | null
        }
        Insert: {
          day_of_week: number
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          schedule_config?: Json | null
        }
        Update: {
          day_of_week?: number
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          schedule_config?: Json | null
        }
        Relationships: []
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
      cashup_sessions: {
        Row: {
          approved_by_user_id: string | null
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
        }
        Insert: {
          approved_by_user_id?: string | null
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
        }
        Update: {
          approved_by_user_id?: string | null
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
      cashup_targets: {
        Row: {
          created_by: string | null
          day_of_week: number
          effective_from: string
          site_id: string
          target_amount: number
        }
        Insert: {
          created_by?: string | null
          day_of_week: number
          effective_from: string
          site_id: string
          target_amount?: number
        }
        Update: {
          created_by?: string | null
          day_of_week?: number
          effective_from?: string
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
          description: string | null
          display_order: number | null
          id: string
          minimum_guests: number | null
          name: string
          pricing_model: string | null
          serving_style: string | null
        }
        Insert: {
          active?: boolean | null
          category: string
          cost_per_head: number
          description?: string | null
          display_order?: number | null
          id?: string
          minimum_guests?: number | null
          name: string
          pricing_model?: string | null
          serving_style?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string
          cost_per_head?: number
          description?: string | null
          display_order?: number | null
          id?: string
          minimum_guests?: number | null
          name?: string
          pricing_model?: string | null
          serving_style?: string | null
        }
        Relationships: []
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
      customer_category_stats: {
        Row: {
          category_id: string
          customer_id: string
          first_attended_date: string | null
          last_attended_date: string | null
          times_attended: number | null
        }
        Insert: {
          category_id: string
          customer_id: string
          first_attended_date?: string | null
          last_attended_date?: string | null
          times_attended?: number | null
        }
        Update: {
          category_id?: string
          customer_id?: string
          first_attended_date?: string | null
          last_attended_date?: string | null
          times_attended?: number | null
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
          completed_count: number | null
          updated_at: string | null
        }
        Insert: {
          completed_count?: number | null
          updated_at?: string | null
        }
        Update: {
          completed_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
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
          description: string | null
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          auto_apply_rules?: Json | null
          color?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          auto_apply_rules?: Json | null
          color?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          consecutive_failures: number | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_failure_type: string | null
          last_name: string
          last_sms_failure_reason: string | null
          last_successful_delivery: string | null
          last_successful_sms_at: string | null
          last_table_booking_date: string | null
          messaging_status: string | null
          mobile_e164: string | null
          mobile_number: string
          no_show_count: number | null
          sms_deactivated_at: string | null
          sms_deactivation_reason: string | null
          sms_delivery_failures: number | null
          sms_opt_in: boolean | null
          table_booking_count: number | null
          total_failures_30d: number | null
        }
        Insert: {
          consecutive_failures?: number | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_failure_type?: string | null
          last_name: string
          last_sms_failure_reason?: string | null
          last_successful_delivery?: string | null
          last_successful_sms_at?: string | null
          last_table_booking_date?: string | null
          messaging_status?: string | null
          mobile_e164?: string | null
          mobile_number: string
          no_show_count?: number | null
          sms_deactivated_at?: string | null
          sms_deactivation_reason?: string | null
          sms_delivery_failures?: number | null
          sms_opt_in?: boolean | null
          table_booking_count?: number | null
          total_failures_30d?: number | null
        }
        Update: {
          consecutive_failures?: number | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_failure_type?: string | null
          last_name?: string
          last_sms_failure_reason?: string | null
          last_successful_delivery?: string | null
          last_successful_sms_at?: string | null
          last_table_booking_date?: string | null
          messaging_status?: string | null
          mobile_e164?: string | null
          mobile_number?: string
          no_show_count?: number | null
          sms_deactivated_at?: string | null
          sms_deactivation_reason?: string | null
          sms_delivery_failures?: number | null
          sms_opt_in?: boolean | null
          table_booking_count?: number | null
          total_failures_30d?: number | null
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
          created_at: string | null
          employee_id: string
          priority: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          priority?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          priority?: string | null
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
          allergies: string | null
          disability_details: string | null
          disability_reg_expiry_date: string | null
          disability_reg_number: string | null
          doctor_address: string | null
          doctor_name: string | null
          employee_id: string
          has_bowel_problems: boolean
          has_depressive_illness: boolean
          has_diabetes: boolean
          has_ear_problems: boolean
          has_epilepsy: boolean
          has_skin_condition: boolean
          illness_history: string | null
          is_registered_disabled: boolean
          recent_treatment: string | null
        }
        Insert: {
          allergies?: string | null
          disability_details?: string | null
          disability_reg_expiry_date?: string | null
          disability_reg_number?: string | null
          doctor_address?: string | null
          doctor_name?: string | null
          employee_id: string
          has_bowel_problems?: boolean
          has_depressive_illness?: boolean
          has_diabetes?: boolean
          has_ear_problems?: boolean
          has_epilepsy?: boolean
          has_skin_condition?: boolean
          illness_history?: string | null
          is_registered_disabled?: boolean
          recent_treatment?: string | null
        }
        Update: {
          allergies?: string | null
          disability_details?: string | null
          disability_reg_expiry_date?: string | null
          disability_reg_number?: string | null
          doctor_address?: string | null
          doctor_name?: string | null
          employee_id?: string
          has_bowel_problems?: boolean
          has_depressive_illness?: boolean
          has_diabetes?: boolean
          has_ear_problems?: boolean
          has_epilepsy?: boolean
          has_skin_condition?: boolean
          illness_history?: string | null
          is_registered_disabled?: boolean
          recent_treatment?: string | null
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
      employee_notes: {
        Row: {
          created_at: string
          employee_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
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
      employee_right_to_work: {
        Row: {
          created_at: string | null
          document_details: string | null
          document_expiry_date: string | null
          document_type: string
          employee_id: string
          follow_up_date: string | null
          photo_storage_path: string | null
          updated_at: string | null
          verification_date: string
          verified_by_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          document_details?: string | null
          document_expiry_date?: string | null
          document_type: string
          employee_id: string
          follow_up_date?: string | null
          photo_storage_path?: string | null
          updated_at?: string | null
          verification_date: string
          verified_by_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          document_details?: string | null
          document_expiry_date?: string | null
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
          date_of_birth: string | null
          email_address: string
          employee_id: string
          employment_end_date: string | null
          employment_start_date: string
          first_name: string
          first_shift_date: string | null
          job_title: string
          keyholder_status: boolean | null
          last_name: string
          mobile_number: string | null
          phone_number: string | null
          post_code: string | null
          status: string
          uniform_preference: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          date_of_birth?: string | null
          email_address: string
          employee_id?: string
          employment_end_date?: string | null
          employment_start_date: string
          first_name: string
          first_shift_date?: string | null
          job_title: string
          keyholder_status?: boolean | null
          last_name: string
          mobile_number?: string | null
          phone_number?: string | null
          post_code?: string | null
          status?: string
          uniform_preference?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          date_of_birth?: string | null
          email_address?: string
          employee_id?: string
          employment_end_date?: string | null
          employment_start_date?: string
          first_name?: string
          first_shift_date?: string | null
          job_title?: string
          keyholder_status?: boolean | null
          last_name?: string
          mobile_number?: string | null
          phone_number?: string | null
          post_code?: string | null
          status?: string
          uniform_preference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      event_categories: {
        Row: {
          color: string
          created_at: string | null
          default_booking_url: string | null
          default_capacity: number | null
          default_doors_time: string | null
          default_duration_minutes: number | null
          default_end_time: string | null
          default_event_status: string | null
          default_image_url: string | null
          default_is_free: boolean | null
          default_last_entry_time: string | null
          default_performer_name: string | null
          default_performer_type: string | null
          default_price: number | null
          default_reminder_hours: number | null
          default_start_time: string | null
          description: string | null
          faqs: Json | null
          gallery_image_urls: Json | null
          highlight_video_urls: Json | null
          highlights: Json | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          keywords: Json | null
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          poster_image_url: string | null
          promo_video_url: string | null
          short_description: string | null
          slug: string
          sort_order: number | null
          thumbnail_image_url: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          default_booking_url?: string | null
          default_capacity?: number | null
          default_doors_time?: string | null
          default_duration_minutes?: number | null
          default_end_time?: string | null
          default_event_status?: string | null
          default_image_url?: string | null
          default_is_free?: boolean | null
          default_last_entry_time?: string | null
          default_performer_name?: string | null
          default_performer_type?: string | null
          default_price?: number | null
          default_reminder_hours?: number | null
          default_start_time?: string | null
          description?: string | null
          faqs?: Json | null
          gallery_image_urls?: Json | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          poster_image_url?: string | null
          promo_video_url?: string | null
          short_description?: string | null
          slug: string
          sort_order?: number | null
          thumbnail_image_url?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          default_booking_url?: string | null
          default_capacity?: number | null
          default_doors_time?: string | null
          default_duration_minutes?: number | null
          default_end_time?: string | null
          default_event_status?: string | null
          default_image_url?: string | null
          default_is_free?: boolean | null
          default_last_entry_time?: string | null
          default_performer_name?: string | null
          default_performer_type?: string | null
          default_price?: number | null
          default_reminder_hours?: number | null
          default_start_time?: string | null
          description?: string | null
          faqs?: Json | null
          gallery_image_urls?: Json | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          keywords?: Json | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          poster_image_url?: string | null
          promo_video_url?: string | null
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
          event_id: string
          task_key: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          event_id: string
          task_key: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          event_id?: string
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
      event_faqs: {
        Row: {
          answer: string
          event_id: string
          id: string
          question: string
          sort_order: number | null
        }
        Insert: {
          answer: string
          event_id: string
          id?: string
          question: string
          sort_order?: number | null
        }
        Update: {
          answer?: string
          event_id?: string
          id?: string
          question?: string
          sort_order?: number | null
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
      event_message_templates: {
        Row: {
          content: string
          custom_timing_hours: number | null
          event_id: string
          id: string
          is_active: boolean | null
          send_timing: string | null
          template_type: string
          variables: string[] | null
        }
        Insert: {
          content: string
          custom_timing_hours?: number | null
          event_id: string
          id?: string
          is_active?: boolean | null
          send_timing?: string | null
          template_type: string
          variables?: string[] | null
        }
        Update: {
          content?: string
          custom_timing_hours?: number | null
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
      events: {
        Row: {
          booking_url: string | null
          brief: string | null
          capacity: number | null
          category_id: string | null
          created_at: string
          date: string
          doors_time: string | null
          duration_minutes: number | null
          end_time: string | null
          event_status: string | null
          facebook_event_description: string | null
          facebook_event_name: string | null
          gallery_image_urls: Json | null
          gbp_event_description: string | null
          gbp_event_title: string | null
          hero_image_url: string | null
          highlight_video_urls: Json | null
          highlights: Json | null
          id: string
          is_free: boolean | null
          keywords: Json | null
          last_entry_time: string | null
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          performer_name: string | null
          performer_type: string | null
          poster_image_url: string | null
          price: number | null
          promo_video_url: string | null
          short_description: string | null
          slug: string
          thumbnail_image_url: string | null
          time: string
        }
        Insert: {
          booking_url?: string | null
          brief?: string | null
          capacity?: number | null
          category_id?: string | null
          created_at?: string
          date: string
          doors_time?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          event_status?: string | null
          facebook_event_description?: string | null
          facebook_event_name?: string | null
          gallery_image_urls?: Json | null
          gbp_event_description?: string | null
          gbp_event_title?: string | null
          hero_image_url?: string | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          id?: string
          is_free?: boolean | null
          keywords?: Json | null
          last_entry_time?: string | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          performer_name?: string | null
          performer_type?: string | null
          poster_image_url?: string | null
          price?: number | null
          promo_video_url?: string | null
          short_description?: string | null
          slug: string
          thumbnail_image_url?: string | null
          time: string
        }
        Update: {
          booking_url?: string | null
          brief?: string | null
          capacity?: number | null
          category_id?: string | null
          created_at?: string
          date?: string
          doors_time?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          event_status?: string | null
          facebook_event_description?: string | null
          facebook_event_name?: string | null
          gallery_image_urls?: Json | null
          gbp_event_description?: string | null
          gbp_event_title?: string | null
          hero_image_url?: string | null
          highlight_video_urls?: Json | null
          highlights?: Json | null
          id?: string
          is_free?: boolean | null
          keywords?: Json | null
          last_entry_time?: string | null
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          performer_name?: string | null
          performer_type?: string | null
          poster_image_url?: string | null
          price?: number | null
          promo_video_url?: string | null
          short_description?: string | null
          slug?: string
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
      idempotency_keys: {
        Row: {
          expires_at: string
          key: string
          request_hash: string
          response: Json
        }
        Insert: {
          expires_at?: string
          key: string
          request_hash: string
          response: Json
        }
        Update: {
          expires_at?: string
          key?: string
          request_hash?: string
          response?: Json
        }
        Relationships: []
      }
      invoice_email_logs: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          invoice_id: string | null
          sent_by: string | null
          sent_to: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          sent_by?: string | null
          sent_to?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
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
        ]
      }
      invoice_line_items: {
        Row: {
          catalog_item_id: string | null
          description: string
          discount_percentage: number | null
          invoice_id: string
          quantity: number | null
          unit_price: number | null
          vat_rate: number | null
        }
        Insert: {
          catalog_item_id?: string | null
          description: string
          discount_percentage?: number | null
          invoice_id: string
          quantity?: number | null
          unit_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          catalog_item_id?: string | null
          description?: string
          discount_percentage?: number | null
          invoice_id?: string
          quantity?: number | null
          unit_price?: number | null
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
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
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
          exclude_vendors: string[] | null
        }
        Insert: {
          exclude_vendors?: string[] | null
        }
        Update: {
          exclude_vendors?: string[] | null
        }
        Relationships: []
      }
      invoice_series: {
        Row: {
          current_sequence: number | null
          series_code: string
        }
        Insert: {
          current_sequence?: number | null
          series_code: string
        }
        Update: {
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
          vendor_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_primary?: boolean
          name?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_primary?: boolean
          name?: string | null
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
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          payment_terms: number | null
          phone: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          payment_terms?: number | null
          phone?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          payment_terms?: number | null
          phone?: string | null
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
          created_at: string | null
          id: string
          started_at: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
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
          id: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_campaigns: {
        Row: {
          active: boolean | null
          bonus_type: string
          bonus_value: number
          end_date: string
          start_date: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          bonus_type: string
          bonus_value: number
          end_date: string
          start_date: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          bonus_type?: string
          bonus_value?: number
          end_date?: string
          start_date?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_challenges: {
        Row: {
          id: string
          sort_order: number | null
          start_date: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          sort_order?: number | null
          start_date: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          sort_order?: number | null
          start_date?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_members: {
        Row: {
          access_token: string | null
          available_points: number | null
          created_at: string | null
          customer_id: string | null
          id: string
          join_date: string | null
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
          created_by: string | null
          description: string | null
          member_id: string | null
          points: number
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
        }
        Insert: {
          balance_after: number
          created_by?: string | null
          description?: string | null
          member_id?: string | null
          points: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
        }
        Update: {
          balance_after?: number
          created_by?: string | null
          description?: string | null
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
          description: string | null
          icon: string | null
          id: string
          metadata: Json | null
          name: string
          points_cost: number
          program_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          metadata?: Json | null
          name: string
          points_cost: number
          program_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          points_cost?: number
          program_id?: string | null
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
        ]
      }
      loyalty_tiers: {
        Row: {
          benefits: Json | null
          color: string | null
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
      menu_categories: {
        Row: {
          code: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
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
          menu_id: string
          sort_order: number
        }
        Insert: {
          category_id: string
          menu_id: string
          sort_order?: number
        }
        Update: {
          category_id?: string
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
          dish_id: string
          id: string
          ingredient_id: string
          notes: string | null
          quantity: number
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at: string
          wastage_pct: number
          yield_pct: number
        }
        Insert: {
          cost_override?: number | null
          dish_id: string
          id?: string
          ingredient_id: string
          notes?: string | null
          quantity?: number
          unit: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
          wastage_pct?: number
          yield_pct?: number
        }
        Update: {
          cost_override?: number | null
          dish_id?: string
          id?: string
          ingredient_id?: string
          notes?: string | null
          quantity?: number
          unit?: Database["public"]["Enums"]["menu_unit"]
          updated_at?: string
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
        ]
      }
      menu_dish_menu_assignments: {
        Row: {
          available_from: string | null
          available_until: string | null
          category_id: string
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
          dish_id: string
          id: string
          notes: string | null
          quantity: number
          recipe_id: string
          updated_at: string
          wastage_pct: number
          yield_pct: number
        }
        Insert: {
          cost_override?: number | null
          dish_id: string
          id?: string
          notes?: string | null
          quantity?: number
          recipe_id: string
          updated_at?: string
          wastage_pct?: number
          yield_pct?: number
        }
        Update: {
          cost_override?: number | null
          dish_id?: string
          id?: string
          notes?: string | null
          quantity?: number
          recipe_id?: string
          updated_at?: string
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
          calories: number | null
          description: string | null
          dietary_flags: string[]
          gp_pct: number | null
          id: string
          image_url: string | null
          is_active: boolean
          is_gp_alert: boolean
          is_sunday_lunch: boolean
          name: string
          notes: string | null
          portion_cost: number
          selling_price: number
          slug: string | null
          target_gp_pct: number
          updated_at: string
        }
        Insert: {
          allergen_flags?: string[]
          calories?: number | null
          description?: string | null
          dietary_flags?: string[]
          gp_pct?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_gp_alert?: boolean
          is_sunday_lunch?: boolean
          name: string
          notes?: string | null
          portion_cost?: number
          selling_price?: number
          slug?: string | null
          target_gp_pct?: number
          updated_at?: string
        }
        Update: {
          allergen_flags?: string[]
          calories?: number | null
          description?: string | null
          dietary_flags?: string[]
          gp_pct?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_gp_alert?: boolean
          is_sunday_lunch?: boolean
          name?: string
          notes?: string | null
          portion_cost?: number
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
        ]
      }
      menu_ingredients: {
        Row: {
          allergens: string[]
          brand: string | null
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
          shelf_life_days: number | null
          storage_type: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name: string | null
          supplier_sku: string | null
          updated_at: string
          wastage_pct: number
        }
        Insert: {
          allergens?: string[]
          brand?: string | null
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
          shelf_life_days?: number | null
          storage_type?: Database["public"]["Enums"]["menu_storage_type"]
          supplier_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
          wastage_pct?: number
        }
        Update: {
          allergens?: string[]
          brand?: string | null
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
          image_url: string | null
        }
        Insert: {
          image_url?: string | null
        }
        Update: {
          image_url?: string | null
        }
        Relationships: []
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
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
      message_delivery_status: {
        Row: {
          created_at: string
          message_id: string
          note: string | null
          status: string
        }
        Insert: {
          created_at?: string
          message_id: string
          note?: string | null
          status: string
        }
        Update: {
          created_at?: string
          message_id?: string
          note?: string | null
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
          changed_by: string | null
          content: string
          template_id: string | null
        }
        Insert: {
          changed_by?: string | null
          content: string
          template_id?: string | null
        }
        Update: {
          changed_by?: string | null
          content?: string
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
        ]
      }
      message_templates: {
        Row: {
          content: string
          created_at: string
          custom_timing_hours: number | null
          description: string | null
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
          content: string
          created_at?: string
          custom_timing_hours?: number | null
          description?: string | null
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
          content?: string
          created_at?: string
          custom_timing_hours?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          send_timing?: string
          template_type?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          cost_usd: number | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          from_number: string | null
          id: string
          message_sid: string
          message_type: string | null
          price: number | null
          read_at: string | null
          segments: number | null
          sent_at: string | null
          status: string
          to_number: string | null
          twilio_message_sid: string | null
          twilio_status: string | null
        }
        Insert: {
          body: string
          cost_usd?: number | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_number?: string | null
          id?: string
          message_sid: string
          message_type?: string | null
          price?: number | null
          read_at?: string | null
          segments?: number | null
          sent_at?: string | null
          status: string
          to_number?: string | null
          twilio_message_sid?: string | null
          twilio_status?: string | null
        }
        Update: {
          body?: string
          cost_usd?: number | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_number?: string | null
          id?: string
          message_sid?: string
          message_type?: string | null
          price?: number | null
          read_at?: string | null
          segments?: number | null
          sent_at?: string | null
          status?: string
          to_number?: string | null
          twilio_message_sid?: string | null
          twilio_status?: string | null
        }
        Relationships: [
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
        ]
      }
      parking_booking_notifications: {
        Row: {
          booking_id: string
          channel: Database["public"]["Enums"]["parking_notification_channel"]
          created_at: string
          event_type: Database["public"]["Enums"]["parking_notification_event"]
          id: string
          message_sid: string | null
          payload: Json | null
        }
        Insert: {
          booking_id: string
          channel: Database["public"]["Enums"]["parking_notification_channel"]
          created_at?: string
          event_type: Database["public"]["Enums"]["parking_notification_event"]
          id?: string
          message_sid?: string | null
          payload?: Json | null
        }
        Update: {
          booking_id?: string
          channel?: Database["public"]["Enums"]["parking_notification_channel"]
          created_at?: string
          event_type?: Database["public"]["Enums"]["parking_notification_event"]
          id?: string
          message_sid?: string | null
          payload?: Json | null
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
          booking_id: string
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          paid_at: string | null
          paypal_order_id: string | null
          provider: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["parking_payment_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          paypal_order_id?: string | null
          provider?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["parking_payment_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          paypal_order_id?: string | null
          provider?: string
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
          capacity_override: boolean | null
          capacity_override_reason: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          customer_first_name: string
          customer_id: string | null
          customer_last_name: string | null
          customer_mobile: string
          end_at: string
          end_notification_sent: boolean | null
          id: string
          notes: string | null
          override_price: number | null
          override_reason: string | null
          payment_due_at: string | null
          payment_overdue_notified: boolean | null
          payment_status: Database["public"]["Enums"]["parking_payment_status"]
          reference: string
          start_at: string
          start_notification_sent: boolean | null
          status: Database["public"]["Enums"]["parking_booking_status"]
          updated_at: string
          vehicle_colour: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_registration: string
        }
        Insert: {
          capacity_override?: boolean | null
          capacity_override_reason?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_first_name: string
          customer_id?: string | null
          customer_last_name?: string | null
          customer_mobile: string
          end_at: string
          end_notification_sent?: boolean | null
          id?: string
          notes?: string | null
          override_price?: number | null
          override_reason?: string | null
          payment_due_at?: string | null
          payment_overdue_notified?: boolean | null
          payment_status?: Database["public"]["Enums"]["parking_payment_status"]
          reference: string
          start_at: string
          start_notification_sent?: boolean | null
          status?: Database["public"]["Enums"]["parking_booking_status"]
          updated_at?: string
          vehicle_colour?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_registration: string
        }
        Update: {
          capacity_override?: boolean | null
          capacity_override_reason?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_first_name?: string
          customer_id?: string | null
          customer_last_name?: string | null
          customer_mobile?: string
          end_at?: string
          end_notification_sent?: boolean | null
          id?: string
          notes?: string | null
          override_price?: number | null
          override_reason?: string | null
          payment_due_at?: string | null
          payment_overdue_notified?: boolean | null
          payment_status?: Database["public"]["Enums"]["parking_payment_status"]
          reference?: string
          start_at?: string
          start_notification_sent?: boolean | null
          status?: Database["public"]["Enums"]["parking_booking_status"]
          updated_at?: string
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
        ]
      }
      parking_rates: {
        Row: {
          capacity_override: number | null
          daily_rate: number
          effective_from: string
          hourly_rate: number
          monthly_rate: number
          notes: string | null
          weekly_rate: number
        }
        Insert: {
          capacity_override?: number | null
          daily_rate: number
          effective_from?: string
          hourly_rate: number
          monthly_rate: number
          notes?: string | null
          weekly_rate: number
        }
        Update: {
          capacity_override?: number | null
          daily_rate?: number
          effective_from?: string
          hourly_rate?: number
          monthly_rate?: number
          notes?: string | null
          weekly_rate?: number
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
      pl_manual_actuals: {
        Row: {
          metric_key: string
          timeframe: string
        }
        Insert: {
          metric_key: string
          timeframe: string
        }
        Update: {
          metric_key?: string
          timeframe?: string
        }
        Relationships: []
      }
      pl_targets: {
        Row: {
          metric_key: string
          timeframe: string
        }
        Insert: {
          metric_key: string
          timeframe: string
        }
        Update: {
          metric_key?: string
          timeframe?: string
        }
        Relationships: []
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
      private_booking_documents: {
        Row: {
          booking_id: string
        }
        Insert: {
          booking_id: string
        }
        Update: {
          booking_id?: string
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
        ]
      }
      private_booking_items: {
        Row: {
          booking_id: string
          created_at: string
          description: string
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
          vendor_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          description: string
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
          vendor_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          description?: string
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
      private_bookings: {
        Row: {
          accessibility_needs: string | null
          balance_due_date: string | null
          calendar_event_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          contact_email: string | null
          contact_phone: string | null
          contract_note: string | null
          contract_version: number | null
          created_at: string
          created_by: string | null
          customer_first_name: string | null
          customer_full_name: string | null
          customer_id: string | null
          customer_last_name: string | null
          customer_name: string
          customer_requests: string | null
          deposit_amount: number | null
          deposit_paid_date: string | null
          deposit_payment_method: string | null
          discount_amount: number | null
          discount_reason: string | null
          discount_type: string | null
          end_time: string | null
          end_time_next_day: boolean | null
          event_date: string
          event_type: string | null
          final_payment_date: string | null
          final_payment_method: string | null
          guest_count: number | null
          hold_expiry: string | null
          id: string
          internal_notes: string | null
          setup_date: string | null
          setup_time: string | null
          source: string | null
          special_requirements: string | null
          start_time: string
          status: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          accessibility_needs?: string | null
          balance_due_date?: string | null
          calendar_event_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contract_note?: string | null
          contract_version?: number | null
          created_at?: string
          created_by?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_name: string
          customer_requests?: string | null
          deposit_amount?: number | null
          deposit_paid_date?: string | null
          deposit_payment_method?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          discount_type?: string | null
          end_time?: string | null
          end_time_next_day?: boolean | null
          event_date: string
          event_type?: string | null
          final_payment_date?: string | null
          final_payment_method?: string | null
          guest_count?: number | null
          hold_expiry?: string | null
          id?: string
          internal_notes?: string | null
          setup_date?: string | null
          setup_time?: string | null
          source?: string | null
          special_requirements?: string | null
          start_time: string
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          accessibility_needs?: string | null
          balance_due_date?: string | null
          calendar_event_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contract_note?: string | null
          contract_version?: number | null
          created_at?: string
          created_by?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_name?: string
          customer_requests?: string | null
          deposit_amount?: number | null
          deposit_paid_date?: string | null
          deposit_payment_method?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          discount_type?: string | null
          end_time?: string | null
          end_time_next_day?: boolean | null
          event_date?: string
          event_type?: string | null
          final_payment_date?: string | null
          final_payment_method?: string | null
          guest_count?: number | null
          hold_expiry?: string | null
          id?: string
          internal_notes?: string | null
          setup_date?: string | null
          setup_time?: string | null
          source?: string | null
          special_requirements?: string | null
          start_time?: string
          status?: string | null
          total_amount?: number | null
          updated_at?: string
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
          email: string | null
          email_notifications: boolean | null
          full_name: string | null
          id: string
          sms_notifications: boolean | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          email?: string | null
          email_notifications?: boolean | null
          full_name?: string | null
          id: string
          sms_notifications?: boolean | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          email?: string | null
          email_notifications?: boolean | null
          full_name?: string | null
          id?: string
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
      receipt_batches: {
        Row: {
          id: string
          notes: string | null
          original_filename: string
          row_count: number
          source_hash: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          notes?: string | null
          original_filename: string
          row_count?: number
          source_hash?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          notes?: string | null
          original_filename?: string
          row_count?: number
          source_hash?: string | null
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
      receipt_files: {
        Row: {
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          storage_path: string
          transaction_id: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          transaction_id: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          transaction_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
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
      receipt_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          set_expense_category: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          set_expense_category?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          set_expense_category?: string | null
          updated_at?: string
          updated_by?: string | null
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
            foreignKeyName: "receipt_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users_view"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_transaction_logs: {
        Row: {
          action_type: string
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
            referencedRelation: "receipt_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_transactions: {
        Row: {
          amount_in: number | null
          amount_out: number | null
          balance: number | null
          batch_id: string | null
          dedupe_hash: string
          details: string
          expense_category: string | null
          expense_category_source: string | null
          id: string
          marked_at: string | null
          marked_by: string | null
          marked_by_email: string | null
          marked_by_name: string | null
          marked_method: string | null
          receipt_required: boolean
          rule_applied_id: string | null
          status: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date: string
          transaction_type: string | null
          updated_at: string
          vendor_name: string | null
          vendor_source: string | null
        }
        Insert: {
          amount_in?: number | null
          amount_out?: number | null
          balance?: number | null
          batch_id?: string | null
          dedupe_hash: string
          details: string
          expense_category?: string | null
          expense_category_source?: string | null
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          marked_by_email?: string | null
          marked_by_name?: string | null
          marked_method?: string | null
          receipt_required?: boolean
          rule_applied_id?: string | null
          status?: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date: string
          transaction_type?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_source?: string | null
        }
        Update: {
          amount_in?: number | null
          amount_out?: number | null
          balance?: number | null
          batch_id?: string | null
          dedupe_hash?: string
          details?: string
          expense_category?: string | null
          expense_category_source?: string | null
          id?: string
          marked_at?: string | null
          marked_by?: string | null
          marked_by_email?: string | null
          marked_by_name?: string | null
          marked_method?: string | null
          receipt_required?: boolean
          rule_applied_id?: string | null
          status?: Database["public"]["Enums"]["receipt_transaction_status"]
          transaction_date?: string
          transaction_type?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_source?: string | null
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
          id: string
          is_active: boolean | null
          last_invoice_id: string | null
          next_invoice_date: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_invoice_id?: string | null
          next_invoice_date: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_invoice_id?: string | null
          next_invoice_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_last_invoice_id_fkey"
            columns: ["last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_processing_logs: {
        Row: {
          booking_id: string | null
          customer_id: string | null
          error_details: Json | null
          event_id: string | null
          message: string | null
          metadata: Json | null
          processing_type: string
          reminder_type: string | null
          template_type: string | null
        }
        Insert: {
          booking_id?: string | null
          customer_id?: string | null
          error_details?: Json | null
          event_id?: string | null
          message?: string | null
          metadata?: Json | null
          processing_type: string
          reminder_type?: string | null
          template_type?: string | null
        }
        Update: {
          booking_id?: string | null
          customer_id?: string | null
          error_details?: Json | null
          event_id?: string | null
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
          description: string | null
          id: string
          is_system: boolean | null
          name: string
        }
        Insert: {
          description?: string | null
          id?: string
          is_system?: boolean | null
          name: string
        }
        Update: {
          description?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
        }
        Relationships: []
      }
      service_slot_config: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          day_of_week: number
          ends_at: string
          is_active: boolean | null
          slot_type: string
          starts_at: string
          updated_at: string | null
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          day_of_week: number
          ends_at: string
          is_active?: boolean | null
          slot_type: string
          starts_at: string
          updated_at?: string | null
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          day_of_week?: number
          ends_at?: string
          is_active?: boolean | null
          slot_type?: string
          starts_at?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      service_slots: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          ends_at: string
          is_active: boolean
          service_date: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          capacity: number
          ends_at: string
          is_active?: boolean
          service_date: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          capacity?: number
          ends_at?: string
          is_active?: boolean
          service_date?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_status_overrides: {
        Row: {
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
          service_code: string
          updated_at: string
        }
        Insert: {
          display_name: string
          is_enabled?: boolean
          message?: string | null
          service_code: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          is_enabled?: boolean
          message?: string | null
          service_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      short_link_clicks: {
        Row: {
          browser: string | null
          city: string | null
          clicked_at: string | null
          country: string | null
          device_type: string | null
          ip_address: unknown
          os: string | null
          referrer: string | null
          region: string | null
          short_link_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          ip_address?: unknown
          os?: string | null
          referrer?: string | null
          region?: string | null
          short_link_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          ip_address?: unknown
          os?: string | null
          referrer?: string | null
          region?: string | null
          short_link_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
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
        ]
      }
      sites: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      special_hours: {
        Row: {
          date: string
          id: string
          is_closed: boolean | null
          is_kitchen_closed: boolean | null
          kitchen_closes: string | null
          kitchen_opens: string | null
          note: string | null
          schedule_config: Json | null
        }
        Insert: {
          date: string
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          note?: string | null
          schedule_config?: Json | null
        }
        Update: {
          date?: string
          id?: string
          is_closed?: boolean | null
          is_kitchen_closed?: boolean | null
          kitchen_closes?: string | null
          kitchen_opens?: string | null
          note?: string | null
          schedule_config?: Json | null
        }
        Relationships: []
      }
      sunday_lunch_menu_items: {
        Row: {
          allergens: string[] | null
          category: string
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
          description: string | null
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      table_booking_items: {
        Row: {
          booking_id: string
          created_at: string | null
          custom_item_name: string | null
          guest_name: string | null
          id: string
          item_type: Database["public"]["Enums"]["booking_item_type"]
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
        ]
      }
      table_booking_modifications: {
        Row: {
          booking_id: string
          modification_type: string
          modified_by: string | null
          new_values: Json | null
          old_values: Json | null
        }
        Insert: {
          booking_id: string
          modification_type: string
          modified_by?: string | null
          new_values?: Json | null
          old_values?: Json | null
        }
        Update: {
          booking_id?: string
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
        ]
      }
      table_booking_sms_templates: {
        Row: {
          booking_type: Database["public"]["Enums"]["table_booking_type"] | null
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
          booking_date: string
          booking_reference: string
          booking_time: string
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason: string | null
          cancelled_at: string | null
          celebration_type: string | null
          completed_at: string | null
          confirmed_at: string | null
          correlation_id: string | null
          created_at: string | null
          customer_id: string | null
          dietary_requirements: string[] | null
          duration_minutes: number | null
          id: string
          no_show_at: string | null
          original_booking_data: Json | null
          party_size: number
          payment_method:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          reminder_sent: boolean | null
          source: string | null
          special_requirements: string | null
          status: Database["public"]["Enums"]["table_booking_status"]
          tables_assigned: Json | null
          updated_at: string | null
        }
        Insert: {
          allergies?: string[] | null
          booking_date: string
          booking_reference: string
          booking_time: string
          booking_type: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason?: string | null
          cancelled_at?: string | null
          celebration_type?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          dietary_requirements?: string[] | null
          duration_minutes?: number | null
          id?: string
          no_show_at?: string | null
          original_booking_data?: Json | null
          party_size: number
          payment_method?:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          reminder_sent?: boolean | null
          source?: string | null
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["table_booking_status"]
          tables_assigned?: Json | null
          updated_at?: string | null
        }
        Update: {
          allergies?: string[] | null
          booking_date?: string
          booking_reference?: string
          booking_time?: string
          booking_type?: Database["public"]["Enums"]["table_booking_type"]
          cancellation_reason?: string | null
          cancelled_at?: string | null
          celebration_type?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          dietary_requirements?: string[] | null
          duration_minutes?: number | null
          id?: string
          no_show_at?: string | null
          original_booking_data?: Json | null
          party_size?: number
          payment_method?:
            | Database["public"]["Enums"]["table_booking_payment_method"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          reminder_sent?: boolean | null
          source?: string | null
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["table_booking_status"]
          tables_assigned?: Json | null
          updated_at?: string | null
        }
        Relationships: [
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
      table_combination_tables: {
        Row: {
          combination_id: string
          table_id: string
        }
        Insert: {
          combination_id: string
          table_id: string
        }
        Update: {
          combination_id?: string
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
          id: string
          is_active: boolean | null
          name: string | null
          preferred_for_size: number[] | null
          table_ids: string[]
          total_capacity: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          name?: string | null
          preferred_for_size?: number[] | null
          table_ids: string[]
          total_capacity: number
          updated_at?: string | null
        }
        Update: {
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
          id: string
          is_active: boolean | null
          notes: string | null
          table_number: string
          updated_at: string | null
        }
        Insert: {
          capacity: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          table_number: string
          updated_at?: string | null
        }
        Update: {
          capacity?: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          table_number?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      tables: {
        Row: {
          capacity: number
          created_at: string | null
          id: string
          notes: string | null
          table_number: string
          updated_at: string | null
        }
        Insert: {
          capacity: number
          created_at?: string | null
          id?: string
          notes?: string | null
          table_number: string
          updated_at?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          table_number?: string
          updated_at?: string | null
        }
        Relationships: []
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
          contact_email: string | null
          contact_name: string | null
          credit_limit: number | null
          id: string
          invoice_categories: string[] | null
          invoice_contact_name: string | null
          invoice_email: string | null
          name: string
          payment_terms: number | null
          preferred: boolean | null
          preferred_delivery_method: string | null
          purchase_order_required: boolean | null
          service_type: string
          tax_exempt: boolean | null
          tax_exempt_number: string | null
          typical_rate: string | null
        }
        Insert: {
          active?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          credit_limit?: number | null
          id?: string
          invoice_categories?: string[] | null
          invoice_contact_name?: string | null
          invoice_email?: string | null
          name: string
          payment_terms?: number | null
          preferred?: boolean | null
          preferred_delivery_method?: string | null
          purchase_order_required?: boolean | null
          service_type: string
          tax_exempt?: boolean | null
          tax_exempt_number?: string | null
          typical_rate?: string | null
        }
        Update: {
          active?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          credit_limit?: number | null
          id?: string
          invoice_categories?: string[] | null
          invoice_contact_name?: string | null
          invoice_email?: string | null
          name?: string
          payment_terms?: number | null
          preferred?: boolean | null
          preferred_delivery_method?: string | null
          purchase_order_required?: boolean | null
          service_type?: string
          tax_exempt?: boolean | null
          tax_exempt_number?: string | null
          typical_rate?: string | null
        }
        Relationships: []
      }
      venue_spaces: {
        Row: {
          display_order: number | null
          id: string
          name: string
        }
        Insert: {
          display_order?: number | null
          id?: string
          name: string
        }
        Update: {
          display_order?: number | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          body: string | null
          customer_id: string | null
          error_details: Json | null
          error_message: string | null
          from_number: string | null
          headers: Json | null
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
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
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
          is_special: boolean | null
          is_sunday_lunch: boolean | null
          menu_code: string | null
          menu_id: string | null
          menu_name: string | null
          name: string | null
          notes: string | null
          portion_cost: number | null
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
          guest_count: number | null
          id: string | null
          internal_notes: string | null
          setup_date: string | null
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
    }
    Functions: {
      apply_customer_labels_retroactively: { Args: never; Returns: undefined }
      auto_generate_weekly_slots: { Args: never; Returns: Json }
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
      create_dish_transaction: {
        Args: {
          p_assignments?: Json
          p_dish_data: Json
          p_ingredients?: Json
          p_recipes?: Json
        }
        Returns: Json
      }
      create_employee_transaction: {
        Args: {
          p_employee_data: Json
          p_financial_data?: Json
          p_health_data?: Json
        }
        Returns: Json
      }
      create_event_transaction: {
        Args: { p_event_data: Json; p_faqs?: Json }
        Returns: Json
      }
      create_invoice_transaction: {
        Args: { p_invoice_data: Json; p_line_items: Json }
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
      create_short_link:
        | {
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
        | {
            Args: {
              p_custom_code?: string
              p_destination_url: string
              p_expires_at?: string
              p_link_type: string
              p_metadata?: Json
            }
            Returns: Json
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
      create_table_booking_transaction: {
        Args: {
          p_booking_data: Json
          p_menu_items?: Json
          p_payment_data?: Json
        }
        Returns: Json
      }
      encrypt_sensitive_audit_data: {
        Args: { p_encryption_key: string }
        Returns: undefined
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
      get_and_increment_invoice_series: {
        Args: { p_series_code: string }
        Returns: {
          next_sequence: number
        }[]
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
      get_quarter_date_range: {
        Args: { p_quarter: number; p_year: number }
        Returns: {
          end_date: string
          start_date: string
        }[]
      }
      get_receipt_detail_groups: {
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
      import_receipt_batch_transaction: {
        Args: { p_batch_data: Json; p_transactions: Json }
        Returns: Json
      }
      increment_short_link_clicks: {
        Args: { p_short_link_id: string }
        Returns: {
          click_count: number
          last_clicked_at: string
        }[]
      }
      is_super_admin: { Args: { p_user_id: string }; Returns: boolean }
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
      process_pending_jobs: {
        Args: never
        Returns: {
          job_id: string
          job_type: string
        }[]
      }
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
      rebuild_customer_category_stats: { Args: never; Returns: number }
      record_invoice_payment_transaction: {
        Args: { p_payment_data: Json }
        Returns: Json
      }
      register_guest_transaction: {
        Args: {
          p_customer_data: Json
          p_event_id: string
          p_labels?: Json
          p_staff_id: string
        }
        Returns: Json
      }
      render_template: {
        Args: { p_template: string; p_variables: Json }
        Returns: string
      }
      restore_employee_version: {
        Args: {
          p_employee_id: string
          p_user_id: string
          p_version_number: number
        }
        Returns: Json
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
      update_menu_target_gp_transaction: {
        Args: {
          p_new_target_gp: number
          p_user_email?: string
          p_user_id?: string
        }
        Returns: Json
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
      receipt_transaction_status:
        | "pending"
        | "completed"
        | "auto_completed"
        | "no_receipt_required"
        | "cant_find"
      table_booking_payment_method: "payment_link" | "cash"
      table_booking_status:
        | "pending_payment"
        | "confirmed"
        | "cancelled"
        | "no_show"
        | "completed"
      table_booking_type: "regular" | "sunday_lunch"
    }
    CompositeTypes: {
      [_ in never]: never
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
      receipt_transaction_status: [
        "pending",
        "completed",
        "auto_completed",
        "no_receipt_required",
        "cant_find",
      ],
      table_booking_payment_method: ["payment_link", "cash"],
      table_booking_status: [
        "pending_payment",
        "confirmed",
        "cancelled",
        "no_show",
        "completed",
      ],
      table_booking_type: ["regular", "sunday_lunch"],
    },
  },
} as const
