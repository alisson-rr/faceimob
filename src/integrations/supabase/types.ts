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
      brokers: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      deals: {
        Row: {
          active: boolean | null
          broker1_id: string | null
          broker2_id: string | null
          client: string
          created_at: string | null
          deal_value: number | null
          developer: string | null
          history: Json | null
          id: string
          manager1_id: string | null
          manager2_id: string | null
          month_base: string | null
          notes: string | null
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
          history?: Json | null
          id?: string
          manager1_id?: string | null
          manager2_id?: string | null
          month_base?: string | null
          notes?: string | null
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
          history?: Json | null
          id?: string
          manager1_id?: string | null
          manager2_id?: string | null
          month_base?: string | null
          notes?: string | null
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
      leads: {
        Row: {
          broker_id: string | null
          broker_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          broker_id?: string | null
          broker_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          broker_id?: string | null
          broker_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
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
      teams: {
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
      lead_status: ["new", "contacted", "qualified", "converted", "lost"],
    },
  },
} as const
