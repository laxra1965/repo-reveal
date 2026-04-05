import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MultiSelect } from '@/components/ui/multi-select';
import { toast } from 'sonner';
import { Filter, Plus, Pencil, Trash2, History, RefreshCw, Power, PowerOff, Zap, ShieldCheck, Settings, Save, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STRATEGY_OPTIONS = [
  { value: 'triangular-arbitrage', label: 'Triangular Arbitrage', description: 'Same-exchange 3-leg cycles (e.g. USDT→BTC→ETH→USDT)' },
  { value: 'cross_exchange', label: 'Cross-Exchange Arbitrage', description: 'Price differences across multiple exchanges' },
  { value: 'triangular_arbitrage', label: 'Triangular Arbitrage (legacy)', description: 'Legacy strategy key — underscore variant' },
];

const EXCHANGE_OPTIONS = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'kucoin', label: 'KuCoin' },
  { value: 'gate', label: 'Gate.io' },
  { value: 'mexc', label: 'MEXC' },
];

const ARB_TYPE_OPTIONS = [
  { value: 'triangular', label: 'Triangular', description: '3-step trades on same exchange' },
  { value: 'cross_exchange', label: 'Cross Exchange', description: 'Buy on one, sell on another' },
  { value: 'short', label: 'Short Signals', description: 'Short-selling opportunities' },
];

interface OpportunityFilter {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  min_profit_percent: number | null;
  max_profit_percent: number | null;
  min_liquidity_score: number | null;
  max_liquidity_score: number | null;
  min_volume_estimate: number | null;
  max_volume_estimate: number | null;
  max_estimated_slippage: number | null;
  allowed_exchanges: string[] | null;
  allowed_symbols: string[] | null;
  excluded_symbols: string[] | null;
  path_length: number | null;
  allowed_strategies: string[] | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

interface AuditEntry {
  id: string;
  filter_id: string | null;
  admin_id: string;
  action: string;
  previous_config: Record<string, unknown> | null;
  new_config: Record<string, unknown> | null;
  timestamp: string;
}

const EMPTY_FILTER: Omit<OpportunityFilter, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'> = {
  name: '',
  description: null,
  is_active: true,
  min_profit_percent: null,
  max_profit_percent: null,
  min_liquidity_score: null,
  max_liquidity_score: null,
  min_volume_estimate: null,
  max_volume_estimate: null,
  max_estimated_slippage: null,
  allowed_exchanges: null,
  allowed_symbols: null,
  excluded_symbols: null,
  path_length: null,
  allowed_strategies: null,
};

