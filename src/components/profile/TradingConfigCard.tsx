import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Settings2, DollarSign, Percent, Save, TrendingDown, Shield } from 'lucide-react';

interface TradingConfig {
  tradeAmount: number;
  minProfitPercent: number;
  slippageBuffer: number;
  maxPositionSize: number;
}

const DEFAULTS: TradingConfig = {
  tradeAmount: 10,
  minProfitPercent: 0.05,
  slippageBuffer: 0.5,
  maxPositionSize: 1000,
};

export const TradingConfigCard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [config, setConfig] = useState<TradingConfig>({ ...DEFAULTS });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [original, setOriginal] = useState<TradingConfig>({ ...DEFAULTS });

  const loadSettings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('user_settings') as any)
        .select('trade_amount, min_profit_percent, slippage_buffer, max_position_size')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        const loaded: TradingConfig = {
          tradeAmount: parseFloat(data.trade_amount?.toString() || '10'),
          minProfitPercent: parseFloat(data.min_profit_percent?.toString() || '0.0005') * 100,
          slippageBuffer: parseFloat(data.slippage_buffer?.toString() || '0.5'),
          maxPositionSize: parseFloat(data.max_position_size?.toString() || '1000'),
        };
        setConfig(loaded);
        setOriginal(loaded);
      }
    } catch (err) {
      console.error('Failed to load trading config:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setHasChanges(
      config.tradeAmount !== original.tradeAmount ||
      config.minProfitPercent !== original.minProfitPercent ||
      config.slippageBuffer !== original.slippageBuffer ||
      config.maxPositionSize !== original.maxPositionSize
    );
  }, [config, original]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await (supabase
        .from('user_settings') as any)
        .upsert(
          {
            user_id: user.id,
            trade_amount: config.tradeAmount,
            min_profit_percent: config.minProfitPercent / 100,
            slippage_buffer: config.slippageBuffer,
            max_position_size: config.maxPositionSize,
          },
          { onConflict: 'user_id' }
        );

      if (error) throw error;

      setOriginal({ ...config });
      setHasChanges(false);
      toast({
        title: 'Trading Config Saved',
        description: `Amount: $${config.tradeAmount} | Profit: ${config.minProfitPercent}% | Slippage: ${config.slippageBuffer}% | Max Position: $${config.maxPositionSize}`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: 'Failed to save trading configuration',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof TradingConfig, value: string, fallback: number) => {
    setConfig(prev => ({ ...prev, [field]: parseFloat(value) || fallback }));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Trading Configuration
          </CardTitle>
          {hasChanges && (
            <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-500 animate-pulse">
              Unsaved
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  Min Trade Amount (USDT)
                </Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={config.tradeAmount}
                  onChange={(e) => updateField('tradeAmount', e.target.value, 10)}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Minimum size per trade leg
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Percent className="h-3 w-3 text-muted-foreground" />
                  Min Profit to Trade (%)
                </Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={config.minProfitPercent}
                  onChange={(e) => updateField('minProfitPercent', e.target.value, 0.05)}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Only execute if net profit exceeds this
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <TrendingDown className="h-3 w-3 text-muted-foreground" />
                  Slippage Buffer (%)
                </Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={config.slippageBuffer}
                  onChange={(e) => updateField('slippageBuffer', e.target.value, 0.5)}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Price slippage tolerance per leg
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-muted-foreground" />
                  Max Position Size (USDT)
                </Label>
                <Input
                  type="number"
                  min={10}
                  step={10}
                  value={config.maxPositionSize}
                  onChange={(e) => updateField('maxPositionSize', e.target.value, 1000)}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Maximum USD per trade leg
                </p>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              size="sm"
              className="w-full"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
