import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Power } from 'lucide-react';

export const AdminSystemConfig = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabledTypes, setEnabledTypes] = useState<string[]>([]);
    const { toast } = useToast();

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const { data, error } = await supabase
                .from('admin_settings')
                .select('key, value')
                .eq('key', 'enabled_arbitrage_types')
                .maybeSingle();

            if (error) throw error;

            if (data) {
                setEnabledTypes(data.value.split(',').filter(Boolean));
            } else {
                // Defaults if not set
                setEnabledTypes(['triangular', 'cross_exchange', 'short']);
            }
        } catch (error: any) {
            console.error('Error loading config:', error);
            toast({
                title: "Error",
                description: "Failed to load system configuration",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = (type: string) => {
        setEnabledTypes(prev =>
            prev.includes(type)
                ? prev.filter(t => t !== type)
                : [...prev, type]
        );
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('admin_settings')
                .upsert({
                    key: 'enabled_arbitrage_types',
                    value: enabledTypes.join(','),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' });

            if (error) throw error;

            toast({
                title: "Configuration Saved",
                description: "Global arbitrage settings updated successfully",
            });
        } catch (error: any) {
            console.error('Error saving config:', error);
            toast({
                title: "Error",
                description: "Failed to save configuration",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Power className="h-5 w-5 text-primary" />
                    Global Arbitrage Control
                </CardTitle>
                <CardDescription>
                    Enable or disable arbitrage scanning and trading system-wide. Disabling a type here prevents ALL users from scanning or trading that type.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex items-center space-x-3 p-4 border rounded-lg bg-background/50">
                        <Checkbox
                            id="admin-tri"
                            checked={enabledTypes.includes('triangular')}
                            onCheckedChange={() => handleToggle('triangular')}
                        />
                        <div className="grid gap-1.5 leading-none">
                            <Label htmlFor="admin-tri" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Triangular Arbitrage
                            </Label>
                            <p className="text-xs text-muted-foreground">3-step trades on same exchange</p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-3 p-4 border rounded-lg bg-background/50">
                        <Checkbox
                            id="admin-cross"
                            checked={enabledTypes.includes('cross_exchange')}
                            onCheckedChange={() => handleToggle('cross_exchange')}
                        />
                        <div className="grid gap-1.5 leading-none">
                            <Label htmlFor="admin-cross" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Cross-Exchange
                            </Label>
                            <p className="text-xs text-muted-foreground">Buy on one, sell on another</p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-3 p-4 border rounded-lg bg-background/50">
                        <Checkbox
                            id="admin-short"
                            checked={enabledTypes.includes('short')}
                            onCheckedChange={() => handleToggle('short')}
                        />
                        <div className="grid gap-1.5 leading-none">
                            <Label htmlFor="admin-short" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Short Signals
                            </Label>
                            <p className="text-xs text-muted-foreground">Short-selling opportunities</p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button onClick={handleSave} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Global Config
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
