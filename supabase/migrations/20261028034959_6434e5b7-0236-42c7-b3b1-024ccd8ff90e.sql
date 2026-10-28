CREATE OR REPLACE FUNCTION public.process_pending_auto_trades()
RETURNS TABLE(processed integer, succeeded integer, failed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q record; v_id uuid; n integer := 0; f integer := 0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 FOR q IN SELECT aq.*, o.path, o.strategy, o.exchange1,o.exchange2,o.exchange3,o.profit_percent
 FROM public.auto_trade_queue aq JOIN public.opportunities o ON o.id=aq.opportunity_id
 WHERE aq.status='queued' AND o.status='active' AND o.detected_at > now()-interval '60 seconds'
 ORDER BY aq.priority DESC,aq.queued_at LIMIT 20 FOR UPDATE OF aq SKIP LOCKED
 LOOP
 BEGIN
 SELECT id INTO v_id FROM public.trade_history WHERE user_id=q.user_id AND opportunity_id=q.opportunity_id AND status IN ('pending','executing') LIMIT 1;
 IF v_id IS NULL THEN
 INSERT INTO public.trade_history(user_id,opportunity_id,base_symbol,quote_symbol,intermediate_symbol,start_amount,expected_profit,status,total_steps,completed_steps,execution_details)
 VALUES(q.user_id,q.opportunity_id,'USDT','USDT',split_part(regexp_replace(q.path,'\s*(→|->|>)\s*','|','g'),'|',2),q.actual_trade_amount,q.actual_trade_amount*(q.profit_percent-0.3)/100,'pending',3,0,jsonb_build_object('queue_id',q.id,'mode','live','queued_from','auto_trade','exchange1',q.exchange1,'exchange2',q.exchange2,'exchange3',q.exchange3)) RETURNING id INTO v_id;
 END IF;
 UPDATE public.auto_trade_queue SET status='processing',started_at=now(),completed_at=NULL WHERE id=q.id;
 n:=n+1;
 EXCEPTION WHEN OTHERS THEN UPDATE public.auto_trade_queue SET status='failed',error_message=SQLERRM,completed_at=now() WHERE id=q.id; f:=f+1;
 END;
 END LOOP;
 UPDATE public.auto_trade_queue aq SET status='failed',error_message='Opportunity expired before dispatch',completed_at=now() WHERE aq.status='queued' AND NOT EXISTS(SELECT 1 FROM public.opportunities o WHERE o.id=aq.opportunity_id AND o.status='active' AND o.detected_at>now()-interval '60 seconds');
 RETURN QUERY SELECT n,0,f;
END $$;
REVOKE ALL ON FUNCTION public.process_pending_auto_trades() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_pending_auto_trades() TO service_role;
GRANT ALL ON public.opportunities,public.auto_trade_queue,public.trade_history,public.exchange_credentials,public.user_settings,public.admin_settings,public.user_subscriptions,public.admin_users,public.scanner_health_metrics,public.scheduler_runs TO service_role;