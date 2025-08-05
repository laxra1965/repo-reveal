import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';

interface PlanCardProps {
  id: string;
  name: string;
  price: number;
  duration_type: string;
  features: string[];
  onSelect: (planId: string) => void;
  loading?: boolean;
}

export const PlanCard = ({ id, name, price, duration_type, features, onSelect, loading }: PlanCardProps) => {
  return (
    <Card className="relative h-full transition-all hover:shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl mb-2">{name}</CardTitle>
            <CardDescription className="mb-4">
              Perfect for {duration_type} usage
            </CardDescription>
          </div>
          <Badge variant="secondary" className="capitalize">
            {duration_type}
          </Badge>
        </div>
        <div className="text-3xl font-bold">
          ${price}
          <span className="text-base font-normal text-muted-foreground">
            /{duration_type === 'weekly' ? 'week' : 'month'}
          </span>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {features.map((feature, index) => (
            <div key={index} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-sm">{feature}</span>
            </div>
          ))}
        </div>
        
        <Button 
          onClick={() => onSelect(id)} 
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? 'Processing...' : 'Select Plan'}
        </Button>
      </CardContent>
    </Card>
  );
};