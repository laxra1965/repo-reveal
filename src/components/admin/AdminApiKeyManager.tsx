import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ExchangeCredential {
  id: string;
  exchange: string;
  api_key: string;
  is_connected: boolean;
  test_mode: boolean;
  updated_at: string;
}

const SUPPORTED_EXCHANGES = [
  { id: 'binance', name: 'Binance', link: 'https://www.binance.com/en/my/settings/api-management' },
  { id: 'bybit', name: 'Bybit', link: 'https://www.bybit.com/app/user/api-management' },
  { id: 'okx', name: 'OKX', link: 'https://www.okx.com/account/my-api' },
  { id: 'gate', name: 'Gate.io', link: 'https://www.gate.io/myaccount/api_keys' },
  { id: 'kucoin', name: 'KuCoin', link: 'https://www.kucoin.com/account/api' },
  { id: 'mexc', name: 'MEXC', link: 'https://www.mexc.com/user/api' },
];

export const AdminApiKeyManager = () => {
  const [credentials, setCredentials] = useState<ExchangeCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newCred, setNewCred] = useState({
    exchange: 'binance',
    apiKey: '',
    apiSecret: '',
    apiPassphrase: '',
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    setRefreshing(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setRefreshing(false);
      return;
    }

    const { data, error: fetchErr } = await supabase
      .from('exchange_credentials')
      .select('id, exchange, api_key, is_connected, test_mode, updated_at')
      .eq('user_id', user.id);

    if (!fetchErr && data) {
      setCredentials(data as unknown as ExchangeCredential[]);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchCredentials().then(() => setLoading(false));
  }, [fetchCredentials]);

  const handleAddCredential = async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    if (!newCred.apiKey || !newCred.apiSecret) {
      setError('API Key and Secret are required');
      return;
    }

    try {
      setRefreshing(true);

      const { data: encResult, error: encError } = await supabase.functions.invoke(
        'encrypt-api-keys',
        {
          body: {
            action: 'encrypt',
            apiKey: newCred.apiKey,
            apiSecret: newCred.apiSecret,
            apiPassphrase: newCred.apiPassphrase,
          },
        },
      );

      if (encError || !encResult?.success) {
        throw new Error(encError?.message || encResult?.error || 'Encryption failed');
      }

      const { error: dbError } = await supabase.from('exchange_credentials').insert({
        user_id: user.id,
        exchange: newCred.exchange as never,
        api_key: newCred.apiKey.substring(0, 8) + '...',
        api_secret: '********',
        encrypted_api_key: encResult.encryptedKey,
        encrypted_api_secret: encResult.encryptedSecret,
        encrypted_api_passphrase: encResult.encryptedPassphrase,
        encryption_version: encResult.version,
        is_connected: true,
        test_mode: true,
      });

      if (dbError) throw dbError;

      toast.success(`Added ${newCred.exchange} credentials`);
      setIsAdding(false);
      setNewCred({ exchange: 'binance', apiKey: '', apiSecret: '', apiPassphrase: '' });
      await fetchCredentials();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add credential';
      setError(msg);
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    if (!confirm('Delete these credentials? Active trades on this exchange will stop.')) return;

    const { error: delErr } = await supabase.from('exchange_credentials').delete().eq('id', id);

    if (!delErr) {
      setCredentials((prev) => prev.filter((c) => c.id !== id));
      toast.success('Credentials deleted');
    } else {
      toast.error('Failed to delete credentials');
    }
  };

  if (loading) return <div className="p-6 text-center text-sm text-muted-foreground">Loading API keys...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            Exchange API Keys
          </h3>
          <p className="text-xs text-muted-foreground">
            Securely store admin exchange credentials for automated trading.
          </p>
        </div>
        <Button
          size="sm"
          variant={isAdding ? 'outline' : 'default'}
          onClick={() => setIsAdding(!isAdding)}
        >
          {isAdding ? 'Cancel' : (
            <>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Key
            </>
          )}
        </Button>
      </div>

      {isAdding && (
        <Card className="border-primary/30">
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Exchange</Label>
                <select
                  value={newCred.exchange}
                  onChange={(e) => setNewCred((p) => ({ ...p, exchange: e.target.value }))}
                  className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SUPPORTED_EXCHANGES.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">API Key</Label>
                <Input
                  value={newCred.apiKey}
                  onChange={(e) => setNewCred((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder="Paste your API key"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">API Secret</Label>
                <Input
                  type="password"
                  value={newCred.apiSecret}
                  onChange={(e) => setNewCred((p) => ({ ...p, apiSecret: e.target.value }))}
                  placeholder="Paste your API secret"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Passphrase (optional)</Label>
                <Input
                  type="password"
                  value={newCred.apiPassphrase}
                  onChange={(e) => setNewCred((p) => ({ ...p, apiPassphrase: e.target.value }))}
                  placeholder="For KuCoin/OKX"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/40 rounded-md flex items-center gap-2 text-destructive text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={handleAddCredential} disabled={refreshing}>
                {refreshing ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                Encrypt &amp; Save Key
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {credentials.length === 0 && !isAdding ? (
          <div className="md:col-span-2 p-10 text-center border border-dashed rounded-lg">
            <Key className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No exchange API keys found.</p>
            <p className="text-muted-foreground text-xs mt-1">
              Add a key to enable automated trading on supported exchanges.
            </p>
          </div>
        ) : (
          credentials.map((cred) => {
            const meta = SUPPORTED_EXCHANGES.find((ex) => ex.id === cred.exchange.toLowerCase());
            return (
              <Card key={cred.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="pt-6">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-bold uppercase tracking-wider text-sm">{cred.exchange}</h4>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                          {cred.api_key}
                        </Badge>
                        {cred.test_mode && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                            PAPER ONLY
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteCredential(cred.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full',
                          cred.is_connected ? 'bg-green-500' : 'bg-destructive',
                        )}
                      />
                      <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">
                        {cred.is_connected ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Connected
                          </span>
                        ) : (
                          'Error'
                        )}
                      </span>
                    </div>
                    {meta && (
                      <a
                        href={meta.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                      >
                        Manage on Exchange <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminApiKeyManager;
