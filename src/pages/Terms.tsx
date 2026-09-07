import { Link } from 'react-router-dom';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-8">
    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
    <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
);

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Terms and conditions
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 7 September 2026</p>

        <Section title="1. Acceptance">
          <p>
            By creating an account or using this platform you agree to these terms. If you do not
            agree, do not use the service.
          </p>
        </Section>

        <Section title="2. What the service provides">
          <p>
            The platform scans supported cryptocurrency exchanges for price differences and can
            place orders on your behalf through exchange API keys that you supply. It is a software
            tool only. It is not investment advice, portfolio management, or a broker service.
          </p>
        </Section>

        <Section title="3. Trading risk">
          <p>
            Cryptocurrency trading carries substantial risk, including total loss of the capital you
            allocate. Prices, liquidity and exchange conditions change within seconds, so an
            opportunity displayed may no longer be executable when an order reaches the exchange.
            Past results do not indicate future results. You trade at your own risk.
          </p>
        </Section>

        <Section title="4. Your account and API keys">
          <p>
            You are responsible for keeping your login credentials secure and for the permissions
            you grant on your exchange API keys. Grant trading permissions only. Never grant
            withdrawal permissions. You are responsible for all activity carried out under your
            account and your keys.
          </p>
        </Section>

        <Section title="5. Subscriptions and payment">
          <p>
            Access is sold as a subscription or a one-time lifetime licence, paid in the
            cryptocurrency and to the address shown at checkout. Access is activated after the
            payment is confirmed. Payments are non-refundable once access has been activated.
            Prices may change for future billing periods.
          </p>
        </Section>

        <Section title="6. Acceptable use">
          <p>
            You may not resell, share or automate access to the service outside your own account,
            attempt to bypass security controls, interfere with other users, or use the service
            where it is prohibited by law or by your exchange's own terms.
          </p>
        </Section>

        <Section title="7. Availability">
          <p>
            The service depends on third-party exchanges, market data feeds and network
            infrastructure. It may be unavailable, delayed or degraded at any time, with or without
            notice, including for maintenance. No uptime is guaranteed.
          </p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, the operator is not liable for trading losses,
            missed opportunities, exchange failures, incorrect market data, downtime, or any
            indirect or consequential loss. Total liability for any claim is limited to the amount
            you paid for the service in the three months before the claim.
          </p>
        </Section>

        <Section title="9. Suspension and termination">
          <p>
            Access may be suspended or terminated for breach of these terms, suspected fraud, or a
            chargeback or reversed payment. You may stop using the service at any time.
          </p>
        </Section>

        <Section title="10. Data">
          <p>
            Account data, trade records and settings are stored to operate the service. Exchange API
            secrets are stored encrypted and are used only to place the trades you authorise.
          </p>
        </Section>

        <Section title="11. Changes to these terms">
          <p>
            These terms may be updated. Continued use after an update means you accept the revised
            terms.
          </p>
        </Section>

        <div className="mt-10 flex gap-4 text-sm">
          <Link to="/faq" className="text-primary underline underline-offset-4">
            FAQs
          </Link>
          <Link to="/pricing" className="text-primary underline underline-offset-4">
            Pricing
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Terms;
