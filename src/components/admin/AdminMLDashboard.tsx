import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, TrendingUp, Shield, Settings2, Loader2, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type AnalysisType = 'comprehensive' | 'pattern' | 'risk' | 'optimization';

interface DatasetSummary {
  totalOpportunities: number;
  totalTrades: number;
  completedTrades: number;
  failedTrades: number;
  successRate: string;
  avgProfit: string;
  avgSlippage: string;
  strategyDistribution: Record<string, number>;
  profitDistribution: Record<string, number>;
  exchangeDistribution: Record<string, number>;
  topPaths: Array<{ path: string; count: number; avgProfit: number }>;
}

export const AdminMLDashboard = () => {
  const [analysisType, setAnalysisType] = useState<AnalysisType>('comprehensive');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ml-analysis', {
        body: { analysisType },
      });

      if (error) throw error;

      setAnalysis(data.analysis);
      setSummary(data.datasetSummary);
      setLastRun(new Date());
      toast.success('ML analysis complete');
    } catch (err: any) {
      console.error('ML analysis error:', err);
      toast.error(err.message || 'Failed to run analysis');
    } finally {
      setLoading(false);
    }
  };

  const analysisOptions = [
    { value: 'comprehensive', label: 'Comprehensive', icon: Brain, desc: 'Full dataset overview' },
    { value: 'pattern', label: 'Pattern Detection', icon: TrendingUp, desc: 'Find trading patterns' },
    { value: 'risk', label: 'Risk Assessment', icon: Shield, desc: 'Evaluate risk factors' },
    { value: 'optimization', label: 'Optimization', icon: Settings2, desc: 'Strategy recommendations' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            ML Trading Analysis
          </h2>
          <p className="text-xs text-muted-foreground">
            AI-powered analysis of your arbitrage trading dataset
            {lastRun && ` · Last run: ${lastRun.toLocaleTimeString()}`}
          </p>
        </div>
      </div>

      {/* Analysis Type Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Analysis Configuration</CardTitle>
          <CardDescription>Select the type of ML analysis to run on your trading data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {analysisOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = analysisType === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setAnalysisType(opt.value as AnalysisType)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <Icon className={`h-4 w-4 mb-1 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </button>
              );
            })}
          </div>
          <Button onClick={runAnalysis} disabled={loading} className="w-full gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing Dataset...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4" />
                Run {analysisOptions.find(o => o.value === analysisType)?.label} Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Dataset Summary */}
      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Dataset Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{summary.totalOpportunities}</p>
                <p className="text-xs text-muted-foreground">Opportunities</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{summary.totalTrades}</p>
                <p className="text-xs text-muted-foreground">Total Trades</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold text-green-500">{summary.successRate}</p>
                <p className="text-xs text-muted-foreground">Success Rate</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{summary.avgProfit}%</p>
                <p className="text-xs text-muted-foreground">Avg Profit</p>
              </div>
            </div>

            {/* Strategy & Exchange Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium mb-2">Strategy Distribution</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(summary.strategyDistribution).map(([strategy, count]) => (
                    <Badge key={strategy} variant="secondary" className="text-xs">
                      {strategy}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium mb-2">Exchange Distribution</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(summary.exchangeDistribution).map(([exchange, count]) => (
                    <Badge key={exchange} variant="outline" className="text-xs">
                      {exchange}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Top Paths */}
            {summary.topPaths && summary.topPaths.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium mb-2">Top Trading Paths</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {summary.topPaths.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex justify-between items-center text-xs p-2 bg-muted/30 rounded">
                      <span className="font-mono truncate max-w-[60%]">{p.path}</span>
                      <span className="text-muted-foreground">
                        {p.count}x · avg {p.avgProfit.toFixed(3)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Analysis Results */}
      {analysis && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              AI Analysis Results
              <Badge variant="secondary" className="text-xs">
                {analysisOptions.find(o => o.value === analysisType)?.label}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {analysis}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
