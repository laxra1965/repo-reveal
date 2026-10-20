export type RecordValue = Record<string, unknown>;
export const asRecord = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === 'string' ? value : null;
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

export function parseTradeLegs(value: unknown) {
  const details = asRecord(value);
  const entries = Array.isArray(details.log) ? details.log : [];
  return entries.map((entry, index) => {
    const row = asRecord(entry);
    return {
      step: numeric(row.step) ?? index + 1,
      exchange: text(row.exchange) ?? text(details[`exchange${index + 1}`]),
      pair: text(row.symbol),
      side: text(row.side) ?? text(row.action),
      from: text(row.fromAsset), to: text(row.toAsset),
      amountIn: numeric(row.amountIn),
      filled: numeric(row.fillAmount) ?? numeric(row.filledQty) ?? numeric(row.executedQty),
      price: numeric(row.fillPrice) ?? numeric(row.price),
      fee: numeric(row.fee), feeAsset: text(row.feeAsset) ?? text(row.commissionAsset),
      orderId: text(row.orderId),
      time: text(row.at) ?? text(row.timestamp),
      failed: row.success === false || Boolean(row.error),
      error: text(row.error),
      simulated: row.isPaperTrade === true || details.is_paper_trade === true || details.mode === 'dry_run' || text(row.orderId)?.startsWith('PAPER_') === true,
    };
  });
}