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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_provision_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          email: string
          id: string
          profile_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          email: string
          id?: string
          profile_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          email?: string
          id?: string
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_provision_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_provision_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_provision_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_provision_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          created_at: string
          daily_budget: number | null
          developer_id: string | null
          external_id: string
          id: string
          name: string
          platform: string
          status: string | null
          synced_at: string | null
          total_spend: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_budget?: number | null
          developer_id?: string | null
          external_id: string
          id?: string
          name: string
          platform?: string
          status?: string | null
          synced_at?: string | null
          total_spend?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_budget?: number | null
          developer_id?: string | null
          external_id?: string
          id?: string
          name?: string
          platform?: string
          status?: string | null
          synced_at?: string | null
          total_spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_ips: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          ip_range: unknown
          label: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ip_range: unknown
          label: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ip_range?: unknown
          label?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_ips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowed_ips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowed_ips_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_results: {
        Row: {
          created_at: string
          id: string
          month: number
          notes: string | null
          sales_count: number
          updated_at: string
          updated_by: string | null
          vgv: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          notes?: string | null
          sales_count?: number
          updated_at?: string
          updated_by?: string | null
          vgv?: number
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          notes?: string | null
          sales_count?: number
          updated_at?: string
          updated_by?: string | null
          vgv?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_results_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_results_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_settings: {
        Row: {
          attend_timeout_seconds: number
          auto_first_contact: boolean
          id: boolean
          inactivity_alert_hours: number
          leads_paused: boolean
          no_response_hours: number
          notify_on_assign: boolean
          notify_on_timeout: boolean
          overdue_block_threshold: number
          roulette_max_rounds: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attend_timeout_seconds?: number
          auto_first_contact?: boolean
          id?: boolean
          inactivity_alert_hours?: number
          leads_paused?: boolean
          no_response_hours?: number
          notify_on_assign?: boolean
          notify_on_timeout?: boolean
          overdue_block_threshold?: number
          roulette_max_rounds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attend_timeout_seconds?: number
          auto_first_contact?: boolean
          id?: boolean
          inactivity_alert_hours?: number
          leads_paused?: boolean
          no_response_hours?: number
          notify_on_assign?: boolean
          notify_on_timeout?: boolean
          overdue_block_threshold?: number
          roulette_max_rounds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      cca_case_events: {
        Row: {
          actor_id: string | null
          case_id: string
          created_at: string
          detail: Json | null
          from_value: string | null
          id: string
          kind: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          case_id: string
          created_at?: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          case_id?: string
          created_at?: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cca_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cca_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cca_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cca_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cca_cases: {
        Row: {
          agency_name: string | null
          analysis: Json
          analyst_id: string | null
          created_at: string
          deal_id: string
          decided_at: string | null
          decision_notes: string | null
          id: string
          pending_items: Json
          stage_id: string | null
          status: Database["public"]["Enums"]["cca_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          agency_name?: string | null
          analysis?: Json
          analyst_id?: string | null
          created_at?: string
          deal_id: string
          decided_at?: string | null
          decision_notes?: string | null
          id?: string
          pending_items?: Json
          stage_id?: string | null
          status?: Database["public"]["Enums"]["cca_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          agency_name?: string | null
          analysis?: Json
          analyst_id?: string | null
          created_at?: string
          deal_id?: string
          decided_at?: string | null
          decision_notes?: string | null
          id?: string
          pending_items?: Json
          stage_id?: string | null
          status?: Database["public"]["Enums"]["cca_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cca_cases_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cca_cases_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cca_cases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cca_cases_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "cca_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      cca_stages: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          position: number
          status: Database["public"]["Enums"]["cca_status"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
          status?: Database["public"]["Enums"]["cca_status"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["cca_status"]
          updated_at?: string
        }
        Relationships: []
      }
      checkins: {
        Row: {
          auto_checkout: boolean
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          id: string
          ip_address: unknown
          leads_received: number
          profile_id: string
          shift_id: string
          work_date: string
        }
        Insert: {
          auto_checkout?: boolean
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          leads_received?: number
          profile_id: string
          shift_id: string
          work_date?: string
        }
        Update: {
          auto_checkout?: boolean
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          leads_received?: number
          profile_id?: string
          shift_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_months: {
        Row: {
          closed_at: string
          closed_by: string | null
          notes: string | null
          period: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          period: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "closed_months_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closed_months_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_entries: {
        Row: {
          analyses_approved: number
          analyses_sent: number
          calls: number
          created_at: string
          doc_collections: number
          id: string
          leads: number
          profile_id: string
          report_id: string
          sales: number
          updated_at: string
          visits_done: number
          visits_scheduled: number
        }
        Insert: {
          analyses_approved?: number
          analyses_sent?: number
          calls?: number
          created_at?: string
          doc_collections?: number
          id?: string
          leads?: number
          profile_id: string
          report_id: string
          sales?: number
          updated_at?: string
          visits_done?: number
          visits_scheduled?: number
        }
        Update: {
          analyses_approved?: number
          analyses_sent?: number
          calls?: number
          created_at?: string
          doc_collections?: number
          id?: string
          leads?: number
          profile_id?: string
          report_id?: string
          sales?: number
          updated_at?: string
          visits_done?: number
          visits_scheduled?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          created_at: string
          filled_by_name: string | null
          id: string
          notes: string | null
          report_date: string
          submitted_at: string | null
          submitted_by: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filled_by_name?: string | null
          id?: string
          notes?: string | null
          report_date?: string
          submitted_at?: string | null
          submitted_by?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filled_by_name?: string | null
          id?: string
          notes?: string | null
          report_date?: string
          submitted_at?: string | null
          submitted_by?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_clients: {
        Row: {
          activity_duration: string | null
          activity_form: string | null
          activity_segment: string | null
          admission_date: string | null
          birthplace: string | null
          cch_reference: string | null
          cpf: string | null
          created_at: string
          deal_id: string
          declares_income_tax: boolean | null
          dependents: string | null
          disclosure_form: string | null
          email: string | null
          full_name: string
          has_informal_income: boolean
          id: string
          income_notes: string | null
          is_shareholder: boolean | null
          marital_status: string | null
          monthly_income: number | null
          ordinal: number
          phone: string | null
          pis: string | null
          postal_code: string | null
          updated_at: string
        }
        Insert: {
          activity_duration?: string | null
          activity_form?: string | null
          activity_segment?: string | null
          admission_date?: string | null
          birthplace?: string | null
          cch_reference?: string | null
          cpf?: string | null
          created_at?: string
          deal_id: string
          declares_income_tax?: boolean | null
          dependents?: string | null
          disclosure_form?: string | null
          email?: string | null
          full_name: string
          has_informal_income?: boolean
          id?: string
          income_notes?: string | null
          is_shareholder?: boolean | null
          marital_status?: string | null
          monthly_income?: number | null
          ordinal?: number
          phone?: string | null
          pis?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Update: {
          activity_duration?: string | null
          activity_form?: string | null
          activity_segment?: string | null
          admission_date?: string | null
          birthplace?: string | null
          cch_reference?: string | null
          cpf?: string | null
          created_at?: string
          deal_id?: string
          declares_income_tax?: boolean | null
          dependents?: string | null
          disclosure_form?: string | null
          email?: string | null
          full_name?: string
          has_informal_income?: boolean
          id?: string
          income_notes?: string | null
          is_shareholder?: boolean | null
          marital_status?: string | null
          monthly_income?: number | null
          ordinal?: number
          phone?: string | null
          pis?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_clients_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_documents: {
        Row: {
          created_at: string
          deal_id: string
          document_type_id: string
          id: string
          mime_type: string | null
          original_name: string
          size_bytes: number | null
          storage_path: string
          stored_name: string
          superseded_at: string | null
          superseded_by: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          deal_id: string
          document_type_id: string
          id?: string
          mime_type?: string | null
          original_name: string
          size_bytes?: number | null
          storage_path: string
          stored_name: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          deal_id?: string
          document_type_id?: string
          id?: string
          mime_type?: string | null
          original_name?: string
          size_bytes?: number | null
          storage_path?: string
          stored_name?: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "deal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_history: {
        Row: {
          actor_id: string | null
          created_at: string
          deal_id: string
          detail: Json | null
          from_value: string | null
          id: string
          kind: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          deal_id: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          deal_id?: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_participants: {
        Row: {
          auto_added: boolean
          created_at: string
          deal_id: string
          id: string
          ordinal: number
          profile_id: string
          role: string
          share_pct: number
        }
        Insert: {
          auto_added?: boolean
          created_at?: string
          deal_id: string
          id?: string
          ordinal?: number
          profile_id: string
          role: string
          share_pct?: number
        }
        Update: {
          auto_added?: boolean
          created_at?: string
          deal_id?: string
          id?: string
          ordinal?: number
          profile_id?: string
          role?: string
          share_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_participants_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          closed_at: string | null
          code: string
          created_at: string
          created_by: string | null
          developer_id: string | null
          discount_pct: number
          document_review_reason: string | null
          document_review_requested_at: string | null
          document_review_requested_by: string | null
          document_review_status: string
          document_reviewed_at: string | null
          document_reviewed_by: string | null
          id: string
          lead_id: string | null
          lead_origin: string | null
          lost_reason: string | null
          month_base: string
          notes: string | null
          outcome: Database["public"]["Enums"]["deal_outcome"]
          project_id: string | null
          stage_entered_at: string
          stage_id: string
          status_detail: string | null
          unit: string | null
          updated_at: string
          vgv_gross: number | null
          vgv_net: number | null
        }
        Insert: {
          closed_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          developer_id?: string | null
          discount_pct?: number
          document_review_reason?: string | null
          document_review_requested_at?: string | null
          document_review_requested_by?: string | null
          document_review_status?: string
          document_reviewed_at?: string | null
          document_reviewed_by?: string | null
          id?: string
          lead_id?: string | null
          lead_origin?: string | null
          lost_reason?: string | null
          month_base?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["deal_outcome"]
          project_id?: string | null
          stage_entered_at?: string
          stage_id: string
          status_detail?: string | null
          unit?: string | null
          updated_at?: string
          vgv_gross?: number | null
          vgv_net?: number | null
        }
        Update: {
          closed_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          developer_id?: string | null
          discount_pct?: number
          document_review_reason?: string | null
          document_review_requested_at?: string | null
          document_review_requested_by?: string | null
          document_review_status?: string
          document_reviewed_at?: string | null
          document_reviewed_by?: string | null
          id?: string
          lead_id?: string | null
          lead_origin?: string | null
          lost_reason?: string | null
          month_base?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["deal_outcome"]
          project_id?: string | null
          stage_entered_at?: string
          stage_id?: string
          status_detail?: string | null
          unit?: string | null
          updated_at?: string
          vgv_gross?: number | null
          vgv_net?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_document_review_requested_by_fkey"
            columns: ["document_review_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_document_review_requested_by_fkey"
            columns: ["document_review_requested_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_document_reviewed_by_fkey"
            columns: ["document_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_document_reviewed_by_fkey"
            columns: ["document_reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "developer_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_projects: {
        Row: {
          active: boolean
          city: string | null
          created_at: string
          developer_id: string
          id: string
          name: string
          state: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          developer_id: string
          id?: string
          name: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          developer_id?: string
          id?: string
          name?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_projects_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_submissions: {
        Row: {
          attempts: number
          body: string | null
          cc_emails: string[] | null
          created_at: string
          deal_id: string
          developer_id: string
          document_ids: string[]
          id: string
          last_error: string | null
          requested_by: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          cc_emails?: string[] | null
          created_at?: string
          deal_id: string
          developer_id: string
          document_ids?: string[]
          id?: string
          last_error?: string | null
          requested_by?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          to_email: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string | null
          cc_emails?: string[] | null
          created_at?: string
          deal_id?: string
          developer_id?: string
          document_ids?: string[]
          id?: string
          last_error?: string | null
          requested_by?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_submissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_submissions_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_submissions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_submissions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      developers: {
        Row: {
          active: boolean
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          flow: Database["public"]["Enums"]["developer_flow"]
          id: string
          name: string
          notes: string | null
          slug: string
          submission_email: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          flow?: Database["public"]["Enums"]["developer_flow"]
          id?: string
          name: string
          notes?: string | null
          slug: string
          submission_email?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          flow?: Database["public"]["Enums"]["developer_flow"]
          id?: string
          name?: string
          notes?: string | null
          slug?: string
          submission_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      distribution_group_forms: {
        Row: {
          created_at: string
          form_id: string
          form_name: string | null
          group_id: string
        }
        Insert: {
          created_at?: string
          form_id: string
          form_name?: string | null
          group_id: string
        }
        Update: {
          created_at?: string
          form_id?: string
          form_name?: string | null
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_group_forms_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_group_members: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          profile_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id: string
          profile_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_groups: {
        Row: {
          active: boolean
          attend_timeout_seconds: number | null
          created_at: string
          id: string
          kind: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          attend_timeout_seconds?: number | null
          created_at?: string
          id?: string
          kind?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          attend_timeout_seconds?: number | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_types: {
        Row: {
          active: boolean
          allows_multiple: boolean
          category: string
          code: string
          created_at: string
          id: string
          label: string
          naming_pattern: string | null
          required_for_conversion: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allows_multiple?: boolean
          category?: string
          code: string
          created_at?: string
          id?: string
          label: string
          naming_pattern?: string | null
          required_for_conversion?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allows_multiple?: boolean
          category?: string
          code?: string
          created_at?: string
          id?: string
          label?: string
          naming_pattern?: string | null
          required_for_conversion?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      funnel_targets: {
        Row: {
          analysis_to_approval_pct: number
          approval_to_sale_pct: number
          created_at: string
          director_id: string | null
          effective_from: string
          id: string
          lead_to_analysis_pct: number
          scope: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          analysis_to_approval_pct?: number
          approval_to_sale_pct?: number
          created_at?: string
          director_id?: string | null
          effective_from?: string
          id?: string
          lead_to_analysis_pct?: number
          scope: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          analysis_to_approval_pct?: number
          approval_to_sale_pct?: number
          created_at?: string
          director_id?: string | null
          effective_from?: string
          id?: string
          lead_to_analysis_pct?: number
          scope?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_targets_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_targets_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_targets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      game_events: {
        Row: {
          created_at: string
          event_code: string
          id: string
          occurred_at: string
          points: number
          profile_id: string
          ref_id: string | null
          ref_type: string | null
          season_id: string
        }
        Insert: {
          created_at?: string
          event_code: string
          id?: string
          occurred_at?: string
          points: number
          profile_id: string
          ref_id?: string | null
          ref_type?: string | null
          season_id: string
        }
        Update: {
          created_at?: string
          event_code?: string
          id?: string
          occurred_at?: string
          points?: number
          profile_id?: string
          ref_id?: string | null
          ref_type?: string | null
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "game_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      game_scoring_rules: {
        Row: {
          active: boolean
          created_at: string
          event_code: string
          id: string
          label: string
          points: number
          season_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_code: string
          id?: string
          label: string
          points: number
          season_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_code?: string
          id?: string
          label?: string
          points?: number
          season_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scoring_rules_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "game_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      game_season_results: {
        Row: {
          breakdown: Json
          frozen_at: string
          points: number
          profile_id: string
          rank: number
          sales: number
          season_id: string
          vgv: number
        }
        Insert: {
          breakdown?: Json
          frozen_at?: string
          points: number
          profile_id: string
          rank: number
          sales?: number
          season_id: string
          vgv?: number
        }
        Update: {
          breakdown?: Json
          frozen_at?: string
          points?: number
          profile_id?: string
          rank?: number
          sales?: number
          season_id?: string
          vgv?: number
        }
        Relationships: [
          {
            foreignKeyName: "game_season_results_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_season_results_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_season_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "game_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      game_seasons: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          label: string
          period_end: string | null
          period_start: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          label: string
          period_end?: string | null
          period_start?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          label?: string
          period_end?: string | null
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_seasons_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_seasons_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metric: string
          period: string
          period_type: string
          profile_id: string | null
          scope: string
          target: number
          team_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric: string
          period: string
          period_type: string
          profile_id?: string | null
          scope: string
          target: number
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric?: string
          period?: string
          period_type?: string
          profile_id?: string | null
          scope?: string
          target?: number
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_tips: {
        Row: {
          active: boolean
          author_id: string | null
          body: string
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gold_tips_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_tips_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      important_notices: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          severity: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          severity?: string
          starts_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          severity?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "important_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "important_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assigned_at: string
          deadline: string
          group_id: string | null
          id: string
          lead_id: string
          profile_id: string
          release_reason:
            | Database["public"]["Enums"]["lead_release_reason"]
            | null
          released_at: string | null
          responded_at: string | null
          sequence: number
        }
        Insert: {
          assigned_at?: string
          deadline: string
          group_id?: string | null
          id?: string
          lead_id: string
          profile_id: string
          release_reason?:
            | Database["public"]["Enums"]["lead_release_reason"]
            | null
          released_at?: string | null
          responded_at?: string | null
          sequence?: number
        }
        Update: {
          assigned_at?: string
          deadline?: string
          group_id?: string | null
          id?: string
          lead_id?: string
          profile_id?: string
          release_reason?:
            | Database["public"]["Enums"]["lead_release_reason"]
            | null
          released_at?: string | null
          responded_at?: string | null
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_attachments: {
        Row: {
          created_at: string
          document_type_id: string | null
          id: string
          lead_id: string
          mime_type: string | null
          original_name: string
          size_bytes: number | null
          storage_path: string
          stored_name: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_type_id?: string | null
          id?: string
          lead_id: string
          mime_type?: string | null
          original_name: string
          size_bytes?: number | null
          storage_path: string
          stored_name: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_type_id?: string | null
          id?: string
          lead_id?: string
          mime_type?: string | null
          original_name?: string
          size_bytes?: number | null
          storage_path?: string
          stored_name?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_attachments_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          lead_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          lead_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json | null
          from_value: string | null
          id: string
          kind: string
          lead_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind: string
          lead_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_value?: string | null
          id?: string
          kind?: string
          lead_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          active: boolean
          channel: string
          code: string
          created_at: string
          form_id: string | null
          id: string
          label: string
          sdr_agent_id: string | null
          updated_at: string
          welcome_template_id: string | null
        }
        Insert: {
          active?: boolean
          channel?: string
          code: string
          created_at?: string
          form_id?: string | null
          id?: string
          label: string
          sdr_agent_id?: string | null
          updated_at?: string
          welcome_template_id?: string | null
        }
        Update: {
          active?: boolean
          channel?: string
          code?: string
          created_at?: string
          form_id?: string | null
          id?: string
          label?: string
          sdr_agent_id?: string | null
          updated_at?: string
          welcome_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_sources_sdr_agent_id_fkey"
            columns: ["sdr_agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sources_welcome_template_id_fkey"
            columns: ["welcome_template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          assigned_at: string | null
          assigned_to: string | null
          attend_deadline: string | null
          campaign_id: string | null
          campaign_name: string | null
          converted_at: string | null
          converted_deal_id: string | null
          created_at: string
          distribution_group_id: string | null
          document: string | null
          email: string | null
          external_id: string | null
          first_contact_at: string | null
          form_id: string | null
          full_name: string
          funnel_stage: Database["public"]["Enums"]["lead_funnel_stage"]
          id: string
          landing_page: string | null
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          next_action_at: string | null
          notes: string | null
          phone: string | null
          phone_raw: string | null
          raw_payload: Json | null
          roulette_misses: number
          sdr_qualified_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          attend_deadline?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          converted_at?: string | null
          converted_deal_id?: string | null
          created_at?: string
          distribution_group_id?: string | null
          document?: string | null
          email?: string | null
          external_id?: string | null
          first_contact_at?: string | null
          form_id?: string | null
          full_name: string
          funnel_stage?: Database["public"]["Enums"]["lead_funnel_stage"]
          id?: string
          landing_page?: string | null
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_action_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_raw?: string | null
          raw_payload?: Json | null
          roulette_misses?: number
          sdr_qualified_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          attend_deadline?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          converted_at?: string | null
          converted_deal_id?: string | null
          created_at?: string
          distribution_group_id?: string | null
          document?: string | null
          email?: string | null
          external_id?: string | null
          first_contact_at?: string | null
          form_id?: string | null
          full_name?: string
          funnel_stage?: Database["public"]["Enums"]["lead_funnel_stage"]
          id?: string
          landing_page?: string | null
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_action_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_raw?: string | null
          raw_payload?: Json | null
          roulette_misses?: number
          sdr_qualified_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_deal_id_fkey"
            columns: ["converted_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_distribution_group_id_fkey"
            columns: ["distribution_group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_investments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          developer_id: string
          id: string
          notes: string | null
          period: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          developer_id: string
          id?: string
          notes?: string | null
          period: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          developer_id?: string
          id?: string
          notes?: string | null
          period?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_investments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_investments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_investments_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      month_reopenings: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          id: string
          period: string
          reopened_at: string
          reopened_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          period: string
          reopened_at?: string
          reopened_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          period?: string
          reopened_at?: string
          reopened_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "month_reopenings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "month_reopenings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "month_reopenings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "month_reopenings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          body: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          kind: string
          last_error: string | null
          link: string | null
          profile_id: string
          read_at: string | null
          sent_at: string | null
          title: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          link?: string | null
          profile_id: string
          read_at?: string | null
          sent_at?: string | null
          title: string
        }
        Update: {
          attempts?: number
          body?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          link?: string | null
          profile_id?: string
          read_at?: string | null
          sent_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          code: string
          description: string | null
          label: string
        }
        Insert: {
          category: string
          code: string
          description?: string | null
          label: string
        }
        Update: {
          category?: string
          code?: string
          description?: string | null
          label?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          active: boolean
          code: string
          color: string | null
          created_at: string
          id: string
          is_initial: boolean
          label: string
          max_minutes: number | null
          outcome: Database["public"]["Enums"]["deal_outcome"]
          position: number
          requires_document: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          label: string
          max_minutes?: number | null
          outcome?: Database["public"]["Enums"]["deal_outcome"]
          position: number
          requires_document?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          label?: string
          max_minutes?: number | null
          outcome?: Database["public"]["Enums"]["deal_outcome"]
          position?: number
          requires_document?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          badge_delivered_at: string | null
          badge_requested_at: string | null
          birth_date: string | null
          bypass_ip_check: boolean
          cpf: string | null
          created_at: string
          creci: string | null
          division: string | null
          email: string
          full_name: string
          habilitation: string | null
          hired_at: string | null
          id: string
          indication: string | null
          phone: string | null
          slug: string | null
          status: Database["public"]["Enums"]["profile_status"]
          terminated_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          badge_delivered_at?: string | null
          badge_requested_at?: string | null
          birth_date?: string | null
          bypass_ip_check?: boolean
          cpf?: string | null
          created_at?: string
          creci?: string | null
          division?: string | null
          email: string
          full_name: string
          habilitation?: string | null
          hired_at?: string | null
          id: string
          indication?: string | null
          phone?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          terminated_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          badge_delivered_at?: string | null
          badge_requested_at?: string | null
          birth_date?: string | null
          bypass_ip_check?: boolean
          cpf?: string | null
          created_at?: string
          creci?: string | null
          division?: string | null
          email?: string
          full_name?: string
          habilitation?: string | null
          hired_at?: string | null
          id?: string
          indication?: string | null
          phone?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          terminated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      public_links: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          director_id: string | null
          expires_at: string | null
          failed_attempts: number
          has_pin: boolean | null
          id: string
          kind: string
          last_seen_at: string | null
          locked_until: string | null
          pin_hash: string | null
          pin_set_at: string | null
          slug: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          director_id?: string | null
          expires_at?: string | null
          failed_attempts?: number
          has_pin?: boolean | null
          id?: string
          kind: string
          last_seen_at?: string | null
          locked_until?: string | null
          pin_hash?: string | null
          pin_set_at?: string | null
          slug?: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          director_id?: string | null
          expires_at?: string | null
          failed_attempts?: number
          has_pin?: boolean | null
          id?: string
          kind?: string
          last_seen_at?: string | null
          locked_until?: string | null
          pin_hash?: string | null
          pin_set_at?: string | null
          slug?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_links_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_links_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_links_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      remarketing_contacts: {
        Row: {
          created_at: string
          email: string | null
          extra: Json
          full_name: string | null
          id: string
          last_error: string | null
          lead_id: string | null
          list_id: string
          phone: string
          replied_at: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          extra?: Json
          full_name?: string | null
          id?: string
          last_error?: string | null
          lead_id?: string | null
          list_id: string
          phone: string
          replied_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          extra?: Json
          full_name?: string | null
          id?: string
          last_error?: string | null
          lead_id?: string | null
          list_id?: string
          phone?: string
          replied_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "remarketing_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remarketing_contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "remarketing_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      remarketing_lists: {
        Row: {
          agent_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          handoff_group_id: string | null
          id: string
          name: string
          scheduled_for: string | null
          status: Database["public"]["Enums"]["broadcast_status"]
          template_id: string | null
          throttle_per_minute: number
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          handoff_group_id?: string | null
          id?: string
          name: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id?: string | null
          throttle_per_minute?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          handoff_group_id?: string | null
          id?: string
          name?: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id?: string | null
          throttle_per_minute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "remarketing_lists_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remarketing_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remarketing_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remarketing_lists_handoff_group_id_fkey"
            columns: ["handoff_group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remarketing_lists_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          profile_email: string | null
          profile_id: string | null
          roles_after: Database["public"]["Enums"]["app_role"][]
          roles_before: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          profile_email?: string | null
          profile_id?: string | null
          roles_after?: Database["public"]["Enums"]["app_role"][]
          roles_before?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          profile_email?: string | null
          profile_id?: string | null
          roles_after?: Database["public"]["Enums"]["app_role"][]
          roles_before?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: [
          {
            foreignKeyName: "role_change_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_change_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_change_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_change_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      sdr_agents: {
        Row: {
          active: boolean
          created_at: string
          handoff_group_id: string | null
          handoff_to_agent_id: string | null
          id: string
          is_orchestrator: boolean
          max_turns: number
          model: string
          name: string
          role: string
          system_prompt: string | null
          temperature: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          handoff_group_id?: string | null
          handoff_to_agent_id?: string | null
          id?: string
          is_orchestrator?: boolean
          max_turns?: number
          model?: string
          name: string
          role?: string
          system_prompt?: string | null
          temperature?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          handoff_group_id?: string | null
          handoff_to_agent_id?: string | null
          id?: string
          is_orchestrator?: boolean
          max_turns?: number
          model?: string
          name?: string
          role?: string
          system_prompt?: string | null
          temperature?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_agents_handoff_group_id_fkey"
            columns: ["handoff_group_id"]
            isOneToOne: false
            referencedRelation: "distribution_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_agents_handoff_to_agent_id_fkey"
            columns: ["handoff_to_agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_conversations: {
        Row: {
          agent_id: string | null
          collected: Json
          created_at: string
          handed_off_at: string | null
          handed_off_to: string | null
          id: string
          last_message_at: string | null
          lead_id: string
          qualified_at: string | null
          score: number | null
          started_at: string
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          collected?: Json
          created_at?: string
          handed_off_at?: string | null
          handed_off_to?: string | null
          id?: string
          last_message_at?: string | null
          lead_id: string
          qualified_at?: string | null
          score?: number | null
          started_at?: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          collected?: Json
          created_at?: string
          handed_off_at?: string | null
          handed_off_to?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string
          qualified_at?: string | null
          score?: number | null
          started_at?: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_conversations_handed_off_to_fkey"
            columns: ["handed_off_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_conversations_handed_off_to_fkey"
            columns: ["handed_off_to"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_messages: {
        Row: {
          agent_id: string | null
          author: Database["public"]["Enums"]["message_author"]
          body: string
          conversation_id: string
          created_at: string
          id: string
          provider_message_id: string | null
          template_id: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          agent_id?: string | null
          author: Database["public"]["Enums"]["message_author"]
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          provider_message_id?: string | null
          template_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          agent_id?: string | null
          author?: Database["public"]["Enums"]["message_author"]
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          provider_message_id?: string | null
          template_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sdr_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sdr_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_permissions: {
        Row: {
          can_enter: boolean
          can_exit: boolean
          role: Database["public"]["Enums"]["app_role"]
          stage_id: string
        }
        Insert: {
          can_enter?: boolean
          can_exit?: boolean
          role: Database["public"]["Enums"]["app_role"]
          stage_id: string
        }
        Update: {
          can_enter?: boolean
          can_exit?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_permissions_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          priority: string
          ref_id: string | null
          ref_type: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          ref_id?: string | null
          ref_type?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          ref_id?: string | null
          ref_type?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          left_at: string | null
          profile_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          profile_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          profile_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          active: boolean
          created_at: string
          director_id: string | null
          id: string
          manager_id: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          director_id?: string | null
          id?: string
          manager_id?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          director_id?: string | null
          id?: string
          manager_id?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      useful_links: {
        Row: {
          active: boolean
          category: string
          created_at: string
          icon: string | null
          id: string
          label: string
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          profile_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          broker_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          lead_id: string | null
          notes: string | null
          performed_at: string | null
          result: Database["public"]["Enums"]["visit_result"]
          scheduled_at: string
          updated_at: string
        }
        Insert: {
          broker_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          performed_at?: string | null
          result?: Database["public"]["Enums"]["visit_result"]
          scheduled_at: string
          updated_at?: string
        }
        Update: {
          broker_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          performed_at?: string | null
          result?: Database["public"]["Enums"]["visit_result"]
          scheduled_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_inbound_messages: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string
          detail: string | null
          from_phone: string
          handled_at: string | null
          handled_by: string | null
          id: string
          lead_id: string | null
          outcome: string
          provider_message_id: string
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          from_phone: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          lead_id?: string | null
          outcome?: string
          provider_message_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          from_phone?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          lead_id?: string | null
          outcome?: string
          provider_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbound_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sdr_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          active: boolean
          approved: boolean
          body: string
          category: string
          created_at: string
          id: string
          language: string
          name: string
          provider_template_id: string | null
          updated_at: string
          variables: string[]
        }
        Insert: {
          active?: boolean
          approved?: boolean
          body: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name: string
          provider_template_id?: string | null
          updated_at?: string
          variables?: string[]
        }
        Update: {
          active?: boolean
          approved?: boolean
          body?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name?: string
          provider_template_id?: string | null
          updated_at?: string
          variables?: string[]
        }
        Relationships: []
      }
      work_shifts: {
        Row: {
          active: boolean
          checkin_start: string
          checkout_time: string
          code: string
          created_at: string
          distribution_start: string
          id: string
          label: string
          position: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          checkin_start: string
          checkout_time: string
          code: string
          created_at?: string
          distribution_start: string
          id?: string
          label: string
          position?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          checkin_start?: string
          checkout_time?: string
          code?: string
          created_at?: string
          distribution_start?: string
          id?: string
          label?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      game_ranking: {
        Row: {
          breakdown: Json | null
          full_name: string | null
          points: number | null
          profile_id: string | null
          sales: number | null
          season_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "team_leader_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "game_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      team_leader_names: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_deal_comment: {
        Args: { p_body: string; p_deal_id: string }
        Returns: {
          actor_id: string | null
          created_at: string
          deal_id: string
          detail: Json | null
          from_value: string | null
          id: string
          kind: string
          to_value: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deal_history"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_lead: {
        Args: { p_force?: boolean; p_lead_id: string }
        Returns: string
      }
      assign_queued_leads: { Args: never; Returns: number }
      auth_effective_role: {
        Args: { p_profile: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      auth_led_team_ids: { Args: never; Returns: string[] }
      auth_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      auth_visible_profiles: { Args: never; Returns: string[] }
      auto_checkout_expired: { Args: never; Returns: number }
      award_game_points: {
        Args: {
          p_event_code: string
          p_occurred?: string
          p_profile_id: string
          p_ref_id?: string
          p_ref_type?: string
        }
        Returns: string
      }
      can_edit_deal: { Args: { p_deal_id: string }; Returns: boolean }
      can_enter_stage: { Args: { target_stage: string }; Returns: boolean }
      can_exit_stage: { Args: { target_stage: string }; Returns: boolean }
      can_manage_public_link: {
        Args: { p_director_id: string; p_team_id: string }
        Returns: boolean
      }
      can_probe_profile: { Args: { who: string }; Returns: boolean }
      can_read_all: { Args: never; Returns: boolean }
      can_see_deal: { Args: { p_deal_id: string }; Returns: boolean }
      can_see_game_profile: { Args: { p_profile_id: string }; Returns: boolean }
      can_see_lead: { Args: { p_lead_id: string }; Returns: boolean }
      can_see_profile: { Args: { target: string }; Returns: boolean }
      can_write_lead: { Args: { p_lead_id: string }; Returns: boolean }
      checkin_eligibility: {
        Args: { who?: string }
        Returns: {
          allowed: boolean
          overdue_count: number
          reason: string
          threshold: number
        }[]
      }
      claim_lead: {
        Args: { p_lead_id: string }
        Returns: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          assigned_at: string | null
          assigned_to: string | null
          attend_deadline: string | null
          campaign_id: string | null
          campaign_name: string | null
          converted_at: string | null
          converted_deal_id: string | null
          created_at: string
          distribution_group_id: string | null
          document: string | null
          email: string | null
          external_id: string | null
          first_contact_at: string | null
          form_id: string | null
          full_name: string
          funnel_stage: Database["public"]["Enums"]["lead_funnel_stage"]
          id: string
          landing_page: string | null
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          next_action_at: string | null
          notes: string | null
          phone: string | null
          phone_raw: string | null
          raw_payload: Json | null
          roulette_misses: number
          sdr_qualified_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_game_season: {
        Args: { p_close_month?: boolean; p_next_label?: string }
        Returns: string
      }
      close_lead: {
        Args: {
          p_lead_id: string
          p_reason: string
          p_status: Database["public"]["Enums"]["lead_status"]
        }
        Returns: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          assigned_at: string | null
          assigned_to: string | null
          attend_deadline: string | null
          campaign_id: string | null
          campaign_name: string | null
          converted_at: string | null
          converted_deal_id: string | null
          created_at: string
          distribution_group_id: string | null
          document: string | null
          email: string | null
          external_id: string | null
          first_contact_at: string | null
          form_id: string | null
          full_name: string
          funnel_stage: Database["public"]["Enums"]["lead_funnel_stage"]
          id: string
          landing_page: string | null
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          next_action_at: string | null
          notes: string | null
          phone: string | null
          phone_raw: string | null
          raw_payload: Json | null
          roulette_misses: number
          sdr_qualified_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_month_and_season: { Args: { p_period?: string }; Returns: Json }
      convert_lead_to_deal: {
        Args: {
          p_developer_id: string
          p_lead_id: string
          p_project_id?: string
          p_unit?: string
          p_vgv_gross?: number
        }
        Returns: {
          closed_at: string | null
          code: string
          created_at: string
          created_by: string | null
          developer_id: string | null
          discount_pct: number
          document_review_reason: string | null
          document_review_requested_at: string | null
          document_review_requested_by: string | null
          document_review_status: string
          document_reviewed_at: string | null
          document_reviewed_by: string | null
          id: string
          lead_id: string | null
          lead_origin: string | null
          lost_reason: string | null
          month_base: string
          notes: string | null
          outcome: Database["public"]["Enums"]["deal_outcome"]
          project_id: string | null
          stage_entered_at: string
          stage_id: string
          status_detail: string | null
          unit: string | null
          updated_at: string
          vgv_gross: number | null
          vgv_net: number | null
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_public_link: {
        Args: {
          p_director_id?: string
          p_kind: string
          p_pin: string
          p_team_id?: string
        }
        Returns: Json
      }
      cron_jobs_health: {
        Args: never
        Returns: {
          active: boolean
          failures_24h: number
          job_name: string
          last_return: string
          last_run_at: string
          last_status: string
          runs_24h: number
          schedule: string
        }[]
      }
      current_game_season: { Args: never; Returns: string }
      current_season_month: { Args: never; Returns: string }
      current_shift: { Args: { at_time?: string }; Returns: string }
      current_work_date: { Args: never; Returns: string }
      deal_id_of_object: { Args: { p_name: string }; Returns: string }
      deal_participant_names: {
        Args: never
        Returns: {
          deal_id: string
          full_name: string
          ordinal: number
          profile_id: string
          role: string
        }[]
      }
      deal_status_bare: { Args: { p_label: string }; Returns: string }
      dispatch_pending_notifications: { Args: never; Returns: undefined }
      dispatch_pending_submissions: { Args: never; Returns: undefined }
      distribute_queued_lead: { Args: { p_lead_id: string }; Returns: string }
      distribution_queue: {
        Args: { p_group_id: string }
        Returns: {
          full_name: string
          last_assigned_at: string
          last_turn_at: string
          profile_id: string
          queue_position: number
        }[]
      }
      effective_attend_timeout: { Args: { group_id: string }; Returns: number }
      existing_lead_phones: {
        Args: { p_phones: string[] }
        Returns: {
          lead_count: number
          phone_digits: string
        }[]
      }
      expire_stale_outbound_notifications: {
        Args: { p_max_age?: string }
        Returns: number
      }
      get_integration_secret: {
        Args: { p_label: string; p_provider: string }
        Returns: string
      }
      has_any_role: {
        Args: { targets: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_permission: { Args: { code: string }; Returns: boolean }
      has_role: {
        Args: { target: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      import_remarketing_list: {
        Args: {
          p_agent_id?: string
          p_contacts?: Json
          p_name: string
          p_template_id?: string
        }
        Returns: string
      }
      ip_is_allowed: {
        Args: { candidate: unknown; who?: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      lead_distribution_group: { Args: { p_lead_id: string }; Returns: string }
      lead_in_sdr_conversation: { Args: { p_lead: string }; Returns: boolean }
      list_integrations: {
        Args: never
        Returns: {
          active: boolean
          config: Json
          has_secret: boolean
          id: string
          label: string
          provider: string
          updated_at: string
        }[]
      }
      manages_profile: { Args: { target: string }; Returns: boolean }
      mark_no_response_leads: { Args: never; Returns: number }
      marketing_campaign_stats: {
        Args: never
        Returns: {
          campaign_id: string
          conversions: number
          leads: number
          revenue: number
          sales: number
        }[]
      }
      marketing_developer_summary: {
        Args: { p_period?: string }
        Returns: {
          active: boolean
          campaign_spend: number
          campaigns: number
          deals: number
          developer_id: string
          developer_name: string
          investment: number
          leads: number
          sales: number
          vgv: number
        }[]
      }
      month_start: { Args: { d: string }; Returns: string }
      normalize_phone: { Args: { raw: string }; Returns: string }
      notification_queue_health: {
        Args: never
        Returns: {
          channel: string
          com_erro: number
          mais_antiga: string
          max_tentativas: number
          pendentes: number
          ultimo_erro: string
        }[]
      }
      notify_cron_failures: { Args: never; Returns: number }
      notify_due_tasks: { Args: never; Returns: number }
      notify_expiring_public_links: { Args: never; Returns: number }
      overdue_lead_count: { Args: { who: string }; Returns: number }
      perform_checkin: {
        Args: { client_ip?: unknown }
        Returns: {
          auto_checkout: boolean
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          id: string
          ip_address: unknown
          leads_received: number
          profile_id: string
          shift_id: string
          work_date: string
        }
        SetofOptions: {
          from: "*"
          to: "checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      perform_checkout: {
        Args: never
        Returns: {
          auto_checkout: boolean
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          id: string
          ip_address: unknown
          leads_received: number
          profile_id: string
          shift_id: string
          work_date: string
        }
        SetofOptions: {
          from: "*"
          to: "checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_daily_submit:
        | {
            Args: {
              p_entries: Json
              p_filled_by?: string
              p_notes?: string
              p_pin: string
              p_slug: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_date: string
              p_entries: Json
              p_filled_by: string
              p_notes: string
              p_pin: string
              p_slug: string
            }
            Returns: Json
          }
      public_daily_team: {
        Args: { p_pin?: string; p_slug: string }
        Returns: Json
      }
      public_director_checkpoint: {
        Args: { p_pin?: string; p_slug: string; p_week_start?: string }
        Returns: Json
      }
      reassign_lead: {
        Args: { p_lead_id: string; p_target: string }
        Returns: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          assigned_at: string | null
          assigned_to: string | null
          attend_deadline: string | null
          campaign_id: string | null
          campaign_name: string | null
          converted_at: string | null
          converted_deal_id: string | null
          created_at: string
          distribution_group_id: string | null
          document: string | null
          email: string | null
          external_id: string | null
          first_contact_at: string | null
          form_id: string | null
          full_name: string
          funnel_stage: Database["public"]["Enums"]["lead_funnel_stage"]
          id: string
          landing_page: string | null
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          next_action_at: string | null
          notes: string | null
          phone: string | null
          phone_raw: string | null
          raw_payload: Json | null
          roulette_misses: number
          sdr_qualified_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recalc_deal_shares: { Args: { p_deal_id: string }; Returns: undefined }
      release_expired_leads: { Args: never; Returns: number }
      remarketing_list_stats: {
        Args: { p_list_id: string }
        Returns: {
          failed: number
          pending: number
          replied: number
          sent: number
          total: number
        }[]
      }
      review_deal_documents: {
        Args: { p_approve: boolean; p_deal_id: string; p_reason?: string }
        Returns: Json
      }
      revoke_integration_secret: {
        Args: { p_label: string; p_provider: string }
        Returns: boolean
      }
      scoring_points: {
        Args: { p_event_code: string; p_season_id: string }
        Returns: number
      }
      sdr_handoff: {
        Args: { p_conversation_id: string; p_reason?: string }
        Returns: string
      }
      season_label_ptbr: { Args: { d: string }; Returns: string }
      selectable_brokers: {
        Args: never
        Returns: {
          full_name: string
          id: string
        }[]
      }
      set_integration_secret: {
        Args: {
          p_config?: Json
          p_label: string
          p_provider: string
          p_secret: string
        }
        Returns: string
      }
      set_profile_roles: {
        Args: {
          p_profile_id: string
          p_roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      set_public_link_pin: {
        Args: { p_link_id: string; p_pin: string }
        Returns: undefined
      }
      slugify: { Args: { txt: string }; Returns: string }
      submit_deal_for_analysis: { Args: { p_deal_id: string }; Returns: Json }
      submit_deal_for_manager_review: {
        Args: { p_deal_id: string }
        Returns: Json
      }
      unaccent_fallback: { Args: { txt: string }; Returns: string }
      visible_game_ranking: {
        Args: { p_season_id: string }
        Returns: {
          active: boolean
          avatar_url: string
          breakdown: Json
          director_id: string
          director_name: string
          full_name: string
          manager_id: string
          manager_name: string
          points: number
          profile_id: string
          sales: number
          season_id: string
          team_id: string
          team_name: string
          vgv: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "director"
        | "manager"
        | "broker"
        | "cca"
        | "sdr"
        | "marketing"
        | "partner"
      broadcast_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "done"
        | "failed"
      cca_status:
        | "pending_documents"
        | "under_review"
        | "sent_to_developer"
        | "sent_to_agency"
        | "approved"
        | "rejected"
        | "cancelled"
      deal_outcome: "open" | "won" | "lost" | "cancelled"
      developer_flow: "internal" | "external"
      lead_funnel_stage:
        | "new"
        | "first_contact"
        | "no_response"
        | "warm"
        | "hot"
        | "gathering_docs"
        | "scheduled_visit"
        | "qualified"
      lead_release_reason:
        | "timeout"
        | "manual"
        | "reassigned"
        | "checkout"
        | "sdr_handoff"
      lead_status:
        | "queued"
        | "assigned"
        | "attending"
        | "in_progress"
        | "converted"
        | "lost"
        | "discarded"
      message_author: "lead" | "agent" | "broker" | "system"
      notification_channel: "in_app" | "whatsapp" | "email" | "push"
      profile_status: "active" | "suspended" | "terminated"
      task_status: "open" | "done" | "cancelled"
      visit_result: "scheduled" | "completed" | "no_show" | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "director",
        "manager",
        "broker",
        "cca",
        "sdr",
        "marketing",
        "partner",
      ],
      broadcast_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "done",
        "failed",
      ],
      cca_status: [
        "pending_documents",
        "under_review",
        "sent_to_developer",
        "sent_to_agency",
        "approved",
        "rejected",
        "cancelled",
      ],
      deal_outcome: ["open", "won", "lost", "cancelled"],
      developer_flow: ["internal", "external"],
      lead_funnel_stage: [
        "new",
        "first_contact",
        "no_response",
        "warm",
        "hot",
        "gathering_docs",
        "scheduled_visit",
        "qualified",
      ],
      lead_release_reason: [
        "timeout",
        "manual",
        "reassigned",
        "checkout",
        "sdr_handoff",
      ],
      lead_status: [
        "queued",
        "assigned",
        "attending",
        "in_progress",
        "converted",
        "lost",
        "discarded",
      ],
      message_author: ["lead", "agent", "broker", "system"],
      notification_channel: ["in_app", "whatsapp", "email", "push"],
      profile_status: ["active", "suspended", "terminated"],
      task_status: ["open", "done", "cancelled"],
      visit_result: ["scheduled", "completed", "no_show", "cancelled"],
    },
  },
} as const