export const AdminFilterManager = () => {
  const [filters, setFilters] = useState<OpportunityFilter[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAudit, setShowAudit] = useState(false);
  const [editingFilter, setEditingFilter] = useState<Partial<OpportunityFilter> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchFilters = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('opportunity_filters')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load filters');
      console.error(error);
    } else {
      setFilters((data as unknown as OpportunityFilter[]) || []);
    }
    setLoading(false);
  }, []);

  const fetchAuditLog = useCallback(async () => {
    const { data, error } = await supabase
      .from('filter_audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Failed to load audit log:', error);
    } else {
      setAuditLog((data as unknown as AuditEntry[]) || []);
    }
  }, []);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  const openCreateDialog = (preset?: Partial<OpportunityFilter>) => {
    setEditingFilter({ ...EMPTY_FILTER, ...(preset || {}) });
    setDialogOpen(true);
  };

  const PRESETS = [
    {
      label: 'Default',
      icon: Settings,
      preset: {
        name: 'Default Filter',
        description: 'Balanced filter — standard profit and liquidity thresholds',
        min_profit_percent: 0.3,
        min_liquidity_score: 0.5,
        min_volume_estimate: 1000,
        max_estimated_slippage: 2.0,
      },
    },
    {
      label: 'Conservative',
      icon: ShieldCheck,
      preset: {
        name: 'Conservative',
        description: 'Conservative filter — fewer, safer trades',
        min_profit_percent: 0.5,
        min_liquidity_score: 0.7,
        min_volume_estimate: 5000,
        max_estimated_slippage: 1.0,
      },
    },
    {
      label: 'Aggressive',
      icon: Zap,
      preset: {
        name: 'Aggressive',
        description: 'Aggressive filter — more trades, higher risk',
        min_profit_percent: 0.15,
        min_liquidity_score: 0.3,
        min_volume_estimate: 500,
        max_estimated_slippage: 3.0,
      },
    },
  ];

  const openEditDialog = (filter: OpportunityFilter) => {
    setEditingFilter({ ...filter });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingFilter?.name?.trim()) {
      toast.error('Filter name is required');
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const isUpdate = !!editingFilter.id;

    try {
      if (isUpdate) {
        const { error } = await supabase
          .from('opportunity_filters')
          .update({
            name: editingFilter.name,
            description: editingFilter.description || null,
            is_active: editingFilter.is_active ?? true,
            min_profit_percent: editingFilter.min_profit_percent,
            max_profit_percent: editingFilter.max_profit_percent,
            min_liquidity_score: editingFilter.min_liquidity_score,
            max_liquidity_score: editingFilter.max_liquidity_score,
            min_volume_estimate: editingFilter.min_volume_estimate,
            max_volume_estimate: editingFilter.max_volume_estimate,
            max_estimated_slippage: editingFilter.max_estimated_slippage,
            allowed_exchanges: editingFilter.allowed_exchanges,
            allowed_symbols: editingFilter.allowed_symbols,
            excluded_symbols: editingFilter.excluded_symbols,
            path_length: editingFilter.path_length,
            allowed_strategies: editingFilter.allowed_strategies,
            updated_by: user?.id || null,
          } as Record<string, unknown>)
          .eq('id', editingFilter.id!);

        if (error) throw error;

        // Log audit
        await (supabase.from('filter_audit_log') as any).insert({
          filter_id: editingFilter.id!,
          admin_id: user?.id || '',
          action: 'update',
          new_config: editingFilter as unknown as Record<string, unknown>,
        });

        toast.success('Filter updated');
      } else {
        const { error } = await (supabase
          .from('opportunity_filters') as any)
          .insert({
            name: editingFilter.name,
            description: editingFilter.description || null,
            is_active: editingFilter.is_active ?? true,
            min_profit_percent: editingFilter.min_profit_percent,
            max_profit_percent: editingFilter.max_profit_percent,
            min_liquidity_score: editingFilter.min_liquidity_score,
            max_liquidity_score: editingFilter.max_liquidity_score,
            min_volume_estimate: editingFilter.min_volume_estimate,
            max_volume_estimate: editingFilter.max_volume_estimate,
            max_estimated_slippage: editingFilter.max_estimated_slippage,
            allowed_exchanges: editingFilter.allowed_exchanges,
            allowed_symbols: editingFilter.allowed_symbols,
            excluded_symbols: editingFilter.excluded_symbols,
            path_length: editingFilter.path_length,
            allowed_strategies: editingFilter.allowed_strategies,
            created_by: user?.id || null,
            updated_by: user?.id || null,
          });

        if (error) throw error;
        toast.success('Filter created');
      }

      setDialogOpen(false);
      setEditingFilter(null);
      fetchFilters();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to save: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleFilter = async (filter: OpportunityFilter) => {
    const newState = !filter.is_active;
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('opportunity_filters')
      .update({ is_active: newState, updated_by: user?.id || null } as Record<string, unknown>)
      .eq('id', filter.id);

    if (error) {
      toast.error('Failed to toggle filter');
    } else {
      await (supabase.from('filter_audit_log') as any).insert({
        filter_id: filter.id,
        admin_id: user?.id || '',
        action: newState ? 'enable' : 'disable',
        previous_config: { is_active: filter.is_active },
        new_config: { is_active: newState },
      });

      toast.success(`Filter ${newState ? 'enabled' : 'disabled'}`);
      fetchFilters();
    }
  };

  const deleteFilter = async (filter: OpportunityFilter) => {
    if (!confirm(`Delete filter "${filter.name}"?`)) return;

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('opportunity_filters')
      .delete()
      .eq('id', filter.id);

    if (error) {
      toast.error('Failed to delete filter');
    } else {
      await (supabase.from('filter_audit_log') as any).insert({
        filter_id: null,
        admin_id: user?.id || '',
        action: 'delete',
        previous_config: filter as unknown as Record<string, unknown>,
        new_config: null,
      });

      toast.success('Filter deleted');
      fetchFilters();
    }
  };

  const handleShowAudit = () => {
    setShowAudit(!showAudit);
    if (!showAudit) fetchAuditLog();
  };

  const updateField = (field: string, value: unknown) => {
    setEditingFilter(prev => prev ? { ...prev, [field]: value } : null);
  };

  const parseArrayInput = (val: string): string[] | null => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Opportunity Filter Manager
          </h2>
          <p className="text-xs text-muted-foreground">
            Configure filters applied by the VPS scanner before writing to Supabase
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleShowAudit} className="gap-2">
            <History className="h-3.5 w-3.5" />
            {showAudit ? 'Hide' : 'Audit Log'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchFilters} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => openCreateDialog()} className="gap-2">
                <Plus className="h-3.5 w-3.5" />
                New Filter
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingFilter?.id ? 'Edit Filter' : 'Create Filter'}</DialogTitle>
              </DialogHeader>
              {editingFilter && (
                <div className="space-y-4">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Name *</Label>
                      <Input value={editingFilter.name || ''} onChange={e => updateField('name', e.target.value)} placeholder="e.g. Conservative Filter" />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <Switch checked={editingFilter.is_active ?? true} onCheckedChange={v => updateField('is_active', v)} />
                      <Label>Active</Label>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea value={editingFilter.description || ''} onChange={e => updateField('description', e.target.value)} placeholder="What does this filter do?" rows={2} />
                  </div>

                  {/* Profit Filters */}
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Profit Thresholds (%)</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Min Profit %</Label>
                        <Input type="number" step="0.01" value={editingFilter.min_profit_percent ?? ''} onChange={e => updateField('min_profit_percent', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 0.3" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Max Profit %</Label>
                        <Input type="number" step="0.01" value={editingFilter.max_profit_percent ?? ''} onChange={e => updateField('max_profit_percent', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 50" />
                      </div>
                    </div>
                  </div>

                  {/* Liquidity & Volume */}
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Liquidity & Volume</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Min Liquidity Score</Label>
                        <Input type="number" step="0.1" value={editingFilter.min_liquidity_score ?? ''} onChange={e => updateField('min_liquidity_score', e.target.value ? Number(e.target.value) : null)} placeholder="0-1" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Max Liquidity Score</Label>
                        <Input type="number" step="0.1" value={editingFilter.max_liquidity_score ?? ''} onChange={e => updateField('max_liquidity_score', e.target.value ? Number(e.target.value) : null)} placeholder="0-1" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Min Volume Estimate</Label>
                        <Input type="number" value={editingFilter.min_volume_estimate ?? ''} onChange={e => updateField('min_volume_estimate', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 1000" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Max Volume Estimate</Label>
                        <Input type="number" value={editingFilter.max_volume_estimate ?? ''} onChange={e => updateField('max_volume_estimate', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 100000" />
                      </div>
                    </div>
                  </div>

                  {/* Slippage */}
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Slippage</h4>
                    <div className="space-y-1.5">
                      <Label>Max Estimated Slippage %</Label>
                      <Input type="number" step="0.01" value={editingFilter.max_estimated_slippage ?? ''} onChange={e => updateField('max_estimated_slippage', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 0.5" />
                    </div>
                  </div>

                  {/* Array Fields */}
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Exchange & Symbol Filters</h4>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Allowed Exchanges (comma-separated)</Label>
                        <Input value={editingFilter.allowed_exchanges?.join(', ') || ''} onChange={e => updateField('allowed_exchanges', parseArrayInput(e.target.value))} placeholder="binance, bybit, okx" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Allowed Symbols (comma-separated)</Label>
                        <Input value={editingFilter.allowed_symbols?.join(', ') || ''} onChange={e => updateField('allowed_symbols', parseArrayInput(e.target.value))} placeholder="BTC, ETH, SOL" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Excluded Symbols (comma-separated)</Label>
                        <Input value={editingFilter.excluded_symbols?.join(', ') || ''} onChange={e => updateField('excluded_symbols', parseArrayInput(e.target.value))} placeholder="DOGE, SHIB" />
                      </div>
                      <div className="space-y-1.5">
                      <Label>Allowed Strategies</Label>
                      <div className="grid grid-cols-1 gap-2 mt-1">
                        {STRATEGY_OPTIONS.map(opt => {
                          const selected = editingFilter.allowed_strategies || [];
                          const isChecked = selected.includes(opt.value);
                          return (
                            <label key={opt.value} className="flex items-start gap-2 p-2 rounded-md border cursor-pointer hover:bg-accent/50 transition-colors">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const current = editingFilter.allowed_strategies || [];
                                  const next = checked
                                    ? [...current, opt.value]
                                    : current.filter(s => s !== opt.value);
                                  updateField('allowed_strategies', next.length > 0 ? next : null);
                                }}
                                className="mt-0.5"
                              />
                              <div>
                                <span className="text-sm font-medium">{opt.label}</span>
                                <p className="text-xs text-muted-foreground">{opt.description}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Leave all unchecked to allow any strategy</p>
                      </div>
                    </div>
                  </div>

                  {/* Path Length */}
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Path</h4>
                    <div className="space-y-1.5">
                      <Label>Path Length (legs)</Label>
                      <Input type="number" value={editingFilter.path_length ?? ''} onChange={e => updateField('path_length', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 4" />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : editingFilter.id ? 'Update' : 'Create'}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Preset Templates */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Quick Create:</span>
        {PRESETS.map(({ label, icon: Icon, preset }) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => openCreateDialog(preset)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Filter Cards */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading filters...</div>
      ) : filters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Filter className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No filters configured yet</p>
            <p className="text-xs text-muted-foreground mt-1">Create a filter to control which opportunities the VPS scanner writes to Supabase</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filters.map(filter => (
            <Card key={filter.id} className={cn('transition-opacity', !filter.is_active && 'opacity-60')}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    {filter.name}
                    <Badge variant={filter.is_active ? 'default' : 'secondary'} className="text-[10px]">
                      {filter.is_active ? 'Active' : 'Disabled'}
                    </Badge>
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleFilter(filter)} title={filter.is_active ? 'Disable' : 'Enable'}>
                      {filter.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(filter)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteFilter(filter)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {filter.description && <p className="text-xs text-muted-foreground">{filter.description}</p>}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {filter.min_profit_percent != null && <div>Min Profit: <span className="font-mono">{filter.min_profit_percent}%</span></div>}
                  {filter.max_profit_percent != null && <div>Max Profit: <span className="font-mono">{filter.max_profit_percent}%</span></div>}
                  {filter.max_estimated_slippage != null && <div>Max Slippage: <span className="font-mono">{filter.max_estimated_slippage}%</span></div>}
                  {filter.min_liquidity_score != null && <div>Min Liquidity: <span className="font-mono">{filter.min_liquidity_score}</span></div>}
                  {filter.min_volume_estimate != null && <div>Min Volume: <span className="font-mono">${filter.min_volume_estimate}</span></div>}
                  {filter.path_length != null && <div>Path Length: <span className="font-mono">{filter.path_length}</span></div>}
                  {filter.allowed_exchanges?.length && <div className="col-span-2">Exchanges: {filter.allowed_exchanges.map(e => <Badge key={e} variant="outline" className="text-[10px] mr-1">{e}</Badge>)}</div>}
                  {filter.allowed_symbols?.length && <div className="col-span-2">Symbols: {filter.allowed_symbols.map(s => <Badge key={s} variant="outline" className="text-[10px] mr-1">{s}</Badge>)}</div>}
                  {filter.excluded_symbols?.length && <div className="col-span-2">Excluded: {filter.excluded_symbols.map(s => <Badge key={s} variant="destructive" className="text-[10px] mr-1">{s}</Badge>)}</div>}
                  {filter.allowed_strategies?.length && <div className="col-span-2">Strategies: {filter.allowed_strategies.map(s => <Badge key={s} variant="outline" className="text-[10px] mr-1">{s}</Badge>)}</div>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Updated: {new Date(filter.updated_at).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Audit Log */}
      {showAudit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Filter Audit Log</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLog.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No audit entries</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {auditLog.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between text-xs border-b pb-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.action === 'delete' ? 'destructive' : entry.action === 'create' ? 'default' : 'secondary'} className="text-[10px]">
                        {entry.action}
                      </Badge>
                      <span className="text-muted-foreground font-mono truncate max-w-[180px]">
                        {entry.filter_id?.slice(0, 8) || 'deleted'}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
