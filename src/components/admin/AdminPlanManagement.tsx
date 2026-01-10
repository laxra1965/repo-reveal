import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, DollarSign, Calendar, CheckCircle, XCircle, Trash2 } from 'lucide-react';

interface SubscriptionPlan {
    id: string;
    name: string;
    duration_type: string;
    price: number;
    features: { features: string[] } | null;
    active: boolean;
    created_at: string;
}

interface PlanFormData {
    name: string;
    duration_type: string;
    price: string;
    features: string;
}

export const AdminPlanManagement = () => {
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { toast } = useToast();

    const [formData, setFormData] = useState<PlanFormData>({
        name: '',
        duration_type: 'weekly',
        price: '',
        features: '',
    });

    useEffect(() => {
        fetchPlans();
    }, []);

    const fetchPlans = async () => {
        try {
            const { data, error } = await supabase
                .from('subscription_plans')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            // Map the data to match our SubscriptionPlan interface
            const mappedPlans: SubscriptionPlan[] = (data || []).map((plan) => ({
                ...plan,
                features: plan.features as { features: string[] } | null,
                active: plan.active ?? false,
            }));
            setPlans(mappedPlans);
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to fetch subscription plans",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleOpenDialog = (plan?: SubscriptionPlan) => {
        if (plan) {
            setEditingPlan(plan);
            setFormData({
                name: plan.name,
                duration_type: plan.duration_type,
                price: plan.price.toString(),
                features: plan.features?.features?.join('\n') || '',
            });
        } else {
            setEditingPlan(null);
            setFormData({
                name: '',
                duration_type: 'weekly',
                price: '',
                features: '',
            });
        }
        setIsDialogOpen(true);
    };

    const handleSavePlan = async () => {
        try {
            if (!formData.name || !formData.price) {
                toast({
                    title: "Validation Error",
                    description: "Name and price are required",
                    variant: "destructive",
                });
                return;
            }

            const featuresArray = formData.features
                .split('\n')
                .map(f => f.trim())
                .filter(f => f.length > 0);

            const planData = {
                name: formData.name,
                duration_type: formData.duration_type,
                price: parseFloat(formData.price),
                features: { features: featuresArray },
                active: true,
            };

            setProcessing(editingPlan?.id || 'new');

            if (editingPlan) {
                // Update existing plan
                const { error } = await supabase
                    .from('subscription_plans')
                    .update(planData)
                    .eq('id', editingPlan.id);

                if (error) throw error;

                toast({
                    title: "Success",
                    description: "Plan updated successfully",
                });
            } else {
                // Create new plan
                const { error } = await supabase
                    .from('subscription_plans')
                    .insert(planData);

                if (error) throw error;

                toast({
                    title: "Success",
                    description: "Plan created successfully",
                });
            }

            setIsDialogOpen(false);
            fetchPlans();
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to save plan",
                variant: "destructive",
            });
        } finally {
            setProcessing(null);
        }
    };

    const togglePlanStatus = async (planId: string, currentStatus: boolean) => {
        try {
            setProcessing(planId);

            const { error } = await supabase
                .from('subscription_plans')
                .update({ active: !currentStatus })
                .eq('id', planId);

            if (error) throw error;

            toast({
                title: "Success",
                description: `Plan ${!currentStatus ? 'enabled' : 'disabled'} successfully`,
            });

            fetchPlans();
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to update plan status",
                variant: "destructive",
            });
        } finally {
            setProcessing(null);
        }
    };

    const deletePlan = async (planId: string, planName: string) => {
        if (!confirm(`Are you sure you want to delete "${planName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            setProcessing(planId);

            const { error } = await supabase
                .from('subscription_plans')
                .delete()
                .eq('id', planId);

            if (error) throw error;

            toast({
                title: "Success",
                description: "Plan deleted successfully",
            });

            fetchPlans();
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to delete plan. It may be in use by existing subscriptions.",
                variant: "destructive",
            });
        } finally {
            setProcessing(null);
        }
    };

    if (loading) {
        return (
            <div className="text-center py-8">
                <p className="text-muted-foreground">Loading plans...</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold">Subscription Plans Management</h2>
                    <p className="text-sm text-muted-foreground">Create, edit, and manage subscription plans</p>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={() => handleOpenDialog()}>
                            <Plus className="h-4 w-4 mr-2" />
                            Create New Plan
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[525px]">
                        <DialogHeader>
                            <DialogTitle>{editingPlan ? 'Edit Plan' : 'Create New Plan'}</DialogTitle>
                            <DialogDescription>
                                {editingPlan ? 'Update the plan details below' : 'Enter the details for the new subscription plan'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name">Plan Name</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g., Tier 1: Scanner Only"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="duration_type">Duration Type</Label>
                                <Select
                                    value={formData.duration_type}
                                    onValueChange={(value) => setFormData({ ...formData, duration_type: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="weekly">Weekly</SelectItem>
                                        <SelectItem value="monthly">Monthly</SelectItem>
                                        <SelectItem value="quarterly">Quarterly</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="price">Price (USD)</Label>
                                <Input
                                    id="price"
                                    type="number"
                                    step="0.01"
                                    placeholder="e.g., 19.99"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="features">Features (one per line)</Label>
                                <Textarea
                                    id="features"
                                    rows={6}
                                    placeholder="Real-time arbitrage opportunities&#10;Historical data: 7 days&#10;Basic filters"
                                    value={formData.features}
                                    onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Enter each feature on a new line
                                </p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSavePlan}
                                disabled={processing !== null}
                            >
                                {processing ? 'Saving...' : (editingPlan ? 'Update Plan' : 'Create Plan')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="text-sm text-muted-foreground mb-4">
                <Badge variant="default" className="mr-2">Active</Badge>
                plans are visible to users •
                <Badge variant="secondary" className="ml-2 mr-2">Inactive</Badge>
                plans are hidden from public view
            </div>

            {plans.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center">
                        <p className="text-muted-foreground">No subscription plans found</p>
                        <p className="text-sm text-muted-foreground mt-2">Create your first plan to get started</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {plans.map((plan) => (
                        <Card key={plan.id} className={!plan.active ? 'opacity-60' : ''}>
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <CardTitle className="text-lg">{plan.name}</CardTitle>
                                        <CardDescription className="flex items-center gap-2 mt-1">
                                            <Calendar className="h-4 w-4" />
                                            <span className="capitalize">{plan.duration_type}</span>
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        {plan.active ? (
                                            <Badge className="bg-green-500">
                                                <CheckCircle className="h-3 w-3 mr-1" />
                                                Active
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary">
                                                <XCircle className="h-3 w-3 mr-1" />
                                                Inactive
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="space-y-4">
                                <div className="flex items-baseline gap-1">
                                    <DollarSign className="h-5 w-5 text-primary" />
                                    <span className="text-3xl font-bold text-primary">{plan.price}</span>
                                    <span className="text-muted-foreground text-sm">USD</span>
                                </div>

                                {plan.features?.features && plan.features.features.length > 0 && (
                                    <div>
                                        <p className="text-sm font-medium mb-2">Features:</p>
                                        <ul className="text-sm space-y-1 text-muted-foreground">
                                            {plan.features.features.slice(0, 3).map((feature, idx) => (
                                                <li key={idx} className="flex gap-2">
                                                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                                                    <span className="line-clamp-2">{feature}</span>
                                                </li>
                                            ))}
                                            {plan.features.features.length > 3 && (
                                                <li className="text-xs italic">
                                                    +{plan.features.features.length - 3} more features
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                )}

                                <div className="flex items-center justify-between pt-2 border-t">
                                    <div className="flex items-center gap-2">
                                        <Label htmlFor={`active-${plan.id}`} className="text-sm cursor-pointer">
                                            {plan.active ? 'Enabled' : 'Disabled'}
                                        </Label>
                                        <Switch
                                            id={`active-${plan.id}`}
                                            checked={plan.active}
                                            onCheckedChange={() => togglePlanStatus(plan.id, plan.active)}
                                            disabled={processing === plan.id}
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleOpenDialog(plan)}
                                        disabled={processing === plan.id}
                                    >
                                        <Edit className="h-4 w-4 mr-1" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => deletePlan(plan.id, plan.name)}
                                        disabled={processing === plan.id}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="text-xs text-muted-foreground mt-2">
                                    Created: {new Date(plan.created_at).toLocaleDateString()}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};
