import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, DollarSign, Activity, BarChart3, ChevronDown, ChevronUp, Percent, TrendingDown } from "lucide-react";

// Mock data for demonstration
const mockStats = {
  totalOpportunities: 145,
  successRate: 78.5,
  avgProfit: 0.0234,
  maxProfit: 1.2456,
  totalVolume: 12543.67
};

export default function CollapsibleStatsDashboard() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [stats, setStats] = useState(mockStats);

  return (
    <div className="space-y-4">
      {/* Compact View - Always Visible */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Opportunities</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOpportunities}</div>
            <p className="text-xs text-muted-foreground">
              Detected arbitrage opportunities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.successRate.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">
              Profitable opportunities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgProfit.toFixed(4)}%</div>
            <p className="text-xs text-muted-foreground">
              Per opportunity
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Max Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.maxProfit.toFixed(4)}%</div>
            <p className="text-xs text-muted-foreground">
              Highest detected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalVolume.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Scanned trading volume
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Toggle Button */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="gap-2"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Hide Detailed Statistics
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Show Detailed Statistics
            </>
          )}
        </Button>
      </div>

      {/* Expanded View - Detailed Statistics */}
      {isExpanded && (
        <div className="space-y-4 animate-in slide-in-from-top-4">
          {/* Quality Metrics */}
          <Card>
            <CardHeader>
              <CardTitle>Quality Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Premium Opportunities</p>
                  <p className="text-2xl font-bold text-purple-500">23</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">High Quality</p>
                  <p className="text-2xl font-bold text-blue-500">45</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Average Quality Score</p>
                  <p className="text-2xl font-bold">67</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Exchange Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Statistics by Exchange</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {['Binance', 'Bybit', 'OKX'].map((exchange) => (
                  <div key={exchange} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{exchange}</span>
                        <span className="text-xs text-muted-foreground">
                          45 opportunities
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        82.3% success
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Avg Profit</p>
                        <p className="font-medium">0.0234%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Volume</p>
                        <p className="font-medium">$4,234.56</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Opportunities</p>
                        <p className="font-medium">45</p>
                      </div>
                    </div>
                    
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all" 
                        style={{ width: '82%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
