import { READ_ONLY } from "../../../../shared/dist/runtime";

export class PaperExecutor {
  constructor(private wallet: PaperWallet) {}

  buy(base: string, quote: string, price: number, qty: number) {
    if (!READ_ONLY) throw new Error("Live trading disabled");

    const cost = price * qty;
    this.wallet.debit(quote, cost);
    this.wallet.credit(base, qty);
  }

  sell(base: string, quote: string, price: number, qty: number) {
    if (!READ_ONLY) throw new Error("Live trading disabled");

    this.wallet.debit(base, qty);
    this.wallet.credit(quote, price * qty);
  }
}

