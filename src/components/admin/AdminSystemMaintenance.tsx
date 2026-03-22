import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Trash2, RefreshCw, AlertCircle, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invokeFunction } from '@/lib/functionsInvoke';
import { useAuth } from '@/hooks/useAuth';

export const AdminSystemMaintenance = () => {
  const [cleaning, setCleaning] = useState(false);
  const [purging, setPurging] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{ count: number; timestamp: Date } | null>(null);
  const [lastPurge, setLastPurge] = useState<{ count: number; timestamp: Date } | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleCleanupOldOpportunities = async () => {
    if (!user) return;

    try {
      setCleaning(true);

      let recordsToDelete = 0;

      try {
        const response = await invokeFunction('clear-user-data', {
          body: {
            action: 'clear_opportunities_old',
            daysOld: 1
          }
        });

        if (response.error) {
          throw new Error(response.error.message || response.error || 'Function returned error');
        }

        const result = response.data || response;
        recordsToDelete = result?.deletedCount || result?.details?.opportunities || 0;
      } catch (functionError: any) {
        console.warn('Function invocation failed, using direct Supabase query:', functionError);
        
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { count: existingCount, error: countError } = await supabase
          .from('arbitrage_opportunities')
          .select('*', { count: 'exact', head: true })
          .lt('detected_at', twentyFourHoursAgo);

        if (countError) throw countError;

        recordsToDelete = existingCount || 0;

        const { error } = await supabase
          .from('arbitrage_opportunities')
          .delete()
          .lt('detected_at', twentyFourHoursAgo);

        if (error) throw error;
      }

      setLastCleanup({ count: recordsToDelete, timestamp: new Date() });

      toast({
        title: "Cleanup Complete",
        description: `Successfully deleted ${recordsToDelete} old arbitrage opportunities`,
      });
    } catch (error: any) {
      console.error('Error cleaning up opportunities:', error);
      let errorMessage = error.message || "Failed to cleanup old opportunities";
      
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        errorMessage = "Network error: Unable to reach the server.";
      } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        errorMessage = "Function not found. Please ensure clear-user-data is deployed.";
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage = "Authentication failed. Please sign in again.";
      }
      
      toast({
        title: "Cleanup Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeExpired = async () => {
    if (!user) return;

    try {
      setPurging(true);

      // Use the existing DB function to purge all expired opportunities
      const { data, error } = await supabase.rpc('cleanup_expired_opportunities');

      if (error) throw error;

      const deletedCount = data?.[0]?.deleted_count ?? 0;
      setLastPurge({ count: deletedCount, timestamp: new Date() });

      toast({
        title: "Purge Complete",
        description: `Removed ${deletedCount} expired opportunities from the database.`,
      });
    } catch (error: any) {
      console.error('Error purging expired opportunities:', error);
      toast({
        title: "Purge Failed",
        description: error.message || "Failed to purge expired opportunities",
        variant: "destructive",
      });
    } finally {
      setPurging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          System Maintenance
        </CardTitle>
        <CardDescription>
          Manage system cleanup and maintenance tasks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Cleanup removes stale data from the database to improve performance and reduce storage usage.
          </AlertDescription>
        </Alert>

        {/* Purge All Expired */}
        <div className="border rounded-lg p-4 space-y-4 border-destructive/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-destructive" />
                Purge All Expired Opportunities
              </h3>
              <p className="text-sm text-muted-foreground">
                Remove all expired, inactive, or stale opportunities immediately
              </p>
            </div>
            <Button
              onClick={handlePurgeExpired}
              disabled={purging}
              variant="destructive"
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {purging ? "Purging..." : "Purge Now"}
            </Button>
          </div>

          {lastPurge && (
            <div className="pt-3 border-t">
              <p className="text-sm text-muted-foreground">
                Last purge: {lastPurge.timestamp.toLocaleString()} — Deleted: {lastPurge.count} records
              </p>
            </div>
          )}
        </div>

        {/* Clean Old (24h+) */}
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Clean Old Opportunities</h3>
              <p className="text-sm text-muted-foreground">
                Remove arbitrage opportunities older than 24 hours
              </p>
            </div>
            <Button
              onClick={handleCleanupOldOpportunities}
              disabled={cleaning}
              variant="destructive"
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {cleaning ? "Cleaning..." : "Clean Now"}
            </Button>
          </div>

          {lastCleanup && (
            <div className="pt-3 border-t">
              <p className="text-sm text-muted-foreground">
                Last cleanup: {lastCleanup.timestamp.toLocaleString()} — Deleted: {lastCleanup.count} records
              </p>
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-muted/30">
          <h4 className="font-medium text-sm mb-2">Automatic Cleanup</h4>
          <p className="text-sm text-muted-foreground">
            The system automatically cleans up expired opportunities during scans.
            Use manual purge for immediate maintenance needs.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
