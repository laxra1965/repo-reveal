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
      __pgcron_test: {
        Row: {
          created_at: string | null
          id: number
        }
        Insert: {
          created_at?: string | null
          id?: number
        }
        Update: {
          created_at?: string | null
          id?: number
        }
        Relationships: []
      }
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
      api_cache: {
        Row: {
          cache_data: Json
          cache_key: string
          created_at: string | null
          expires_at: string
          hit_count: number | null
          id: string
          last_accessed_at: string | null
        }
        Insert: {
          cache_data: Json
          cache_key: string
          created_at?: string | null
          expires_at: string
          hit_count?: number | null
          id?: string
          last_accessed_at?: string | null
        }
        Update: {
          cache_data?: Json
          cache_key?: string
          created_at?: string | null
          expires_at?: string
          hit_count?: number | null
          id?: string
          last_accessed_at?: string | null
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
        Relationships: []
      }
      exchange_credentials: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string | null
          encrypted_api_key: string | null
          encrypted_api_passphrase: string | null
          encrypted_api_secret: string | null
          encryption_version: number | null
          exchange: Database["public"]["Enums"]["exchange_name"]
          id: string
          is_connected: boolean | null
          migration_status: string | null
          test_mode: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string | null
          encrypted_api_key?: string | null
          encrypted_api_passphrase?: string | null
          encrypted_api_secret?: string | null
          encryption_version?: number | null
          exchange: Database["public"]["Enums"]["exchange_name"]
          id?: string
          is_connected?: boolean | null
          migration_status?: string | null
          test_mode?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string | null
          encrypted_api_key?: string | null
          encrypted_api_passphrase?: string | null
          encrypted_api_secret?: string | null
          encryption_version?: number | null
          exchange?: Database["public"]["Enums"]["exchange_name"]
          id?: string
          is_connected?: boolean | null
          migration_status?: string | null
          test_mode?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      filter_audit_log: {
        Row: {
          action: string
          admin_id: string
          filter_id: string | null
          id: string
          new_config: Json | null
          previous_config: Json | null
          timestamp: string
        }
        Insert: {
          action: string
          admin_id: string
          filter_id?: string | null
          id?: string
          new_config?: Json | null
          previous_config?: Json | null
          timestamp?: string
        }
        Update: {
          action?: string
          admin_id?: string
          filter_id?: string | null
          id?: string
          new_config?: Json | null
          previous_config?: Json | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "filter_audit_log_filter_id_fkey"
            columns: ["filter_id"]
            isOneToOne: false
            referencedRelation: "opportunity_filters"
            referencedColumns: ["id"]
          },
        ]
      }
      filter_templates: {
        Row: {
          created_at: string
          description: string | null
          filter_id: string | null
          id: string
          template_name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          filter_id?: string | null
          id?: string
          template_name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          filter_id?: string | null
          id?: string
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "filter_templates_filter_id_fkey"
            columns: ["filter_id"]
            isOneToOne: false
            referencedRelation: "opportunity_filters"
            referencedColumns: ["id"]
          },
        ]
      }
      futures_trades: {
        Row: {
          created_at: string
          entry_price: number
          exchange: string
          exit_price: number | null
          id: string
          leverage: number
          margin_type: string
          notes: string | null
          pnl: number | null
          side: string
          size: number
          status: string
          symbol: string
          trade_source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_price: number
          exchange: string
          exit_price?: number | null
          id?: string
          leverage?: number
          margin_type?: string
          notes?: string | null
          pnl?: number | null
          side: string
          size: number
          status?: string
          symbol: string
          trade_source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_price?: number
          exchange?: string
          exit_price?: number | null
          id?: string
          leverage?: number
          margin_type?: string
          notes?: string | null
          pnl?: number | null
          side?: string
          size?: number
          status?: string
          symbol?: string
          trade_source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ml_features: {
        Row: {
          created_at: string | null
          id: string
          opportunity_id: string | null
          profit_percent: number
          user_id: string
          was_successful: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          profit_percent: number
          user_id: string
          was_successful?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          profit_percent?: number
          user_id?: string
          was_successful?: boolean | null
        }
        Relationships: []
      }
      ml_models: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          model_name: string
          model_version: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          model_name: string
          model_version: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          model_name?: string
          model_version?: string
        }
        Relationships: []
      }
      ml_predictions: {
        Row: {
          created_at: string | null
          id: string
          model_id: string | null
          opportunity_id: string | null
          predicted_success_probability: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          model_id?: string | null
          opportunity_id?: string | null
          predicted_success_probability: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          model_id?: string | null
          opportunity_id?: string | null
          predicted_success_probability?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_predictions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ml_models"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          body: string
          created_at: string
          data: Json
          error_message: string | null
          id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json
          error_message?: string | null
          id?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          error_message?: string | null
          id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          detected_at: string
          estimated_slippage: number
          exchange1: string | null
          exchange2: string | null
          exchange3: string | null
          id: string
          liquidity_score: number
          pair1: string | null
          pair2: string | null
          pair3: string | null
          path: string
          profit_percent: number
          status: string
          strategy: string
          volume_estimate: number
        }
        Insert: {
          detected_at?: string
          estimated_slippage?: number
          exchange1?: string | null
          exchange2?: string | null
          exchange3?: string | null
          id?: string
          liquidity_score: number
          pair1?: string | null
          pair2?: string | null
          pair3?: string | null
          path: string
          profit_percent: number
          status?: string
          strategy: string
          volume_estimate: number
        }
        Update: {
          detected_at?: string
          estimated_slippage?: number
          exchange1?: string | null
          exchange2?: string | null
          exchange3?: string | null
          id?: string
          liquidity_score?: number
          pair1?: string | null
          pair2?: string | null
          pair3?: string | null
          path?: string
          profit_percent?: number
          status?: string
          strategy?: string
          volume_estimate?: number
        }
        Relationships: []
      }
      opportunity_filters: {
        Row: {
          allowed_exchanges: string[] | null
          allowed_strategies: string[] | null
          allowed_symbols: string[] | null
          created_at: string
          created_by: string | null
          description: string | null
          excluded_symbols: string[] | null
          id: string
          is_active: boolean
          max_estimated_slippage: number | null
          max_liquidity_score: number | null
          max_profit_percent: number | null
          max_volume_estimate: number | null
          min_liquidity_score: number | null
          min_profit_percent: number | null
          min_volume_estimate: number | null
          name: string
          path_length: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_exchanges?: string[] | null
          allowed_strategies?: string[] | null
          allowed_symbols?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          excluded_symbols?: string[] | null
          id?: string
          is_active?: boolean
          max_estimated_slippage?: number | null
          max_liquidity_score?: number | null
          max_profit_percent?: number | null
          max_volume_estimate?: number | null
          min_liquidity_score?: number | null
          min_profit_percent?: number | null
          min_volume_estimate?: number | null
          name: string
          path_length?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_exchanges?: string[] | null
          allowed_strategies?: string[] | null
          allowed_symbols?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          excluded_symbols?: string[] | null
          id?: string
          is_active?: boolean
          max_estimated_slippage?: number | null
          max_liquidity_score?: number | null
          max_profit_percent?: number | null
          max_volume_estimate?: number | null
          min_liquidity_score?: number | null
          min_profit_percent?: number | null
          min_volume_estimate?: number | null
          name?: string
          path_length?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          closed_at: string | null
          created_at: string | null
          entry_price: number
          exit_price: number | null
          id: string
          opened_at: string | null
          pnl: number | null
          quantity: number
          status: string | null
          symbol: string
          trade_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          entry_price: number
          exit_price?: number | null
          id?: string
          opened_at?: string | null
          pnl?: number | null
          quantity: number
          status?: string | null
          symbol: string
          trade_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          entry_price?: number
          exit_price?: number | null
          id?: string
          opened_at?: string | null
          pnl?: number | null
          quantity?: number
          status?: string | null
          symbol?: string
          trade_type?: string | null
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
      push_tokens: {
        Row: {
          created_at: string
          device_label: string | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          id?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
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
      scheduler_runs: {
        Row: {
          created_at: string
          details: Json
          duration_ms: number | null
          failures: number
          finished_at: string | null
          id: string
          inserts_attempted: number
          source: string
          started_at: string
          successes: number
          triggered_by: string | null
          users_processed: number
        }
        Insert: {
          created_at?: string
          details?: Json
          duration_ms?: number | null
          failures?: number
          finished_at?: string | null
          id?: string
          inserts_attempted?: number
          source?: string
          started_at?: string
          successes?: number
          triggered_by?: string | null
          users_processed?: number
        }
        Update: {
          created_at?: string
          details?: Json
          duration_ms?: number | null
          failures?: number
          finished_at?: string | null
          id?: string
          inserts_attempted?: number
          source?: string
          started_at?: string
          successes?: number
          triggered_by?: string | null
          users_processed?: number
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
        Relationships: []
      }
      trade_recovery_state: {
        Row: {
          created_at: string | null
          current_step: number
          id: string
          recovery_attempts: number | null
          recovery_status: string | null
          trade_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_step?: number
          id?: string
          recovery_attempts?: number | null
          recovery_status?: string | null
          trade_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_step?: number
          id?: string
          recovery_attempts?: number | null
          recovery_status?: string | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_recovery_state_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trade_history"
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
          auto_paper_trade: boolean
          auto_trade: boolean | null
          created_at: string | null
          custom_pairs: string[] | null
          enable_ml_filtering: boolean | null
          enabled_exchanges:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable: boolean | null
          id: string
          is_scanning: boolean
          max_position_size: number | null
          max_profit_percent: number | null
          min_profit_percent: number | null
          refresh_rate: number | null
          slippage_buffer: number | null
          trade_amount: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          arbitrage_types?: string[] | null
          auto_paper_trade?: boolean
          auto_trade?: boolean | null
          created_at?: string | null
          custom_pairs?: string[] | null
          enable_ml_filtering?: boolean | null
          enabled_exchanges?:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable?: boolean | null
          id?: string
          is_scanning?: boolean
          max_position_size?: number | null
          max_profit_percent?: number | null
          min_profit_percent?: number | null
          refresh_rate?: number | null
          slippage_buffer?: number | null
          trade_amount?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          arbitrage_types?: string[] | null
          auto_paper_trade?: boolean
          auto_trade?: boolean | null
          created_at?: string | null
          custom_pairs?: string[] | null
          enable_ml_filtering?: boolean | null
          enabled_exchanges?:
            | Database["public"]["Enums"]["exchange_name"][]
            | null
          filter_profitable?: boolean | null
          id?: string
          is_scanning?: boolean
          max_position_size?: number | null
          max_profit_percent?: number | null
          min_profit_percent?: number | null
          refresh_rate?: number | null
          slippage_buffer?: number | null
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
      user_trade_statistics: {
        Row: {
          avg_profit: number | null
          completed_trades: number | null
          failed_trades: number | null
          success_rate: number | null
          total_profit: number | null
          total_trades: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_run_auto_trade_cycle: {
        Args: never
        Returns: {
          failed: number
          processed: number
          succeeded: number
          trades_queued: number
          users_processed: number
        }[]
      }
      cleanup_stale_opportunities: { Args: never; Returns: number }
      create_demo_paper_trades: {
        Args: { p_user_id: string }
        Returns: {
          message: string
          status: string
        }[]
      }
      create_paper_trade_from_opportunity: {
        Args: { p_opp_id: string; p_user_id: string }
        Returns: {
          message: string
          status: string
        }[]
      }
      get_auto_trade_status: {
        Args: never
        Returns: {
          active_users: number
          completed_today: number
          executing_trades: number
          failed_today: number
          pending_trades: number
          total_profit_today: number
        }[]
      }
      get_cached: { Args: { key: string }; Returns: Json }
      get_futures_config: {
        Args: never
        Returns: {
          futures_enabled: boolean
          margin_type: string
          max_leverage: number
          min_leverage: number
          trading_mode: string
        }[]
      }
      get_paper_trades_with_exchanges:
        | {
            Args: { p_limit?: number; p_user_id: string }
            Returns: {
              actual_profit: number
              base_symbol: string
              completed_at: string
              completed_steps: number
              exchanges: string
              execution_details: Json
              expected_profit: number
              final_amount: number
              id: string
              intermediate_symbol: string
              opportunity_id: string
              quote_symbol: string
              start_amount: number
              started_at: string
              status: Database["public"]["Enums"]["trade_status"]
              total_steps: number
            }[]
          }
        | {
            Args: { p_limit?: number; p_offset?: number; p_user_id: string }
            Returns: {
              actual_profit: number
              base_symbol: string
              completed_at: string
              completed_steps: number
              exchanges: string
              execution_details: Json
              expected_profit: number
              final_amount: number
              id: string
              intermediate_symbol: string
              opportunity_id: string
              quote_symbol: string
              start_amount: number
              started_at: string
              status: Database["public"]["Enums"]["trade_status"]
              total_count: number
              total_steps: number
            }[]
          }
      get_public_admin_settings: {
        Args: never
        Returns: {
          key: string
          value: string
        }[]
      }
      is_credentials_encrypted: {
        Args: { credential_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      log_scheduler_run: {
        Args: {
          p_details?: Json
          p_failures: number
          p_inserts_attempted: number
          p_source: string
          p_started_at: string
          p_successes: number
          p_users_processed: number
        }
        Returns: string
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
      queue_futures_auto_trades: {
        Args: never
        Returns: {
          trades_queued: number
          users_processed: number
        }[]
      }
      queue_paper_trades_from_opportunities: {
        Args: { p_user_id: string }
        Returns: {
          trades_created: number
        }[]
      }
      reconcile_duplicate_trades: {
        Args: { p_dry_run?: boolean }
        Returns: {
          conflicts: Json
          dry_run: boolean
          queue_cancelled: number
          queue_relinked: number
          trades_cancelled: number
        }[]
      }
      run_auto_trade_cycle: {
        Args: never
        Returns: {
          failed: number
          processed: number
          succeeded: number
          trades_queued: number
          users_processed: number
        }[]
      }
      run_my_auto_trade_cycle: {
        Args: never
        Returns: {
          failed: number
          processed: number
          succeeded: number
          trades_queued: number
          users_processed: number
        }[]
      }
      set_cache: {
        Args: { data: Json; key: string; ttl_seconds: number }
        Returns: undefined
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
