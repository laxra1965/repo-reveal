import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Brain, TrendingUp, Shield, Settings2, Loader2, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';

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
  hourlyDistribution: Record<string, number>;
  topPaths: Array<{ path: string; count: number; avgProfit: number }>;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(142, 71%, 45%)',
  'hsl(217, 91%, 60%)',
  'hsl(47, 96%, 53%)',
  'hsl(280, 87%, 65%)',
  'hsl(0, 84%, 60%)',
  'hsl(180, 70%, 50%)',
  'hsl(330, 80%, 60%)',
];

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

  // Prepare chart data from summary
  const profitChartData = summary
    ? Object.entries(summary.profitDistribution).map(([range, count]) => ({ range, count }))
    : [];

  const exchangeChartData = summary
    ? Object.entries(summary.exchangeDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    : [];

  const hourlyChartData = summary?.hourlyDistribution
    ? Array.from({ length: 24 }, (_, h) => ({
        hour: `${h.toString().padStart(2, '0')}:00`,
        count: summary.hourlyDistribution[h] || 0,
      }))
    : [];

  const strategyChartData = summary
    ? Object.entries(summary.strategyDistribution).map(([name, value]) => ({ name, value }))
    : [];

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

      {/* Dataset Summary Stats */}
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
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Profit Distribution Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Profit Distribution</CardTitle>
              <CardDescription className="text-xs">Breakdown of opportunity profit ranges</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Exchange Performance Pie Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Exchange Distribution</CardTitle>
              <CardDescription className="text-xs">Opportunities per exchange</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={exchangeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {exchangeChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Hourly Patterns Area Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Hourly Activity Patterns (UTC)</CardTitle>
              <CardDescription className="text-xs">When arbitrage opportunities are most frequently detected</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyChartData}>
                    <defs>
                      <linearGradient id="hourlyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#hourlyGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Strategy Distribution */}
          {strategyChartData.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Strategy Performance</CardTitle>
                <CardDescription className="text-xs">Distribution of arbitrage strategies detected</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strategyChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="value" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top Paths */}
      {summary?.topPaths && summary.topPaths.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Top Trading Paths</CardTitle>
          </CardHeader>
          <CardContent>
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
