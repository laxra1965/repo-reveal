-- Migration: Trade recovery table
-- Date: 2025-12-06
-- Description: Add table for tracking partial trade execution state and recovery

CREATE TABLE IF NOT EXISTS public.trade_recovery_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trade_history(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  completed_steps_data JSONB DEFAULT '[]',
  pending_steps_data JSONB DEFAULT '[]',
  recovery_attempts INTEGER DEFAULT 0,
  last_recovery_attempt_at TIMESTAMP WITH TIME ZONE,
  recovery_status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, failed, cancelled
  error_details JSONB,
  rollback_required BOOLEAN DEFAULT false,
  rollback_steps JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(trade_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_recovery_user 
ON public.trade_recovery_state(user_id, recovery_status);

CREATE INDEX IF NOT EXISTS idx_trade_recovery_status 
ON public.trade_recovery_state(recovery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_recovery_attempts 
ON public.trade_recovery_state(recovery_attempts, last_recovery_attempt_at)
WHERE recovery_status = 'pending' AND recovery_attempts < 3;

-- Function to create recovery state for failed trade
CREATE OR REPLACE FUNCTION public.create_trade_recovery_state(
  p_trade_id UUID,
  p_user_id UUID,
  p_current_step INTEGER,
  p_completed_steps JSONB,
  p_pending_steps JSONB,
  p_error_details JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  recovery_id UUID;
BEGIN
  INSERT INTO public.trade_recovery_state (
    trade_id,
    user_id,
    current_step,
    completed_steps_data,
    pending_steps_data,
    error_details,
    recovery_status
  ) VALUES (
    p_trade_id,
    p_user_id,
    p_current_step,
    p_completed_steps,
    p_pending_steps,
    p_error_details,
    'pending'
  )
  ON CONFLICT (trade_id) DO UPDATE SET
    current_step = EXCLUDED.current_step,
    completed_steps_data = EXCLUDED.completed_steps_data,
    pending_steps_data = EXCLUDED.pending_steps_data,
    error_details = EXCLUDED.error_details,
    updated_at = now()
  RETURNING id INTO recovery_id;
  
  RETURN recovery_id;
END;
$$ LANGUAGE plpgsql;

-- Function to attempt trade recovery
CREATE OR REPLACE FUNCTION public.attempt_trade_recovery(p_recovery_id UUID)
RETURNS JSONB AS $$
DECLARE
  recovery_record RECORD;
  result JSONB;
BEGIN
  -- Get recovery state
  SELECT * INTO recovery_record
  FROM public.trade_recovery_state
  WHERE id = p_recovery_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recovery state not found');
  END IF;
  
  -- Check if max attempts reached
  IF recovery_record.recovery_attempts >= 3 THEN
    UPDATE public.trade_recovery_state
    SET recovery_status = 'failed'
    WHERE id = p_recovery_id;
    
    RETURN jsonb_build_object('success', false, 'error', 'Max recovery attempts reached');
  END IF;
  
  -- Update attempt counter
  UPDATE public.trade_recovery_state
  SET 
    recovery_attempts = recovery_attempts + 1,
    last_recovery_attempt_at = now(),
    recovery_status = 'in_progress',
    updated_at = now()
  WHERE id = p_recovery_id;
  
  -- Return recovery data for processing
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', recovery_record.trade_id,
    'current_step', recovery_record.current_step,
    'completed_steps', recovery_record.completed_steps_data,
    'pending_steps', recovery_record.pending_steps_data
  );
END;
$$ LANGUAGE plpgsql;

-- Function to mark recovery as completed
CREATE OR REPLACE FUNCTION public.complete_trade_recovery(
  p_recovery_id UUID,
  p_final_step INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.trade_recovery_state
  SET 
    recovery_status = 'completed',
    current_step = p_final_step,
    updated_at = now()
  WHERE id = p_recovery_id;
  
  -- Update original trade status
  UPDATE public.trade_history
  SET status = 'completed'
  WHERE id = (
    SELECT trade_id FROM public.trade_recovery_state WHERE id = p_recovery_id
  );
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_trade_recovery_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_trade_recovery_updated_at
BEFORE UPDATE ON public.trade_recovery_state
FOR EACH ROW
EXECUTE FUNCTION public.update_trade_recovery_timestamp();

-- Enable RLS
ALTER TABLE public.trade_recovery_state ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own recovery states"
ON public.trade_recovery_state
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own recovery states"
ON public.trade_recovery_state
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to recovery states"
ON public.trade_recovery_state
FOR ALL
TO service_role
USING (true);

COMMENT ON TABLE public.trade_recovery_state IS 
'Tracks partial execution state for failed trades to enable recovery';
