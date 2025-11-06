import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const AdminSystemMaintenance = () => {
  const [cleaning, setCleaning] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{ count: number; timestamp: Date } | null>(null);
  const { toast } = useToast();

  const handleCleanupOldOpportunities = async () => {
    try {
      setCleaning(true);

      // Calculate 24 hours ago
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Delete old opportunities
      const { error, count } = await supabase
        .from('arbitrage_opportunities')
        .delete({ count: 'exact' })
        .lt('detected_at', twentyFourHoursAgo);

      if (error) {
        throw error;
      }

      const deletedCount = count || 0;
      setLastCleanup({ count: deletedCount, timestamp: new Date() });

      toast({
        title: "Cleanup Complete",
        description: `Successfully deleted ${deletedCount} old arbitrage opportunities`,
      });
    } catch (error: any) {
      console.error('Error cleaning up opportunities:', error);
      toast({
        title: "Cleanup Failed",
        description: error.message || "Failed to cleanup old opportunities",
        variant: "destructive",
      });
    } finally {
      setCleaning(false);
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
            Cleanup removes all arbitrage opportunities older than 24 hours from the database to improve performance.
          </AlertDescription>
        </Alert>

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
                Last cleanup: {lastCleanup.timestamp.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">
                Deleted: {lastCleanup.count} opportunities
              </p>
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-muted/30">
          <h4 className="font-medium text-sm mb-2">Automatic Cleanup</h4>
          <p className="text-sm text-muted-foreground">
            The system automatically cleans up expired opportunities during scans. 
            This manual cleanup is useful for immediate maintenance needs.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
