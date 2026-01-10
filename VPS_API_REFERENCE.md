# VPS Edge Functions API Reference

Base URL: `http://localhost:3001` (development) or `http://[vps-ip]:3001` (production)

All endpoints require:
- `Content-Type: application/json`
- `Authorization: Bearer [jwt-token]` (for authenticated endpoints)

---

## Endpoints

### 1. Arbitrage Scanner

**POST** `/functions/arbitrage-scanner`

Scan for arbitrage opportunities across exchanges.

**Request Body:**
```json
{
  "mode": "auto" | "manual",
  "userId": "string (optional, required for service role)",
  "action": "string (optional)"
}
```

**Response:**
```json
{
  "success": boolean,
  "mode": "auto" | "manual",
  "processed": number,
  "opportunities": number,
  "count": number,
  "data": "array of opportunities",
  "duration": number,
  "timestamp": "ISO-8601"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"mode": "manual"}'
```

---

### 2. Execute Trade

**POST** `/functions/execute-trade`

Execute trades on exchange APIs.

**Request Body:**
```json
{
  "opportunities": [
    {
      "id": "string",
      "primary_exchange": "binance | bybit | okx | gate",
      "symbol": "BTC/USDT",
      "amount": 100,
      "profit_percent": 0.5
    }
  ],
  "action": "validate" | "simulate" | "execute",
  "userId": "string (optional)"
}
```

**Response:**
```json
{
  "success": boolean,
  "action": "string",
  "userId": "string",
  "results": [
    {
      "opportunity": "string",
      "exchange": "string",
      "valid": boolean,
      "simulated": boolean,
      "steps": "array",
      "profitEstimate": "number"
    }
  ],
  "errors": "array (optional)",
  "timestamp": "ISO-8601"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/functions/execute-trade \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "opportunities": [],
    "action": "simulate"
  }'
```

---

### 3. Scheduled Arbitrage Scan

**POST/GET** `/functions/scheduled-arb-scan`

Maintenance and cleanup for arbitrage opportunities.

**Request Body:**
```json
{
  "action": "cleanup" | "status",
  "daysOld": 1
}
```

**Response (cleanup):**
```json
{
  "success": boolean,
  "action": "cleanup",
  "deleted": number,
  "duration": number,
  "timestamp": "ISO-8601"
}
```

**Response (status):**
```json
{
  "success": boolean,
  "action": "status",
  "pending": number,
  "completed": number,
  "duration": number,
  "timestamp": "ISO-8601"
}
```

---

### 4. Auto-Trade Scheduler

**POST/GET** `/functions/auto-trade-scheduler`

Manage auto-trading for users with auto_trade enabled.

**Request Body:**
```json
{
  "action": "queue" | "process" | "status"
}
```

**Response:**
```json
{
  "success": boolean,
  "action": "string",
  "queueResult": {
    "users_processed": number,
    "trades_queued": number
  },
  "processResult": {
    "trades_processed": number,
    "successful": number,
    "failed": number
  },
  "duration": number,
  "timestamp": "ISO-8601"
}
```

---

### 5. Binance WebSocket

**POST/GET** `/functions/binance-websocket`

Real-time price streaming from Binance.

**Request Body:**
```json
{
  "action": "connect" | "status",
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```

**Response:**
```json
{
  "success": boolean,
  "status": "connected",
  "connected_symbols": number,
  "last_prices": [
    {
      "symbol": "BTCUSDT",
      "price": 45000,
      "timestamp": "ISO-8601"
    }
  ],
  "timestamp": "ISO-8601"
}
```

---

### 6. Fetch Exchange Balances

**POST/GET** `/functions/fetch-exchange-balances`

Get current balances from user's exchange accounts.

**Request Body:**
```json
{
  "exchange": "binance | bybit | okx | gate (optional)",
  "userId": "string (optional)"
}
```

**Response:**
```json
{
  "success": boolean,
  "userId": "string",
  "balances": [
    {
      "exchange": "binance",
      "totalUSDT": 1000.50,
      "assets": {
        "USDT": 500,
        "BTC": 0.01,
        "ETH": 0.5
      },
      "timestamp": "ISO-8601"
    }
  ],
  "totalUSDT": 2500.50,
  "errors": "array (optional)",
  "timestamp": "ISO-8601"
}
```

---

### 7. Rate Limiter

**POST/GET** `/functions/rate-limiter`

Distributed rate limiting for exchange API calls.

**Request Body:**
```json
{
  "exchange": "binance | bybit | okx | gate",
  "action": "check" | "status" | "reset"
}
```

**Response (check):**
```json
{
  "allowed": boolean,
  "exchange": "string",
  "used": number,
  "limit": number,
  "remaining": number,
  "resetAt": "ISO-8601"
}
```

**Response (status):**
```json
{
  "success": boolean,
  "action": "status",
  "status": {
    "binance": {
      "used": 0,
      "limit": 1200,
      "remaining": 1200,
      "resetAt": "ISO-8601"
    }
  },
  "timestamp": "ISO-8601"
}
```

---

### 8. Validate API Keys

**POST/GET** `/functions/validate-api-keys`

Validate exchange API credentials.

**Request Body:**
```json
{
  "exchange": "binance | bybit | okx | gate (optional)",
  "apiKey": "string (optional)",
  "apiSecret": "string (optional)",
  "apiPassphrase": "string (optional for OKX)",
  "userId": "string (optional)"
}
```

**Response:**
```json
{
  "success": boolean,
  "results": [
    {
      "exchange": "binance",
      "valid": boolean,
      "canTrade": boolean,
      "message": "string",
      "permissions": ["spot_trading"]
    }
  ],
  "timestamp": "ISO-8601"
}
```

---

## Authentication

### Bearer Token (Recommended)
```bash
Authorization: Bearer YOUR_JWT_TOKEN
```

### Service Role Authentication
Service role tokens allow accessing endpoints without a specific user context.

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message",
  "hint": "Additional context (optional)",
  "timestamp": "ISO-8601"
}
```

### Common HTTP Status Codes

- **200**: Success
- **400**: Bad Request (missing/invalid parameters)
- **401**: Unauthorized (invalid/missing token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found (user/credentials not found)
- **429**: Rate Limited
- **500**: Internal Server Error

---

## Environment Variables

```env
# API Configuration
API_PORT=3001
API_CONTROL_SECRET=your-secret-key

# Supabase Configuration
SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key

# Node Environment
NODE_ENV=development|production
```

---

## Usage Examples

### Check Rate Limit
```bash
curl -X POST http://localhost:3001/functions/rate-limiter \
  -H "Content-Type: application/json" \
  -d '{"exchange": "binance", "action": "check"}'
```

### Get Rate Limit Status
```bash
curl -X POST http://localhost:3001/functions/rate-limiter \
  -H "Content-Type: application/json" \
  -d '{"exchange": "binance", "action": "status"}'
```

### Run Manual Arbitrage Scan
```bash
curl -X POST http://localhost:3001/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"mode": "manual"}'
```

### Validate All User API Keys
```bash
curl -X POST http://localhost:3001/functions/validate-api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

### Fetch Exchange Balances
```bash
curl -X POST http://localhost:3001/functions/fetch-exchange-balances \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"exchange": "binance"}'
```

---

## Deployment

### Local Development
```bash
cd services/api
npm install
npm run dev
```

### Production (Hetzner)
Managed by systemd service:
```bash
sudo systemctl start api
sudo systemctl status api
sudo journalctl -u api -f
```

See `deploy/systemd/api.service` for configuration.

---

**Last Updated**: January 9, 2026
