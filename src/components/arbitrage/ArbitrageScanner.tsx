import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArbitrageSettings } from './ArbitrageSettings';
import { ArbitrageOpportunityCard } from './ArbitrageOpportunityCard';
import { ArbitrageLogPanel } from './ArbitrageLogPanel';
import { PlansSection } from '@/components/plans/PlansSection';
import { Play, Pause, Settings, TrendingUp, Lock, Crown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Opportunity {
  id: string;
  base_symbol: string;
  quote_symbol: string;
  intermediate_symbol: string;
  exchange1: string;
  exchange2: string;
  exchange3: string;
  step1_action: string;
  step1_price: number;
  step1_amount: number;
  step2_action: string;
  step2_price: number;
  step2_amount: number;
  step3_action: string;
  step3_price: number;
  step3_amount: number;
  start_amount: number;
  end_amount: number;
  profit_amount: number;
  profit_percent: number;
  detected_at: string;
  expires_at: string;
  type?: string;
}

// Debounce utility
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

const OPPORTUNITIES_PER_PAGE = 10;

export const ArbitrageScanner = () => {
  const { user } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const { toast } = useToast();
  
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [scanInterval, setScanInterval] = useState<NodeJS.Timeout | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [arbitrageMode, setArbitrageMode] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);

  // ... [keep existing useEffect for settings] ...

  // Optimized sorted opportunities with pagination
  const paginatedOpportunities = useMemo(() => {
    const filtered = opportunities
      .filter(opp => new Date(opp.expires_at) > new Date())
      .sort((a, b) => Math.abs(b.profit_percent) - Math.abs(a.profit_percent));
    
    setTotalPages(Math.ceil(filtered.length / OPPORTUNITIES_PER_PAGE));
    
    const start = (currentPage - 1) * OPPORTUNITIES_PER_PAGE;
    const end = start + OPPORTUNITIES_PER_PAGE;
    
    return filtered.slice(start, end);
  }, [opportunities, currentPage]);

  // Reset to page 1 when opportunities change significantly
  useEffect(() => {
    setCurrentPage(1);
  }, [opportunities.length]);

  // ... [keep existing performScan function] ...

  // ... [keep existing startScanning/stopScanning] ...

  // ... [keep existing real-time updates] ...

  // ... [keep existing loading/subscription checks] ...

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Triangular Arbitrage Scanner
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time monitoring • Showing top {OPPORTUNITIES_PER_PAGE} opportunities per page
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>

              {isScanning ? (
                <Button onClick={() => {}} variant="destructive" size="sm">
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button onClick={() => {}} size="sm" disabled={isInitializing}>
                  <Play className="h-4 w-4 mr-2" />
                  {isInitializing ? 'Starting...' : 'Start'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <div className="flex gap-4">
              <span>Status: <Badge variant={isScanning ? "default" : "secondary"}>
                {isScanning ? "Scanning" : "Stopped"}
              </Badge></span>
              <span>Scans: {scanCount}</span>
              <span>Total: {opportunities.length}</span>
              <span>Showing: {paginatedOpportunities.length}</span>
            </div>
            {lastScanTime && (
              <span>Last update: {lastScanTime.toLocaleTimeString()}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Opportunities with Pagination */}
      <div className="space-y-4">
        {paginatedOpportunities.length === 0 && isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="animate-pulse">
                <p>Scanning for high-quality arbitrage opportunities...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {paginatedOpportunities.length === 0 && !isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                No opportunities found. Click "Start" to begin scanning.
              </p>
            </CardContent>
          </Card>
        )}

        {paginatedOpportunities.map((opportunity, index) => (
          <ArbitrageOpportunityCard 
            key={opportunity.id} 
            opportunity={opportunity}
            rank={(currentPage - 1) * OPPORTUNITIES_PER_PAGE + index + 1}
          />
        ))}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Badge variant="outline">
                    {opportunities.length} total opportunities
                  </Badge>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Log Panel */}
      <ArbitrageLogPanel />

      {/* Settings Modal */}
      {showSettings && (
        <ArbitrageSettings 
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
};
