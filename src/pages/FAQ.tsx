import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What does this platform do?',
    a: 'It scans supported exchanges for arbitrage price differences and, when you enable auto trading, places the trades for you using your own exchange API keys.',
  },
  {
    q: 'Which exchanges are supported?',
    a: 'Binance, Bybit, OKX, Gate.io and MEXC. You choose which of them are active in your trading configuration.',
  },
  {
    q: 'Do you hold my funds?',
    a: 'No. Funds stay in your own exchange accounts. You connect read and trade API keys; withdrawal permissions are never used and withdrawal calls are blocked.',
  },
  {
    q: 'How are my API keys stored?',
    a: 'Keys are encrypted before storage and are only decrypted in memory on the trading server at the moment an order is placed. They are never shown in full again after saving.',
  },
  {
    q: 'What is paper trading?',
    a: 'Paper trading simulates a trade using live prices without sending an order to the exchange. It is the recommended way to test your settings before going live.',
  },
  {
    q: 'Why are no opportunities showing?',
    a: 'Opportunities expire quickly. If the list is empty, your filters may be too strict, or the scanner may not be receiving market data at that moment.',
  },
  {
    q: 'Why was my auto trade skipped?',
    a: 'Each skipped trade lists a reason on the dashboard, for example a strategy that is not selected, an exchange that is disabled, profit below your minimum, or an invalid trade amount.',
  },
  {
    q: 'How do subscriptions and payments work?',
    a: 'Plans are paid in USDT to the address shown on the payment page. Access is activated once an administrator confirms the transaction.',
  },
  {
    q: 'Is there a refund?',
    a: 'Subscription payments are non-refundable once access has been activated. Contact support if a payment was not credited.',
  },
  {
    q: 'Can I use the app on my phone?',
    a: 'Yes. The same account works on the web and in the Android app, including the scanner, auto trading, history and settings.',
  },
];

const FAQ = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Frequently asked questions
        </h1>
        <p className="mt-3 text-muted-foreground">
          Answers about accounts, exchanges, trading and billing.
        </p>

        <Accordion type="single" collapsible className="mt-8">
          {FAQS.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-10 flex gap-4 text-sm">
          <Link to="/pricing" className="text-primary underline underline-offset-4">
            Pricing
          </Link>
          <Link to="/terms" className="text-primary underline underline-offset-4">
            Terms and conditions
          </Link>
        </div>
      </div>
    </div>
  );
};

export default FAQ;
