import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { 
  Key, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ShieldCheck, 
  AlertCircle,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { cn } from '../lib/utils';

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

export const ApiKeyManager = () => {
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
  const [success, setSuccess] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    setRefreshing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('exchange_credentials')
      .select('id, exchange, api_key, is_connected, test_mode, updated_at')
      .eq('user_id', user.id);

    if (!error && data) {
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
    setSuccess(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (!newCred.apiKey || !newCred.apiSecret) {
      setError('API Key and Secret are required');
      return;
    }

    try {
      setRefreshing(true);
      
      // 1. Call encryption function
      const { data: encResult, error: encError } = await supabase.functions.invoke('encrypt-api-keys', {
        body: {
          action: 'encrypt',
          apiKey: newCred.apiKey,
          apiSecret: newCred.apiSecret,
          apiPassphrase: newCred.apiPassphrase
        }
      });

      if (encError || !encResult?.success) {
        throw new Error(encError?.message || encResult?.error || 'Encryption failed');
      }

      // 2. Save to database
      const { error: dbError } = await supabase
        .from('exchange_credentials')
        .insert({
          user_id: user.id,
          exchange: newCred.exchange as any,
          api_key: newCred.apiKey.substring(0, 8) + '...', // Masked key for display
          api_secret: '********', // Masked secret for display
          encrypted_api_key: encResult.encryptedKey,
          encrypted_api_secret: encResult.encryptedSecret,
          encrypted_api_passphrase: encResult.encryptedPassphrase,
          encryption_version: encResult.version,
          is_connected: true,
          test_mode: true // Default to test mode for safety
        });

      if (dbError) throw dbError;

      setSuccess(`Successfully added ${newCred.exchange} credentials!`);
      setIsAdding(false);
      setNewCred({ exchange: 'binance', apiKey: '', apiSecret: '', apiPassphrase: '' });
      await fetchCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credential');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    if (!confirm('Are you sure you want to delete these credentials? This will stop all active trades for this exchange.')) return;
    
    const { error } = await supabase
      .from('exchange_credentials')
      .delete()
      .eq('id', id);

    if (!error) {
      setCredentials(prev => prev.filter(c => c.id !== id));
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading API keys...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Key className="w-5 h-5 text-blue-400" />
            Exchange API Keys
          </h3>
          <p className="text-xs text-slate-400">Securely store your exchange credentials for automated trading.</p>
        </div>
        <Button 
          size="sm" 
          onClick={() => setIsAdding(!isAdding)}
          className={cn(isAdding ? "bg-slate-700" : "bg-blue-600 hover:bg-blue-700")}
        >
          {isAdding ? 'Cancel' : <><Plus className="w-4 h-4 mr-2" /> Add Key</>}
        </Button>
      </div>

      {isAdding && (
        <Card className="bg-slate-900/50 border-blue-500/30 border animate-in slide-in-from-top-2 duration-300">
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">EXCHANGE</Label>
                <select 
                  value={newCred.exchange}
                  onChange={(e) => setNewCred(prev => ({ ...prev, exchange: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {SUPPORTED_EXCHANGES.map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">API KEY</Label>
                <Input 
                  value={newCred.apiKey}
                  onChange={(e) => setNewCred(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Paste your API key"
                  className="bg-slate-950 border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">API SECRET</Label>
                <Input 
                  type="password"
                  value={newCred.apiSecret}
                  onChange={(e) => setNewCred(prev => ({ ...prev, apiSecret: e.target.value }))}
                  placeholder="Paste your API secret"
                  className="bg-slate-950 border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">PASSPHRASE (OPTIONAL)</Label>
                <Input 
                  type="password"
                  value={newCred.apiPassphrase}
                  onChange={(e) => setNewCred(prev => ({ ...prev, apiPassphrase: e.target.value }))}
                  placeholder="For KuCoin/OKX"
                  className="bg-slate-950 border-slate-700"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-md flex items-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button 
                onClick={handleAddCredential} 
                disabled={refreshing}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {refreshing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Encrypt & Save Key
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {success && (
        <div className="p-3 bg-green-900/20 border border-green-700/50 rounded-md flex items-center gap-2 text-green-400 text-xs animate-in fade-in duration-500">
          <CheckCircle2 className="w-4 h-4" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {credentials.length === 0 && !isAdding ? (
          <div className="md:col-span-2 p-12 text-center border border-dashed border-slate-700 rounded-lg bg-slate-900/30">
            <Key className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No exchange API keys found.</p>
            <p className="text-slate-600 text-xs mt-1">Add a key to enable automated trading on supported exchanges.</p>
          </div>
        ) : (
          credentials.map((cred) => (
            <Card key={cred.id} className="bg-slate-800 border-slate-700 hover:border-slate-600 transition-colors">
              <CardContent className="pt-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-700">
                      <img 
                        src={`https://cryptologos.cc/logos/${cred.exchange}-${cred.exchange === 'binance' ? 'bnb' : cred.exchange}-logo.svg?v=025`} 
                        className="w-6 h-6 grayscale opacity-70"
                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://cryptologos.cc/logos/generic-logo.svg'; }}
                        alt={cred.exchange}
                      />
                    </div>
                    <div>
                      <h4 className="font-bold uppercase tracking-wider text-sm">{cred.exchange}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-slate-700 text-slate-400 font-mono">
                          {cred.api_key}
                        </Badge>
                        {cred.test_mode && (
                          <Badge className="bg-amber-900/40 text-amber-500 border-amber-700/50 text-[10px] py-0 px-1.5">
                            PAPER ONLY
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleDeleteCredential(cred.id)}
                    className="text-slate-500 hover:text-red-400 hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700/50">
                  <div className="flex items-center gap-1.5">
                    <div className={cn("w-2 h-2 rounded-full", cred.is_connected ? "bg-green-500" : "bg-red-500")} />
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                      {cred.is_connected ? 'Connected' : 'Error'}
                    </span>
                  </div>
                  <a 
                    href={SUPPORTED_EXCHANGES.find(ex => ex.id === cred.exchange.toLowerCase())?.link || '#'} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    Manage on Exchange <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
