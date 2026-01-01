import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type ExchangeName = Database['public']['Enums']['exchange_name'];

const AVAILABLE_EXCHANGES: { value: ExchangeName; label: string }[] = [
    { value: 'binance', label: 'Binance' },
    { value: 'bybit', label: 'Bybit' },
    { value: 'okx', label: 'OKX' },
    { value: 'gate', label: 'Gate.io' },
    { value: 'kucoin', label: 'KuCoin' },
    { value: 'mexc', label: 'MEXC' },
];

export function EnabledExchangesManager() {
    const { user } = useAuth();
    const [enabledExchanges, setEnabledExchanges] = useState<ExchangeName[]>(['binance', 'bybit', 'okx']);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadEnabledExchanges = useCallback(async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('user_settings')
                .select('enabled_exchanges')
                .eq('user_id', user.id)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data?.enabled_exchanges) {
                setEnabledExchanges(data.enabled_exchanges as ExchangeName[]);
            }
        } catch (error) {
            console.error('Error loading enabled exchanges:', error);
            toast.error('Failed to load enabled exchanges');
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        loadEnabledExchanges();
    }, [loadEnabledExchanges]);

    const handleToggleExchange = (exchange: ExchangeName) => {
        setEnabledExchanges((prev) => {
            if (prev.includes(exchange)) {
                return prev.filter((ex) => ex !== exchange);
            } else {
                return [...prev, exchange];
            }
        });
    };

    const handleSave = async () => {
        if (!user?.id) return;

        setSaving(true);
        try {
            const { error } = await supabase
                .from('user_settings')
                .upsert(
                    {
                        user_id: user.id,
                        enabled_exchanges: enabledExchanges,
                    },
                    { onConflict: 'user_id' }
                );

            if (error) throw error;

            toast.success('Enabled exchanges updated successfully');
        } catch (error) {
            console.error('Error saving enabled exchanges:', error);
            toast.error('Failed to save enabled exchanges');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Enabled Exchanges</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="glass-card border-primary/10">
            <CardHeader className="border-b border-primary/5">
                <CardTitle className="text-sm font-black uppercase tracking-widest">Exchange Network</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
                <p className="text-[11px] text-muted-foreground opacity-70 font-medium">
                    Configure active surveillance nodes
                </p>

                <div className="grid grid-cols-2 gap-3">
                    {AVAILABLE_EXCHANGES.map((exchange) => (
                        <div
                            key={exchange.value}
                            className={`flex items-center space-x-3 p-3 rounded-lg border transition-all ${enabledExchanges.includes(exchange.value)
                                    ? 'border-primary/30 bg-primary/5'
                                    : 'border-primary/10 bg-muted/20'
                                }`}
                        >
                            <Checkbox
                                id={`exchange-${exchange.value}`}
                                checked={enabledExchanges.includes(exchange.value)}
                                onCheckedChange={() => handleToggleExchange(exchange.value)}
                                className="data-[state=checked]:bg-primary"
                            />
                            <Label
                                htmlFor={`exchange-${exchange.value}`}
                                className="text-xs font-bold cursor-pointer uppercase tracking-wider"
                            >
                                {exchange.label}
                            </Label>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end pt-2">
                    <Button
                        onClick={handleSave}
                        disabled={saving}
                        className="premium-gradient text-black font-bold text-[10px] uppercase tracking-wider shadow-lg shadow-primary/20"
                    >
                        <Save className="h-3 w-3 mr-2" />
                        {saving ? 'Syncing...' : 'Apply Config'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
