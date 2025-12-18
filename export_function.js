function exportOutcomesCSV() {
  const closedTrades = tradeBook.filter(t => t.exitPrice !== null);
  if (closedTrades.length === 0) {
    alert('No closed trades to export');
    return;
  }

  // Build CSV
  const header = ['Trade ID', 'Symbol', 'Entry Price', 'Exit Price', 'P&L (USDT)', 'P&L (%)', 'Profitable', 'Duration (s)'];
  const rows = closedTrades.map(t => {
    const profit = t.exitPrice - t.entryPrice;
    const profitPercent = (profit / t.entryPrice * 100).toFixed(3);
    const duration = ((t.exitTime - t.timestamp) / 1000).toFixed(1);
    return [
      t.id,
      t.symbol,
      t.entryPrice.toFixed(4),
      t.exitPrice.toFixed(4),
      profit.toFixed(4),
      profitPercent,
      t.profitable ? 'Yes' : 'No',
      duration
    ];
  });

  // Convert to CSV string
  const csvContent = [
    header.join(','),
    ...rows.map(r => r.map(v => `"${v}"`).join(','))
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trade-outcomes-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);

  alert(`Exported ${closedTrades.length} trades to CSV`);
}
