  private balances: Record<string, number> = {
    USDT: 10_000
  };

  get(asset: string) {
    return this.balances[asset] ?? 0;
  }

  debit(asset: string, amount: number) {
    if (this.get(asset) < amount) {
      throw new Error(`Insufficient ${asset}`);
    }
    this.balances[asset] -= amount;
  }

  credit(asset: string, amount: number) {
    this.balances[asset] = this.get(asset) + amount;
  }

  snapshot() {
    return { ...this.balances };
  }
}

