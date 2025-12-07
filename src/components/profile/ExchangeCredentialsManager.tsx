import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Eye, EyeOff, Plus, Trash2, CheckCircle, XCircle, TestTube, Loader2, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ExchangeName = 'binance' | 'bybit' | 'okx' | 'gate' | 'mexc' | 'bitget' | 'htx' | 'kucoin' | 'bitfinex' | 'bingx' | 'coinbase' | 'upbit' | 'cryptocom' | 'kraken';

interface ExchangeCredential {
  id: string;
  exchange: ExchangeName;
  api_key: string;
  api_secret: string;
  is_connected: boolean | null;
  test_mode: boolean | null;
  created_at: string | null;
  encrypted_api_key?: string | null;
  encrypted_api_secret?: string | null;
}

const SUPPORTED_EXCHANGES: { value: ExchangeName; label: string; logo: string }[] = [
  { value: 'binance', label: 'Binance', logo: '🟡' },
  { value: 'bybit', label: 'Bybit', logo: '🟠' },
  { value: 'okx', label: 'OKX', logo: '⚫' },
  { value: 'gate', label: 'Gate.io', logo: '🔵' },
  { value: 'mexc', label: 'MEXC', logo: '🟢' },
];

export function ExchangeCredentialsManager() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<ExchangeCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCredential, setNewCredential] = useState({
    exchange: '' as ExchangeName | '',
    api_key: '',
    api_secret: '',
    test_mode: true,
  });
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('exchange_credentials')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCredentials(data || []);
    } catch (error) {
      console.error('Error fetching credentials:', error);
      toast.error('Failed to load exchange credentials');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const handleAddCredential = async () => {
    if (!newCredential.exchange || !newCredential.api_key || !newCredential.api_secret) {
      toast.error('Please fill in all fields');
      return;
    }

    setSaving(true);
    try {
      // Step 1: Encrypt credentials via Edge Function
      console.log('Encrypting API credentials...');
      const { data: encryptedData, error: encryptError } = await supabase.functions.invoke('encrypt-api-keys', {
        body: {
          action: 'encrypt',
          apiKey: newCredential.api_key,
          apiSecret: newCredential.api_secret
        }
      });

      if (encryptError) {
        console.error('Encryption error:', encryptError);
        throw new Error('Failed to encrypt credentials: ' + (encryptError.message || 'Unknown error'));
      }

      if (!encryptedData || !encryptedData.encryptedKey || !encryptedData.encryptedSecret) {
        throw new Error('Encryption failed: Invalid response from encryption service');
      }

      console.log('Credentials encrypted successfully');

      // Step 2: Save encrypted credentials (clear plaintext fields)
      const { error } = await supabase.from('exchange_credentials').insert({
        user_id: user?.id,
        exchange: newCredential.exchange,
        api_key: '',  // Clear plaintext for security
        api_secret: '',  // Clear plaintext for security
        encrypted_api_key: encryptedData.encryptedKey,
        encrypted_api_secret: encryptedData.encryptedSecret,
        encryption_version: 1,
        migration_status: 'completed',
        test_mode: newCredential.test_mode,
        is_connected: false,  // Will be set to true after validation
      });

      if (error) throw error;

      toast.success(`${newCredential.exchange.toUpperCase()} API keys added and encrypted successfully`);
      setDialogOpen(false);
      setNewCredential({ exchange: '', api_key: '', api_secret: '', test_mode: true });
      fetchCredentials();
    } catch (error: any) {
      console.error('Error adding credential:', error);
      toast.error(error.message || 'Failed to add credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCredential = async (id: string, exchange: string) => {
    if (!confirm(`Are you sure you want to delete ${exchange.toUpperCase()} credentials?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('exchange_credentials')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Credentials deleted successfully');
      fetchCredentials();
    } catch (error) {
      console.error('Error deleting credential:', error);
      toast.error('Failed to delete credentials');
    }
  };

  const handleToggleTestMode = async (id: string, currentMode: boolean | null) => {
    try {
      const { error } = await supabase
        .from('exchange_credentials')
        .update({ test_mode: !currentMode })
        .eq('id', id);

      if (error) throw error;

      toast.success(`Switched to ${!currentMode ? 'Paper Trading' : 'Live Trading'} mode`);
      fetchCredentials();
    } catch (error) {
      console.error('Error updating test mode:', error);
      toast.error('Failed to update trading mode');
    }
  };

  const handleTestConnection = async (credential: ExchangeCredential) => {
    setTestingConnection(credential.id);

    try {
      console.log(`Testing connection for ${credential.exchange}...`);

      let apiKey = credential.api_key;
      let apiSecret = credential.api_secret;

      // If credentials are encrypted, decrypt them first
      if (credential.encrypted_api_key && credential.encrypted_api_secret) {
        console.log('Decrypting credentials for validation...');

        const { data: decryptedData, error: decryptError } = await supabase.functions.invoke('encrypt-api-keys', {
          body: {
            action: 'decrypt',
            encryptedKey: credential.encrypted_api_key,
            encryptedSecret: credential.encrypted_api_secret
          }
        });

        if (decryptError || !decryptedData) {
          throw new Error('Failed to decrypt credentials: ' + (decryptError?.message || 'Unknown error'));
        }

        apiKey = decryptedData.apiKey;
        apiSecret = decryptedData.apiSecret;
        console.log('Credentials decrypted successfully');
      }

      const { data, error } = await supabase.functions.invoke('validate-api-keys', {
        body: {
          exchange: credential.exchange,
          apiKey: apiKey,
          apiSecret: apiSecret
        }
      });

      console.log('Validation response:', { data, error });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Edge function invocation failed');
      }

      if (!data) {
        throw new Error('No response from validation service');
      }

      if (data.valid && data.canTrade) {
        toast.success(`${credential.exchange.toUpperCase()} API validated with trading permissions!`);
        // Update connection status
        await supabase
          .from('exchange_credentials')
          .update({ is_connected: true })
          .eq('id', credential.id);
        fetchCredentials();
      } else if (data.valid && !data.canTrade) {
        toast.warning(`${credential.exchange.toUpperCase()} API key is valid but doesn't have trading permissions. Enable "Spot Trading" in your exchange settings.`);
        await supabase
          .from('exchange_credentials')
          .update({ is_connected: false })
          .eq('id', credential.id);
        fetchCredentials();
      } else {
        const errorMsg = data.error || 'Unknown validation error';
        toast.error(`${credential.exchange.toUpperCase()} validation failed: ${errorMsg}`);
        await supabase
          .from('exchange_credentials')
          .update({ is_connected: false })
          .eq('id', credential.id);
        fetchCredentials();
      }
    } catch (error: any) {
      console.error('Connection test error:', error);

      let errorMessage = 'Unknown error';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Check if it's an Edge Function not deployed error
      if (errorMessage.includes('FunctionsRelayError') || errorMessage.includes('not found')) {
        toast.error(`Validation service not available. Please deploy the 'validate-api-keys' Edge Function.`);
      } else {
        toast.error(`Failed to test ${credential.exchange.toUpperCase()} connection: ${errorMessage}`);
      }

      // Mark as disconnected on error
      await supabase
        .from('exchange_credentials')
        .update({ is_connected: false })
        .eq('id', credential.id);
      fetchCredentials();
    } finally {
      setTestingConnection(null);
    }
  };

  const toggleSecretVisibility = (id: string) => {
    setShowSecrets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskSecret = (secret: string) => {
    if (secret.length <= 8) return '••••••••';
    return secret.substring(0, 4) + '••••••••' + secret.substring(secret.length - 4);
  };

  const connectedExchanges = credentials.map(c => c.exchange);
  const availableExchanges = SUPPORTED_EXCHANGES.filter(e => !connectedExchanges.includes(e.value));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Exchange API Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Exchange API Keys</CardTitle>
            <CardDescription>
              Manage your exchange API credentials for automated trading
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={availableExchanges.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                Add Exchange
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Exchange API Keys</DialogTitle>
                <DialogDescription>
                  Enter your API credentials securely. We recommend using read-only keys with trading permissions only.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Exchange</Label>
                  <Select
                    value={newCredential.exchange}
                    onValueChange={(value: ExchangeName) =>
                      setNewCredential(prev => ({ ...prev, exchange: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select exchange" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableExchanges.map(exchange => (
                        <SelectItem key={exchange.value} value={exchange.value}>
                          {exchange.logo} {exchange.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="text"
                    placeholder="Enter your API key"
                    value={newCredential.api_key}
                    onChange={(e) => setNewCredential(prev => ({ ...prev, api_key: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Secret</Label>
                  <Input
                    type="password"
                    placeholder="Enter your API secret"
                    value={newCredential.api_secret}
                    onChange={(e) => setNewCredential(prev => ({ ...prev, api_secret: e.target.value }))}
                  />
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <TestTube className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium">Paper Trading Mode</p>
                      <p className="text-xs text-muted-foreground">
                        Test trades without real money
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={newCredential.test_mode}
                    onCheckedChange={(checked) =>
                      setNewCredential(prev => ({ ...prev, test_mode: checked }))
                    }
                  />
                </div>
                <Button onClick={handleAddCredential} className="w-full" disabled={saving}>
                  {saving ? 'Adding...' : 'Add Credentials'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No exchange credentials configured yet.</p>
            <p className="text-sm mt-1">Add your first exchange to enable automated trading.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {credentials.map((credential) => {
              const exchangeInfo = SUPPORTED_EXCHANGES.find(e => e.value === credential.exchange);
              return (
                <div
                  key={credential.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{exchangeInfo?.logo}</span>
                      <div>
                        <h4 className="font-semibold">{exchangeInfo?.label || credential.exchange}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          {credential.is_connected ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600 border-red-600">
                              <XCircle className="h-3 w-3 mr-1" />
                              Disconnected
                            </Badge>
                          )}
                          {credential.test_mode ? (
                            <Badge variant="secondary">
                              <TestTube className="h-3 w-3 mr-1" />
                              Paper Trading
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              Live Trading
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(credential)}
                        disabled={testingConnection === credential.id}
                      >
                        {testingConnection === credential.id ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 mr-1" />
                        )}
                        {testingConnection === credential.id ? 'Testing...' : 'Test API'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteCredential(credential.id, credential.exchange)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">API Key</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-muted px-2 py-1 rounded flex-1 overflow-hidden">
                          {showSecrets[credential.id]
                            ? credential.api_key
                            : maskSecret(credential.api_key)}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => toggleSecretVisibility(credential.id)}
                        >
                          {showSecrets[credential.id] ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">API Secret</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-muted px-2 py-1 rounded flex-1">
                          ••••••••••••••••
                        </code>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Trading Mode:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {credential.test_mode ? 'Paper' : 'Live'}
                      </span>
                      <Switch
                        checked={credential.test_mode ?? true}
                        onCheckedChange={() => handleToggleTestMode(credential.id, credential.test_mode ?? true)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
