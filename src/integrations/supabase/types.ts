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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      allowed_ips: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          ip: unknown
          label: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ip: unknown
          label?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ip?: unknown
          label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      annual_results: {
        Row: {
          created_at: string
          id: string
          month: number
          sales_count: number
          updated_at: string
          vgv: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          sales_count?: number
          updated_at?: string
          vgv?: number
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          sales_count?: number
          updated_at?: string
          vgv?: number
          year?: number
        }
        Relationships: []
      }
      broker_checkins: {
        Row: {
          auto_checkout: boolean
          broker_id: string
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          id: string
          ip: unknown
          leads_received: number
          slot: string
          user_id: string | null
          work_date: string
        }
        Insert: {
          auto_checkout?: boolean
          broker_id: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          leads_received?: number
          slot: string
          user_id?: string | null
          work_date?: string
        }
        Update: {
          auto_checkout?: boolean
          broker_id?: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          leads_received?: number
          slot?: string
          user_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_checkins_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          active: boolean
          address: string | null
          avatar_url: string | null
          badge_delivered_at: string | null
          badge_requested: boolean
          badge_requested_at: string | null
          birth_date: string | null
          celular: string | null
          cpf: string | null
          created_at: string | null
          creci: string | null
          director_id: string | null
          division: string | null
          email: string | null
          entry_date: string | null
          full_name: string | null
          habilitation: string | null
          id: string
          indication: string | null
          login_email: string | null
          login_email_confirmed: boolean
          login_password_plain: string | null
          login_provisioned_at: string | null
          manager_id: string | null
          monthly_goal: number | null
          name: string
          phone: string | null
          role: string
          updated_at: string | null
          user_id: string | null
          yearly_goal: number | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          avatar_url?: string | null
          badge_delivered_at?: string | null
          badge_requested?: boolean
          badge_requested_at?: string | null
          birth_date?: string | null
          celular?: string | null
          cpf?: string | null
          created_at?: string | null
          creci?: string | null
          director_id?: string | null
          division?: string | null
          email?: string | null
          entry_date?: string | null
          full_name?: string | null
          habilitation?: string | null
          id?: string
          indication?: string | null
          login_email?: string | null
          login_email_confirmed?: boolean
          login_password_plain?: string | null
          login_provisioned_at?: string | null
          manager_id?: string | null
          monthly_goal?: number | null
          name: string
          phone?: string | null
          role?: string
          updated_at?: string | null
          user_id?: string | null
          yearly_goal?: number | null
        }
        Update: {
          active?: boolean
          address?: string | null
          avatar_url?: string | null
          badge_delivered_at?: string | null
          badge_requested?: boolean
          badge_requested_at?: string | null
          birth_date?: string | null
          celular?: string | null
          cpf?: string | null
          created_at?: string | null
          creci?: string | null
          director_id?: string | null
          division?: string | null
          email?: string | null
          entry_date?: string | null
          full_name?: string | null
          habilitation?: string | null
          id?: string
          indication?: string | null
          login_email?: string | null
          login_email_confirmed?: boolean
          login_password_plain?: string | null
          login_provisioned_at?: string | null
          manager_id?: string | null
          monthly_goal?: number | null
          name?: string
          phone?: string | null
          role?: string
          updated_at?: string | null
          user_id?: string | null
          yearly_goal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brokers_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brokers_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      cca_deals: {
        Row: {
          cca_user_id: string | null
          created_at: string
          deal_id: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["cca_status"]
          updated_at: string
        }
        Insert: {
          cca_user_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["cca_status"]
          updated_at?: string
        }
        Update: {
          cca_user_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["cca_status"]
          updated_at?: string
        }
        Relationships: []
      }
      cca_developers: {
        Row: {
          created_at: string
          developer_name: string
          id: string
          uses_internal_cca: boolean
        }
        Insert: {
          created_at?: string
          developer_name: string
          id?: string
          uses_internal_cca?: boolean
        }
        Update: {
          created_at?: string
          developer_name?: string
          id?: string
          uses_internal_cca?: boolean
        }
        Relationships: []
      }
      cca_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          order: number | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          order?: number | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      checkpoint_targets: {
        Row: {
          analise_enviada_pct: number
          aprovada_pct: number
          created_at: string
          id: string
          team_id: string | null
          updated_at: string
          venda_pct: number
        }
        Insert: {
          analise_enviada_pct?: number
          aprovada_pct?: number
          created_at?: string
          id?: string
          team_id?: string | null
          updated_at?: string
          venda_pct?: number
        }
        Update: {
          analise_enviada_pct?: number
          aprovada_pct?: number
          created_at?: string
          id?: string
          team_id?: string | null
          updated_at?: string
          venda_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "checkpoint_targets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_months: {
        Row: {
          closed_at: string
          closed_by: string | null
          month_base: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          month_base: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          month_base?: string
        }
        Relationships: []
      }
      daily_broker_entries: {
        Row: {
          analises: number
          aprovados: number
          atendimentos: number
          broker_id: string | null
          broker_name: string
          coleta_docs: number
          created_at: string
          id: string
          leads: number
          ligacoes: number
          propostas: number
          report_id: string
          vendas: number
          visitas_agendadas: number
          visitas_realizadas: number
        }
        Insert: {
          analises?: number
          aprovados?: number
          atendimentos?: number
          broker_id?: string | null
          broker_name: string
          coleta_docs?: number
          created_at?: string
          id?: string
          leads?: number
          ligacoes?: number
          propostas?: number
          report_id: string
          vendas?: number
          visitas_agendadas?: number
          visitas_realizadas?: number
        }
        Update: {
          analises?: number
          aprovados?: number
          atendimentos?: number
          broker_id?: string | null
          broker_name?: string
          coleta_docs?: number
          created_at?: string
          id?: string
          leads?: number
          ligacoes?: number
          propostas?: number
          report_id?: string
          vendas?: number
          visitas_agendadas?: number
          visitas_realizadas?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_broker_entries_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_broker_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_team_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_team_reports: {
        Row: {
          created_at: string
          filled_by_name: string | null
          id: string
          notes: string | null
          report_date: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filled_by_name?: string | null
          id?: string
          notes?: string | null
          report_date: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filled_by_name?: string | null
          id?: string
          notes?: string | null
          report_date?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_team_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_bi_cache: {
        Row: {
          id: boolean
          payload: Json
          updated_at: string
        }
        Insert: {
          id?: boolean
          payload?: Json
          updated_at?: string
        }
        Update: {
          id?: boolean
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      deals: {
        Row: {
          active: boolean | null
          broker1_id: string | null
          broker2_id: string | null
          client: string
          created_at: string | null
          deal_value: number | null
          developer: string | null
          director1_id: string | null
          history: Json | null
          id: string
          last_interaction_at: string
          manager1_id: string | null
          manager2_id: string | null
          month_base: string | null
          notes: string | null
          notified_24h: boolean
          notified_48h: boolean
          notified_72h: boolean
          project: string | null
          stage: Database["public"]["Enums"]["deal_stage"] | null
          status: string | null
          unit: string | null
          updated_at: string | null
          visit_date: string | null
          visit_result: string | null
        }
        Insert: {
          active?: boolean | null
          broker1_id?: string | null
          broker2_id?: string | null
          client: string
          created_at?: string | null
          deal_value?: number | null
          developer?: string | null
          director1_id?: string | null
          history?: Json | null
          id?: string
          last_interaction_at?: string
          manager1_id?: string | null
          manager2_id?: string | null
          month_base?: string | null
          notes?: string | null
          notified_24h?: boolean
          notified_48h?: boolean
          notified_72h?: boolean
          project?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"] | null
          status?: string | null
          unit?: string | null
          updated_at?: string | null
          visit_date?: string | null
          visit_result?: string | null
        }
        Update: {
          active?: boolean | null
          broker1_id?: string | null
          broker2_id?: string | null
          client?: string
          created_at?: string | null
          deal_value?: number | null
          developer?: string | null
          director1_id?: string | null
          history?: Json | null
          id?: string
          last_interaction_at?: string
          manager1_id?: string | null
          manager2_id?: string | null
          month_base?: string | null
          notes?: string | null
          notified_24h?: boolean
          notified_48h?: boolean
          notified_72h?: boolean
          project?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"] | null
          status?: string | null
          unit?: string | null
          updated_at?: string | null
          visit_date?: string | null
          visit_result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_broker1_id_fkey"
            columns: ["broker1_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_broker2_id_fkey"
            columns: ["broker2_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_director1_id_fkey"
            columns: ["director1_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_manager1_id_fkey"
            columns: ["manager1_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_manager2_id_fkey"
            columns: ["manager2_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_windows: {
        Row: {
          active: boolean
          checkin_start: string
          checkout_time: string
          created_at: string
          distribution_start: string
          id: string
          label: string
          slot: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          checkin_start: string
          checkout_time: string
          created_at?: string
          distribution_start: string
          id?: string
          label: string
          slot: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          checkin_start?: string
          checkout_time?: string
          created_at?: string
          distribution_start?: string
          id?: string
          label?: string
          slot?: string
          updated_at?: string
        }
        Relationships: []
      }
      gold_tips: {
        Row: {
          active: boolean
          content: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      important_notices: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          message: string
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_attachments: {
        Row: {
          created_at: string
          deal_id: string | null
          file_name: string
          file_path: string
          id: string
          lead_id: string
          mime: string | null
          size: number | null
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          file_name: string
          file_path: string
          id?: string
          lead_id: string
          mime?: string | null
          size?: number | null
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          file_name?: string
          file_path?: string
          id?: string
          lead_id?: string
          mime?: string | null
          size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_attachments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_automation_settings: {
        Row: {
          auto_first_contact: boolean
          id: boolean
          inactivity_alert_hours: number
          no_response_hours: number
          roleta_seconds: number
          updated_at: string
        }
        Insert: {
          auto_first_contact?: boolean
          id?: boolean
          inactivity_alert_hours?: number
          no_response_hours?: number
          roleta_seconds?: number
          updated_at?: string
        }
        Update: {
          auto_first_contact?: boolean
          id?: boolean
          inactivity_alert_hours?: number
          no_response_hours?: number
          roleta_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      lead_comments: {
        Row: {
          author_name: string
          created_at: string
          id: string
          lead_id: string
          message: string
        }
        Insert: {
          author_name: string
          created_at?: string
          id?: string
          lead_id: string
          message: string
        }
        Update: {
          author_name?: string
          created_at?: string
          id?: string
          lead_id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_history: {
        Row: {
          actor_name: string | null
          created_at: string
          description: string
          event_type: string
          id: string
          lead_id: string
        }
        Insert: {
          actor_name?: string | null
          created_at?: string
          description: string
          event_type: string
          id?: string
          lead_id: string
        }
        Update: {
          actor_name?: string | null
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          birth_date: string | null
          broker_id: string | null
          broker_name: string | null
          cpf: string | null
          created_at: string
          developer: string | null
          development: string | null
          email: string | null
          first_contact_at: string | null
          form_answers: Json
          form_name: string | null
          funnel_stage: Database["public"]["Enums"]["lead_funnel_stage"]
          id: string
          last_activity_at: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          tracking: Json | null
          unit: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          broker_id?: string | null
          broker_name?: string | null
          cpf?: string | null
          created_at?: string
          developer?: string | null
          development?: string | null
          email?: string | null
          first_contact_at?: string | null
          form_answers?: Json
          form_name?: string | null
          funnel_stage?: Database["public"]["Enums"]["lead_funnel_stage"]
          id?: string
          last_activity_at?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          tracking?: Json | null
          unit?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          broker_id?: string | null
          broker_name?: string | null
          cpf?: string | null
          created_at?: string
          developer?: string | null
          development?: string | null
          email?: string | null
          first_contact_at?: string | null
          form_answers?: Json
          form_name?: string | null
          funnel_stage?: Database["public"]["Enums"]["lead_funnel_stage"]
          id?: string
          last_activity_at?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          tracking?: Json | null
          unit?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      marketing_investments: {
        Row: {
          amount: number
          channel: string | null
          created_at: string
          created_by: string | null
          developer: string | null
          id: string
          invested_at: string
          note: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          channel?: string | null
          created_at?: string
          created_by?: string | null
          developer?: string | null
          id?: string
          invested_at?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          channel?: string | null
          created_at?: string
          created_by?: string | null
          developer?: string | null
          id?: string
          invested_at?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          id: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          allowed?: boolean
          id?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          allowed?: boolean
          id?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      stage_permissions: {
        Row: {
          can_edit: boolean
          can_move: boolean
          can_view: boolean
          id: string
          role: Database["public"]["Enums"]["app_role"]
          stage: string
        }
        Insert: {
          can_edit?: boolean
          can_move?: boolean
          can_view?: boolean
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          stage: string
        }
        Update: {
          can_edit?: boolean
          can_move?: boolean
          can_view?: boolean
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          stage?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_user_id: string | null
          auto_generated: boolean
          broker_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          done: boolean
          due_date: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          auto_generated?: boolean
          broker_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          auto_generated?: boolean
          broker_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      team_assignments: {
        Row: {
          created_at: string
          director_id: string | null
          id: string
          manager_id: string | null
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          director_id?: string | null
          id?: string
          manager_id?: string | null
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          director_id?: string | null
          id?: string
          manager_id?: string | null
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pins: {
        Row: {
          active: boolean
          created_at: string
          pin_hash: string
          pin_plain: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          pin_hash: string
          pin_plain?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          pin_hash?: string
          pin_plain?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_pins_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          manager_id: string | null
          name: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          manager_id?: string | null
          name: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          manager_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      useful_links: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          sort_order: number
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_checkout_slot: { Args: { _slot: string }; Returns: undefined }
      check_deal_inactivity: { Args: never; Returns: undefined }
      get_broker_private: {
        Args: { _id: string }
        Returns: {
          address: string
          birth_date: string
          celular: string
          cpf: string
          email: string
          id: string
          login_email: string
          login_email_confirmed: boolean
          login_password_plain: string
          login_provisioned_at: string
          phone: string
        }[]
      }
      get_daily_team_month_summary: {
        Args: { _team_id: string }
        Returns: Json
      }
      get_daily_team_report: {
        Args: { _date: string; _team_id: string }
        Returns: Json
      }
      get_team_public_info: {
        Args: { _team_id: string }
        Returns: {
          has_pin: boolean
          team_id: string
          team_name: string
        }[]
      }
      get_team_roster: {
        Args: { _team_id: string }
        Returns: {
          broker_id: string
          broker_name: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      rebuild_dashboard_bi_cache: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "broker" | "manager" | "director" | "partner" | "admin" | "cca"
      cca_status:
        | "credit_analysis"
        | "pending_documents"
        | "approved"
        | "rejected"
        | "sent_to_agency"
      deal_stage:
        | "incomplete"
        | "lead"
        | "proposal"
        | "visit_scheduled"
        | "under_analysis"
        | "approved"
        | "contract"
        | "closed"
      lead_funnel_stage:
        | "new"
        | "first_contact"
        | "no_response"
        | "warm"
        | "hot"
        | "gathering_docs"
        | "converted"
      lead_status: "new" | "contacted" | "qualified" | "converted" | "lost"
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
      app_role: ["broker", "manager", "director", "partner", "admin", "cca"],
      cca_status: [
        "credit_analysis",
        "pending_documents",
        "approved",
        "rejected",
        "sent_to_agency",
      ],
      deal_stage: [
        "incomplete",
        "lead",
        "proposal",
        "visit_scheduled",
        "under_analysis",
        "approved",
        "contract",
        "closed",
      ],
      lead_funnel_stage: [
        "new",
        "first_contact",
        "no_response",
        "warm",
        "hot",
        "gathering_docs",
        "converted",
      ],
      lead_status: ["new", "contacted", "qualified", "converted", "lost"],
    },
  },
} as const
