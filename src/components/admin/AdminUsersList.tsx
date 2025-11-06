import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Users, Link2, CreditCard } from 'lucide-react';

interface UserProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  subscription?: {
    plan_name: string;
    status: string;
    end_date: string;
  } | null;
  exchanges: string[];
}

export const AdminUsersList = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, display_name')
        .order('email');

      if (profilesError) throw profilesError;

      // Fetch subscriptions with plan details
      const { data: subscriptions, error: subsError } = await supabase
        .from('user_subscriptions')
        .select(`
          user_id,
          status,
          end_date,
          subscription_plans (
            name
          )
        `);

      if (subsError) throw subsError;

      // Fetch exchange credentials
      const { data: credentials, error: credError } = await supabase
        .from('exchange_credentials')
        .select('user_id, exchange, is_connected')
        .eq('is_connected', true);

      if (credError) throw credError;

      // Combine data
      const usersData: UserProfile[] = profiles?.map(profile => {
        const userSubs = subscriptions?.filter(sub => sub.user_id === profile.user_id);
        const activeSub = userSubs?.find(sub => 
          sub.status === 'active' && new Date(sub.end_date) > new Date()
        );

        const userExchanges = credentials
          ?.filter(cred => cred.user_id === profile.user_id)
          .map(cred => cred.exchange) || [];

        return {
          user_id: profile.user_id,
          email: profile.email,
          display_name: profile.display_name,
          subscription: activeSub ? {
            plan_name: (activeSub.subscription_plans as any)?.name || 'Unknown',
            status: activeSub.status,
            end_date: activeSub.end_date
          } : null,
          exchanges: userExchanges
        };
      }) || [];

      setUsers(usersData);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      toast({
        title: "Error",
        description: "Failed to load users list",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Loading users...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          All Users ({users.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No users found</p>
          ) : (
            users.map((user) => (
              <div key={user.user_id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold">{user.email}</h3>
                    {user.display_name && (
                      <p className="text-sm text-muted-foreground">{user.display_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      ID: {user.user_id.substring(0, 8)}...
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  {/* Subscription Status */}
                  <div className="flex items-center gap-1">
                    <CreditCard className="h-3 w-3 text-muted-foreground" />
                    {user.subscription ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="default">
                          {user.subscription.plan_name}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Until {new Date(user.subscription.end_date).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <Badge variant="secondary">No Active Plan</Badge>
                    )}
                  </div>

                  {/* Linked Exchanges */}
                  {user.exchanges.length > 0 && (
                    <div className="flex items-center gap-1 ml-2">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                      <div className="flex gap-1">
                        {user.exchanges.map((exchange) => (
                          <Badge key={exchange} variant="outline" className="text-xs capitalize">
                            {exchange}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {user.exchanges.length === 0 && (
                    <div className="flex items-center gap-1 ml-2">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs">
                        No Exchanges
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};
