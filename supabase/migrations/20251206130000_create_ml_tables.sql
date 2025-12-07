-- Migration: ML feature storage and model metadata
-- Date: 2025-12-06
-- Description: Create tables for ML feature engineering and model management

-- ML Features table - stores engineered features from opportunities
CREATE TABLE IF NOT EXISTS public.ml_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES public.arbitrage_opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Price features
  profit_percent DECIMAL(8,4) NOT NULL,
  spread_percent DECIMAL(8,4),
  price_volatility DECIMAL(8,4),
  
  -- Volume features
  volume_score DECIMAL(8,4),
  liquidity_score DECIMAL(8,4),
  
  -- Time features
  hour_of_day INTEGER,
  day_of_week INTEGER,
  is_weekend BOOLEAN,
  
  -- Exchange features
  exchange_combo VARCHAR(100),
  
  -- Historical features (rolling windows)
  avg_profit_7d DECIMAL(8,4),
  avg_profit_24h DECIMAL(8,4),
  success_rate_7d DECIMAL(5,2),
  similar_opp_count_24h INTEGER,
  
  -- Target variable (was the opportunity profitable if executed?)
  was_successful BOOLEAN,
  actual_profit DECIMAL(20,8),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ml_features_user ON public.ml_features(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_features_created ON public.ml_features(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_features_profit ON public.ml_features(profit_percent DESC);

-- ML Models table - stores model versions and metadata
CREATE TABLE IF NOT EXISTS public.ml_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  model_type VARCHAR(50) NOT NULL, -- 'xgboost', 'random_forest', etc.
  
  -- Model binary data (serialized model)
  model_data BYTEA,
  
  -- Model metadata
  feature_columns JSONB NOT NULL,
  hyperparameters JSONB,
  
  -- Performance metrics
  train_accuracy DECIMAL(5,4),
  test_accuracy DECIMAL(5,4),
  precision_score DECIMAL(5,4),
  recall_score DECIMAL(5,4),
  f1_score DECIMAL(5,4),
  auc_score DECIMAL(5,4),
  
  -- Training info
  training_samples INTEGER,
  training_started_at TIMESTAMP WITH TIME ZONE,
  training_completed_at TIMESTAMP WITH TIME ZONE,
  training_duration_seconds INTEGER,
  
  -- Deployment info
  is_active BOOLEAN DEFAULT false,
  deployed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  UNIQUE(model_name, model_version)
);

-- Index for active model lookup
CREATE INDEX IF NOT EXISTS idx_ml_models_active 
ON public.ml_models(model_name, is_active) 
WHERE is_active = true;

-- ML Predictions table - stores prediction history
CREATE TABLE IF NOT EXISTS public.ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES public.ml_models(id),
  opportunity_id UUID REFERENCES public.arbitrage_opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Prediction results
  predicted_success_probability DECIMAL(5,4) NOT NULL,
  predicted_profit DECIMAL(20,8),
  confidence_score DECIMAL(5,4),
  
  -- Feature values used for prediction
  input_features JSONB NOT NULL,
  
  -- Actual outcome (filled after trade execution)
  actual_success BOOLEAN,
  actual_profit DECIMAL(20,8),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  outcome_recorded_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ml_predictions_user ON public.ml_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON public.ml_predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_created ON public.ml_predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_probability 
ON public.ml_predictions(predicted_success_probability DESC);

-- Function to get active model
CREATE OR REPLACE FUNCTION public.get_active_ml_model(p_model_name VARCHAR(100))
RETURNS TABLE (
  id UUID,
  model_version VARCHAR(50),
  feature_columns JSONB,
  auc_score DECIMAL(5,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.model_version,
    m.feature_columns,
    m.auc_score
  FROM public.ml_models m
  WHERE m.model_name = p_model_name
    AND m.is_active = true
  ORDER BY m.deployed_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to deploy new model version
CREATE OR REPLACE FUNCTION public.deploy_ml_model(p_model_id UUID)
RETURNS VOID AS $$
DECLARE
  model_record RECORD;
BEGIN
  -- Get model info
  SELECT * INTO model_record
  FROM public.ml_models
  WHERE id = p_model_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found';
  END IF;
  
  -- Deactivate all other versions of this model
  UPDATE public.ml_models
  SET is_active = false
  WHERE model_name = model_record.model_name
    AND id != p_model_id;
  
  -- Activate the new model
  UPDATE public.ml_models
  SET 
    is_active = true,
    deployed_at = now()
  WHERE id = p_model_id;
END;
$$ LANGUAGE plpgsql;

-- Function to record prediction outcome
CREATE OR REPLACE FUNCTION public.record_prediction_outcome(
  p_prediction_id UUID,
  p_actual_success BOOLEAN,
  p_actual_profit DECIMAL(20,8)
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.ml_predictions
  SET 
    actual_success = p_actual_success,
    actual_profit = p_actual_profit,
    outcome_recorded_at = now()
  WHERE id = p_prediction_id;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE public.ml_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_predictions ENABLE ROW LEVEL SECURITY;

-- Policies for ml_features
CREATE POLICY "Users can view own ML features"
ON public.ml_features
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to ML features"
ON public.ml_features
FOR ALL
TO service_role
USING (true);

-- Policies for ml_models (read-only for authenticated users)
CREATE POLICY "Users can view ML models"
ON public.ml_models
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role has full access to ML models"
ON public.ml_models
FOR ALL
TO service_role
USING (true);

-- Policies for ml_predictions
CREATE POLICY "Users can view own predictions"
ON public.ml_predictions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to predictions"
ON public.ml_predictions
FOR ALL
TO service_role
USING (true);

COMMENT ON TABLE public.ml_features IS 
'Engineered features from arbitrage opportunities for ML training';

COMMENT ON TABLE public.ml_models IS 
'ML model versions with metadata and performance metrics';

COMMENT ON TABLE public.ml_predictions IS 
'Prediction history for backtesting and model validation';
