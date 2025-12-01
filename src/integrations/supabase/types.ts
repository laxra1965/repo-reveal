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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          created_at: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      arbitrage_opportunities: {
        Row: {
          arb_factor: number | null
          base_symbol: string
          buy_price: number | null
          detected_at: string | null
          end_amount: number
          estimated_slippage: number | null
          exchange1: Database["public"]["Enums"]["exchange_name"]
          exchange2: Database["public"]["Enums"]["exchange_name"]
          exchange3: Database["public"]["Enums"]["exchange_name"]
          expires_at: string | null
          id: string
          intermediate_price: number | null
          intermediate_symbol: string
          is_active: boolean | null
          is_valid: boolean | null
          last_price_check: Json | null
          last_validated_at: string | null
          liquidity_score: number | null
          overpriced_leg: string | null
          path_key: string | null
          price_deviation: number | null
          profit: number | null
          profit_amount: number
          profit_percent: number
          quality_score: number | null
          quote_symbol: string
          sell_price: number | null
          signal_type: string | null
          start_amount: number
          step1_action: string
          step1_amount: number
          step1_price: number
          step1_volume: number | null
          step2_action: string
          step2_amount: number
          step2_price: number
          step2_volume: number | null
          step3_action: string
          step3_amount: number
          step3_price: number
          step3_volume: number | null
          type: string
          user_id: string | null
          validation_count: number | null
        }
        Insert: {
          arb_factor?: number | null
          base_symbol: string
          buy_price?: number | null
          detected_at?: string | null
          end_amount: number
          estimated_slippage?: number | null
          exchange1: Database["public"]["Enums"]["exchange_name"]
          exchange2: Database["public"]["Enums"]["exchange_name"]
          exchange3: Database["public"]["Enums"]["exchange_name"]
          expires_at?: string | null
          id?: string
          intermediate_price?: number | null
          intermediate_symbol: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_price_check?: Json | null
          last_validated_at?: string | null
          liquidity_score?: number | null
          overpriced_leg?: string | null
          path_key?: string | null
          price_deviation?: number | null
          profit?: number | null
          profit_amount: number
          profit_percent: number
          quality_score?: number | null
          quote_symbol: string
          sell_price?: number | null
          signal_type?: string | null
          start_amount: number
          step1_action: string
          step1_amount: number
          step1_price: number
          step1_volume?: number | null
          step2_action: string
          step2_amount: number
          step2_price: number
          step2_volume?: number | null
          step3_action: string
          step3_amount: number
          step3_price: number
          step3_volume?: number | null
          type?: string
          user_id?: string | null
          validation_count?: number | null
        }
        Update: {
          arb_factor?: number | null
          base_symbol?: string
          buy_price?: number | null
          detected_at?: string | null
          end_amount?: number
          estimated_slippage?: number | null
          exchange1?: Database["public"]["Enums"]["exchange_name"]
          exchange2?: Database["public"]["Enums"]["exchange_name"]
          exchange3?: Database["public"]["Enums"]["exchange_name"]
          expires_at?: string | null
          id?: string
          intermediate_price?: number | null
          intermediate_symbol?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_price_check?: Json | null
          last_validated_at?: string | null
          liquidity_score?: number | null
          overpriced_leg?: string | null
          path_key?: string | null
          price_deviation?: number | null
          profit?: number | null
          profit_amount?: number
          profit_percent?: number
          quality_score?: number | null
          quote_symbol?: string
          sell_price?: number | null
          signal_type?: string | null
          start_amount?: number
          step1_action?: string
          step1_amount?: number
          step1_price?: number
          step1_volume?: number | null
          step2_action?: string
          step2_amount?: number
          step2_price?: number
          step2_volume?: number | null
          step3_action?: string
          step3_amount?: number
          step3_price?: number
          step3_volume?: number | null
          type?: string
          user_id?: string | null
          validation_count?: number | null
        }
        Relationships: []
      }
      auto_trade_queue: {
        Row: {
          actual_trade_amount: number
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          opportunity_id: string
          priority: number | null
          queued_at: string | null
          started_at: string | null
          status: string | null
          tier_max_amount: number
          user_id: string
        }
        Insert: {
          actual_trade_amount: number
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          opportunity_id: string
          priority?: number | null
          queued_at?: string | null
          started_at?: string | null
          status?: string | null
          tier_max_amount: number
          user_id: string
        }
        Update: {
          actual_trade_amount?: number
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          opportunity_id?: string
          priority?: number | null
          queued_at?: string | null
          started_at?: string | null
          status?: string | null
          tier_max_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_trade_queue_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "active_arbitrage_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_trade_queue_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "arbitrage_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_credentials: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string | null
          exchange: Database["public"]["Enums"]["exchange_name"]
          id: string
          is_connected: boolean | null
          test_mode: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string | null
          exchange: Database["public"]["Enums"]["exchange_name"]
          id?: string
          is_connected?: boolean | null
          test_mode?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string | null
          exchange?: Database["public"]["Enums"]["exchange_name"]
          id?: string
          is_connected?: boolean | null
          test_mode?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      scanner_health_metrics: {
        Row: {
          created_at: string | null
          id: string
          metric_name: string | null
          metric_value: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          metric_name?: string | null
          metric_value?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metric_name?: string | null
          metric_value?: number | null
        }
        Relationships: []
      }
      scanner_logs: {
        Row: {
          created_at: string | null
          details: Json | null
          id: string
          log_type: string
          message: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          id?: string
          log_type: string
          message: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          id?: string
          log_type?: string
          message?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          active: boolean | null
          created_at: string | null
          duration_type: string
          features: Json | null
          id: string
          name: string
          price: number
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          duration_type: string
          features?: Json | null
          id?: string
          name: string
          price: number
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          duration_type?: string
          features?: Json | null
          id?: string
          name?: string
          price?: number
        }
        Relationships: []
      }
      trade_history: {
        Row: {
          actual_profit: number | null
          base_symbol: string
          completed_at: string | null
          completed_steps: number | null
          created_at: string | null
          error_message: string | null
          execution_details: Json | null
          expected_profit: number
          final_amount: number | null
          id: string
          intermediate_symbol: string
          opportunity_id: string | null
          quote_symbol: string
          start_amount: number
          started_at: string | null
          status: Database["public"]["Enums"]["trade_status"] | null
          total_steps: number | null
          user_id: string
        }
        Insert: {
          actual_profit?: number | null
          base_symbol: string
          completed_at?: string | null
          completed_steps?: number | null
          created_at?: string | null
          error_message?: string | null
          execution_details?: Json | null
          expected_profit: number
          final_amount?: number | null
          id?: string
          intermediate_symbol: string
          opportunity_id?: string | null
          quote_symbol: string
          start_amount: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["trade_status"] | null
          total_steps?: number | null
          user_id: string
        }
        Update: {
          actual_profit?: number | null
          base_symbol?: string
          completed_at?: string | null
          completed_steps?: number | null
          created_at?: string | null
          error_message?: string | null
          execution_details?: Json | null
          expected_profit?: number
          final_amount?: number | null
          id?: string
          intermediate_symbol?: string
          opportunity_id?: string | null
          quote_symbol?: string
          start_amount?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["trade_status"] | null
          total_steps?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "active_arbitrage_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "arbitrage_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string | null
          id: string
          payment_method: string | null
          payment_proof: string | null
          plan_id: string
          status: string | null
          transaction_id: string
          usdt_address: string
          user_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string | null
          id?: string
          payment_method?: string | null
          payment_proof?: string | null
          plan_id: string
          status?: string | null
          transaction_id: string
          usdt_address: string
          user_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string | null
          id?: string
          payment_method?: string | null
          payment_proof?: string | null
          plan_id?: string
          status?: string | null
          transaction_id?: string
          usdt_address?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          arbitrage_types: string[] | null
          auto_trade: boolean | null
          created_at: string | null
          custom_pairs: string[] | null
          enabled_exchanges:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable: boolean | null
          id: string
          max_profit_percent: number | null
          min_profit_percent: number | null
          refresh_rate: number | null
          trade_amount: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          arbitrage_types?: string[] | null
          auto_trade?: boolean | null
          created_at?: string | null
          custom_pairs?: string[] | null
          enabled_exchanges?:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable?: boolean | null
          id?: string
          max_profit_percent?: number | null
          min_profit_percent?: number | null
          refresh_rate?: number | null
          trade_amount?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          arbitrage_types?: string[] | null
          auto_trade?: boolean | null
          created_at?: string | null
          custom_pairs?: string[] | null
          enabled_exchanges?:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable?: boolean | null
          id?: string
          max_profit_percent?: number | null
          min_profit_percent?: number | null
          refresh_rate?: number | null
          trade_amount?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          plan_id: string
          start_date: string | null
          status: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          plan_id: string
          start_date?: string | null
          status?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          plan_id?: string
          start_date?: string | null
          status?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_arbitrage_opportunities: {
        Row: {
          arb_factor: number | null
          base_symbol: string | null
          detected_at: string | null
          end_amount: number | null
          estimated_slippage: number | null
          exchange1: Database["public"]["Enums"]["exchange_name"] | null
          exchange2: Database["public"]["Enums"]["exchange_name"] | null
          exchange3: Database["public"]["Enums"]["exchange_name"] | null
          expires_at: string | null
          id: string | null
          intermediate_symbol: string | null
          is_valid: boolean | null
          last_price_check: Json | null
          last_validated_at: string | null
          liquidity_score: number | null
          overpriced_leg: string | null
          price_deviation: number | null
          profit_amount: number | null
          profit_percent: number | null
          quality_score: number | null
          quote_symbol: string | null
          signal_type: string | null
          start_amount: number | null
          step1_action: string | null
          step1_amount: number | null
          step1_price: number | null
          step1_volume: number | null
          step2_action: string | null
          step2_amount: number | null
          step2_price: number | null
          step2_volume: number | null
          step3_action: string | null
          step3_amount: number | null
          step3_price: number | null
          step3_volume: number | null
          type: string | null
          user_id: string | null
          validation_count: number | null
        }
        Insert: {
          arb_factor?: number | null
          base_symbol?: string | null
          detected_at?: string | null
          end_amount?: number | null
          estimated_slippage?: number | null
          exchange1?: Database["public"]["Enums"]["exchange_name"] | null
          exchange2?: Database["public"]["Enums"]["exchange_name"] | null
          exchange3?: Database["public"]["Enums"]["exchange_name"] | null
          expires_at?: string | null
          id?: string | null
          intermediate_symbol?: string | null
          is_valid?: boolean | null
          last_price_check?: Json | null
          last_validated_at?: string | null
          liquidity_score?: number | null
          overpriced_leg?: string | null
          price_deviation?: number | null
          profit_amount?: number | null
          profit_percent?: number | null
          quality_score?: number | null
          quote_symbol?: string | null
          signal_type?: string | null
          start_amount?: number | null
          step1_action?: string | null
          step1_amount?: number | null
          step1_price?: number | null
          step1_volume?: number | null
          step2_action?: string | null
          step2_amount?: number | null
          step2_price?: number | null
          step2_volume?: number | null
          step3_action?: string | null
          step3_amount?: number | null
          step3_price?: number | null
          step3_volume?: number | null
          type?: string | null
          user_id?: string | null
          validation_count?: number | null
        }
        Update: {
          arb_factor?: number | null
          base_symbol?: string | null
          detected_at?: string | null
          end_amount?: number | null
          estimated_slippage?: number | null
          exchange1?: Database["public"]["Enums"]["exchange_name"] | null
          exchange2?: Database["public"]["Enums"]["exchange_name"] | null
          exchange3?: Database["public"]["Enums"]["exchange_name"] | null
          expires_at?: string | null
          id?: string | null
          intermediate_symbol?: string | null
          is_valid?: boolean | null
          last_price_check?: Json | null
          last_validated_at?: string | null
          liquidity_score?: number | null
          overpriced_leg?: string | null
          price_deviation?: number | null
          profit_amount?: number | null
          profit_percent?: number | null
          quality_score?: number | null
          quote_symbol?: string | null
          signal_type?: string | null
          start_amount?: number | null
          step1_action?: string | null
          step1_amount?: number | null
          step1_price?: number | null
          step1_volume?: number | null
          step2_action?: string | null
          step2_amount?: number | null
          step2_price?: number | null
          step2_volume?: number | null
          step3_action?: string | null
          step3_amount?: number | null
          step3_price?: number | null
          step3_volume?: number | null
          type?: string | null
          user_id?: string | null
          validation_count?: number | null
        }
        Relationships: []
      }
      auto_trade_monitoring: {
        Row: {
          auto_trade: boolean | null
          email: string | null
          processing_trades: number | null
          queued_trades: number | null
          subscription_end_date: string | null
          subscription_plan: string | null
          subscription_status: string | null
          tier_max_amount: number | null
          trades_last_24h: number | null
          user_id: string | null
          user_trade_amount: number | null
        }
        Relationships: []
      }
      opportunity_validation_status: {
        Row: {
          active_valid: number | null
          avg_validations: number | null
          expired_invalid: number | null
          expired_timeout: number | null
          last_validation_time: string | null
          needs_revalidation: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      build_path_key: {
        Args: {
          e1: string
          e2: string
          e3: string
          p_type: string
          s1: string
          s2: string
          s3: string
        }
        Returns: string
      }
      cleanup_expired_opportunities: {
        Args: never
        Returns: {
          deleted_count: number
          execution_time_ms: number
        }[]
      }
      cleanup_expired_opportunities_full: { Args: never; Returns: undefined }
      cleanup_invalid_opportunities: { Args: never; Returns: undefined }
      cleanup_old_opportunities: { Args: never; Returns: number }
      expire_invalid_opportunities: {
        Args: { min_profit_threshold?: number }
        Returns: number
      }
      expire_stale_opportunities: { Args: never; Returns: undefined }
      get_auto_trade_status: {
        Args: never
        Returns: {
          avg_trade_time_seconds: number
          failed_trades_last_hour: number
          processing_trades: number
          queued_trades: number
          total_users_with_auto_trade: number
          trades_last_hour: number
        }[]
      }
      get_opportunities_needing_validation: {
        Args: never
        Returns: {
          base_symbol: string
          exchange1: string
          exchange2: string
          exchange3: string
          intermediate_symbol: string
          last_validated_at: string
          opportunity_id: string
          quote_symbol: string
          seconds_since_validation: number
          type: string
        }[]
      }
      mark_opportunity_validated: {
        Args: {
          new_profit_percent?: number
          opportunity_id: string
          still_valid: boolean
        }
        Returns: boolean
      }
      process_pending_auto_trades: {
        Args: never
        Returns: {
          failed: number
          processed: number
          succeeded: number
        }[]
      }
      queue_auto_trades_for_users: {
        Args: never
        Returns: {
          trades_queued: number
          users_processed: number
        }[]
      }
      remove_duplicate_opportunities: {
        Args: never
        Returns: {
          duplicates_removed: number
          execution_time_ms: number
          paths_processed: number
        }[]
      }
      validate_all_opportunities: {
        Args: { price_data: Json }
        Returns: {
          execution_time_ms: number
          opportunities_checked: number
          opportunities_expired: number
          opportunities_still_valid: number
        }[]
      }
      validate_arbitrage_opportunity: {
        Args: { current_prices: Json; opportunity_id: string }
        Returns: {
          current_profit_percent: number
          is_still_valid: boolean
          reason: string
        }[]
      }
      validate_opportunities: { Args: never; Returns: undefined }
      validate_opportunity: {
        Args: { opportunity_id: string; price_map: Json }
        Returns: boolean
      }
    }
    Enums: {
      exchange_name:
        | "binance"
        | "bybit"
        | "okx"
        | "bitget"
        | "mexc"
        | "gate"
        | "htx"
        | "kucoin"
        | "bitfinex"
        | "bingx"
        | "coinbase"
        | "upbit"
        | "cryptocom"
        | "kraken"
      trade_status:
        | "pending"
        | "executing"
        | "completed"
        | "failed"
        | "cancelled"
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
      exchange_name: [
        "binance",
        "bybit",
        "okx",
        "bitget",
        "mexc",
        "gate",
        "htx",
        "kucoin",
        "bitfinex",
        "bingx",
        "coinbase",
        "upbit",
        "cryptocom",
        "kraken",
      ],
      trade_status: [
        "pending",
        "executing",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
