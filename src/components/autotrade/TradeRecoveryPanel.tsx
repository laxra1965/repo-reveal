import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RefreshCw, XCircle, Clock, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';

interface RecoveryState {
    id: string;
    trade_id: string;
    current_step: number;
    recovery_attempts: number;
    recovery_status: string;
    created_at: string;
    trade_history: {
        opportunity_id: string;
        start_amount: number;
        execution_details: any;
        created_at: string;
    };
}

export function TradeRecoveryPanel() {
    const { user } = useAuth();
    const [recoveries, setRecoveries] = useState<RecoveryState[]>([]);
    const [loading, setLoading] = useState(true);
    const [recovering, setRecovering] = useState<string | null>(null);

    const fetchRecoveries = useCallback(async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('trade_recovery_state')
                .select(`
          *,
          trade_history (
            opportunity_id,
            start_amount,
            execution_details,
            created_at
          )
        `)
                .eq('user_id', user.id)
                .in('recovery_status', ['pending', 'in_progress'])
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching recoveries:', error);
                throw error;
            }

            setRecoveries(data || []);
        } catch (error) {
            console.error('Failed to fetch recovery states:', error);
            toast.error('Failed to load recovery information');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchRecoveries();

        // Set up real-time subscription for recovery updates
        const channel = supabase
            .channel('recovery-updates')
            .on('postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'trade_recovery_state',
                    filter: `user_id=eq.${user?.id}`
                },
                () => {
                    fetchRecoveries();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, fetchRecoveries]);

    const handleAttemptRecovery = async (recoveryId: string, tradeId: string) => {
        setRecovering(recoveryId);

        try {
            console.log(`Attempting recovery for trade ${tradeId}...`);

            // Call execute-trade Edge Function to retry the trade
            const { data, error } = await supabase.functions.invoke('execute-trade', {
                body: {
                    action: 'retry_failed',
                    tradeId: tradeId,
                    recoveryId: recoveryId
                }
            });

            if (error) {
                console.error('Recovery error:', error);
                throw new Error(error.message || 'Recovery attempt failed');
            }

            if (data && data.success) {
                toast.success('Trade recovered successfully!');
                fetchRecoveries();
            } else {
                toast.error('Recovery failed: ' + (data?.error || 'Unknown error'));
            }
        } catch (error: any) {
            console.error('Recovery attempt error:', error);
            toast.error('Failed to recover trade: ' + (error.message || 'Unknown error'));
        } finally {
            setRecovering(null);
        }
    };

    const handleCancelRecovery = async (recoveryId: string) => {
        try {
            const { error } = await supabase
                .from('trade_recovery_state')
                .update({ recovery_status: 'cancelled' })
                .eq('id', recoveryId);

            if (error) throw error;

            toast.success('Recovery cancelled');
            fetchRecoveries();
        } catch (error) {
            console.error('Cancel error:', error);
            toast.error('Failed to cancel recovery');
        }
    };

    if (loading) {
        return (
            <Card className="border-amber-200 bg-amber-50/30">
                <CardContent className="py-6">
                    <div className="flex items-center justify-center gap-2 text-amber-700">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Checking for pending recoveries...</span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (recoveries.length === 0) {
        return null; // Don't show panel if no recoveries needed
    }

    return (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="h-5 w-5" />
                    Trades Needing Recovery ({recoveries.length})
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start gap-2 mb-4 p-3 bg-amber-100/50 dark:bg-amber-900/20 rounded-lg">
                    <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                        These trades failed mid-execution. You can attempt to recover them or cancel.
                        Recovery will try to complete the remaining steps.
                    </p>
                </div>

                {recoveries.map((recovery) => {
                    const tradeDetails = recovery.trade_history;
                    const executionDetails = tradeDetails?.execution_details || {};
                    const maxAttempts = 3;
                    const canRetry = recovery.recovery_attempts < maxAttempts;

                    return (
                        <div key={recovery.id} className="border border-amber-200 dark:border-amber-800 rounded-lg p-4 bg-white dark:bg-gray-900">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium text-sm">Trade #{recovery.trade_id.slice(0, 8)}</span>
                                        <Badge
                                            variant={recovery.recovery_status === 'pending' ? 'secondary' : 'default'}
                                            className="text-xs"
                                        >
                                            {recovery.recovery_status}
                                        </Badge>
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                                        <div className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            <span>Failed at step {recovery.current_step} of 3</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <RefreshCw className="h-3 w-3" />
                                            <span>Attempts: {recovery.recovery_attempts}/{maxAttempts}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="font-medium">Amount:</span>
                                            <span>${tradeDetails?.start_amount?.toFixed(2) || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="font-medium">Created:</span>
                                            <span>{new Date(recovery.created_at).toLocaleTimeString()}</span>
                                        </div>
                                    </div>

                                    {executionDetails.error && (
                                        <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                                            Error: {executionDetails.error}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 mt-3">
                                <Button
                                    size="sm"
                                    onClick={() => handleAttemptRecovery(recovery.id, recovery.trade_id)}
                                    disabled={!canRetry || recovering === recovery.id}
                                    className="flex items-center gap-2"
                                >
                                    {recovering === recovery.id ? (
                                        <>
                                            <RefreshCw className="h-3 w-3 animate-spin" />
                                            Recovering...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="h-3 w-3" />
                                            Attempt Recovery
                                        </>
                                    )}
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCancelRecovery(recovery.id)}
                                    disabled={recovering === recovery.id}
                                    className="flex items-center gap-2"
                                >
                                    <XCircle className="h-3 w-3" />
                                    Cancel
                                </Button>

                                {!canRetry && (
                                    <span className="text-xs text-muted-foreground flex items-center ml-2">
                                        Max attempts reached
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div className="text-xs text-amber-700 dark:text-amber-300 mt-4 p-3 bg-amber-100/30 dark:bg-amber-900/10 rounded">
                    <strong>Note:</strong> Recovery attempts will try to complete the trade from where it failed.
                    If recovery fails after 3 attempts, please contact support.
                </div>
            </CardContent>
        </Card>
    );
}
