import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  actualProfit?: number;
  executionDetails?: any;
  error?: string;
}

export const useTradeExecution = () => {
  const [executing, setExecuting] = useState(false);
  const { toast } = useToast();

  const executeTrade = async (opportunityId: string): Promise<TradeExecutionResult> => {
    setExecuting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No active session');
      }

      toast({
        title: "Executing Trade",
        description: "Starting trade execution... This may take a few moments.",
      });

      const response = await supabase.functions.invoke('execute-trade', {
        body: { opportunityId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw response.error;
      }

      const result = response.data as TradeExecutionResult;

      if (result.success) {
        toast({
          title: "Trade Completed",
          description: `Trade executed successfully! Actual profit: $${result.actualProfit?.toFixed(2)}`,
        });
      } else {
        throw new Error(result.error || 'Trade execution failed');
      }

      return result;
    } catch (error: any) {
      console.error('Trade execution error:', error);
      
      toast({
        title: "Trade Failed",
        description: error.message || 'Failed to execute trade',
        variant: "destructive",
      });

      return {
        success: false,
        error: error.message,
      };
    } finally {
      setExecuting(false);
    }
  };

  return {
    executeTrade,
    executing,
  };
};
