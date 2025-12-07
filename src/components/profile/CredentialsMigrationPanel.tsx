import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

export function CredentialsMigrationPanel() {
    const { user } = useAuth();
    const [migrating, setMigrating] = useState(false);
    const [pendingCount, setPendingCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkPendingCredentials();
    }, [user]);

    const checkPendingCredentials = async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('exchange_credentials')
                .select('id')
                .eq('user_id', user.id)
                .or('migration_status.eq.pending,migration_status.is.null');

            if (error) throw error;

            const pending = data?.length || 0;
            setPendingCount(pending);
        } catch (error) {
            console.error('Error checking pending credentials:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleMigrate = async () => {
        if (!user?.id) return;

        setMigrating(true);

        try {
            console.log('Starting credential encryption migration...');

            const { data, error } = await supabase.functions.invoke('encrypt-api-keys', {
                body: {
                    action: 'migrate',
                    userId: user.id
                }
            });

            if (error) {
                console.error('Migration error:', error);
                throw new Error(error.message || 'Migration failed');
            }

            if (data && data.migrated !== undefined) {
                toast.success(`Successfully encrypted ${data.migrated} credential${data.migrated !== 1 ? 's' : ''}`);
                setPendingCount(0);
            } else {
                toast.success('Credentials migrated successfully');
                setPendingCount(0);
            }

            // Refresh count
            await checkPendingCredentials();
        } catch (error: any) {
            console.error('Migration error:', error);
            toast.error('Migration failed: ' + (error.message || 'Unknown error'));
        } finally {
            setMigrating(false);
        }
    };

    // Don't show panel if no credentials need migration
    if (loading) {
        return null;
    }

    if (pendingCount === 0 || pendingCount === null) {
        return null;
    }

    return (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="h-5 w-5" />
                    Security Notice: Plaintext Credentials Detected
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className="flex items-start gap-3">
                        <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                                You have {pendingCount} API credential{pendingCount !== 1 ? 's' : ''} stored in plaintext.
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                For enhanced security, we recommend encrypting them now. This is a one-time process and won't affect functionality.
                            </p>
                        </div>
                    </div>

                    <Button
                        onClick={handleMigrate}
                        disabled={migrating}
                        className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-800 w-full sm:w-auto"
                    >
                        {migrating ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Encrypting...
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                Encrypt {pendingCount} Credential{pendingCount !== 1 ? 's' : ''} Now
                            </>
                        )}
                    </Button>

                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        ℹ️ After encryption, credentials can only be decrypted by the system. This prevents unauthorized access.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
