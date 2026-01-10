# System Architecture: Frontend + VPS API Integration

## Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          YOUR USERS (Browser)                       │
│                     http://localhost:5173                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    HTTP/HTTPS (Fetch API)
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React/Vite)                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │ Components:                                             │       │
│  │  • ArbitrageScanner.tsx                                │       │
│  │  • ArbitrageOpportunityCard.tsx                        │       │
│  │  • TradeRecoveryPanel.tsx                              │       │
│  │  • ... other components                                │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│  Configuration:                                                    │
│  • VITE_FUNCTIONS_URL=http://localhost:3001                        │
│  • SUPABASE_URL (for auth)                                        │
└─────────────────────────────────────────────────────────────────────┘
                                   │
              fetch('http://localhost:3001/functions/*')
             Authorization: Bearer <JWT_TOKEN>
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                  VPS API SERVICE (Express.js)                       │
│                   http://localhost:3001                             │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │ Routes:                                                 │       │
│  │  • POST /functions/arbitrage-scanner                  │       │
│  │  • POST /functions/execute-trade                      │       │
│  │  • POST /functions/scheduled-arb-scan                 │       │
│  │  • POST /functions/auto-trade-scheduler               │       │
│  │  • GET  /functions/fetch-exchange-balances            │       │
│  │  • POST /functions/validate-api-keys                  │       │
│  │  • POST /functions/rate-limiter                       │       │
│  │  • WS   /functions/binance-websocket                  │       │
│  │  • GET  /health                                        │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│  Configuration:                                                    │
│  • PORT: 3001                                                      │
│  • SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY                        │
│  • SKIP_SUPABASE=false (feature flag)                             │
│                                                                     │
│  Authentication:                                                   │
│  • Validates JWT token from Authorization header                   │
│  • Extracts user ID from JWT payload                              │
│  • Routes requests appropriately                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
              Supabase JS Client
            (if SKIP_SUPABASE=false)
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      SUPABASE (Backend)                             │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │ PostgreSQL Database:                                    │       │
│  │  • users                                                │       │
│  │  • subscriptions                                        │       │
│  │  • arbitrage_opportunities                             │       │
│  │  • pending_auto_trades                                 │       │
│  │  • user_settings                                       │       │
│  │  • ... other tables                                    │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │ Edge Functions (RLS/Security):                         │       │
│  │  • encrypt-api-keys                                    │       │
│  │  • rls-policy-tests                                    │       │
│  │  • clear-user-data                                     │       │
│  └─────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### Example 1: Running an Arbitrage Scan

```
User clicks "Run Scan"
    │
    ↓
ArbitrageScanner.tsx calls performScan()
    │
    ↓
fetch(`${VITE_FUNCTIONS_URL}/functions/arbitrage-scanner`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  },
  body: JSON.stringify({
    mode: 'manual',
    userId: user.id
  })
})
    │
    ↓
VPS API receives POST /functions/arbitrage-scanner
    │
    ├─ Parse JWT token from Authorization header
    ├─ Extract user ID from token
    ├─ Validate user permissions
    │
    ↓
Check SKIP_SUPABASE flag
    │
    ├─ If false: Call Supabase RPC function "scan_for_opportunities"
    │            Returns data from Deno function
    │
    └─ If true: Query database directly
               SELECT * FROM arbitrage_opportunities
                   WHERE status = 'active'
                   AND created_at > now() - interval '1 hour'
               Returns fresh data
    │
    ↓
Database returns opportunities
    │
    ↓
VPS API formats response
    │
    ↓
fetch resolves with {
  status: 200,
  data: {
    opportunities_count: 3,
    opportunities: [
      { id: '...', exchange: 'binance', ... },
      ...
    ]
  }
}
    │
    ↓
Frontend updates UI with scan results
```

### Example 2: Executing a Trade

```
User clicks "Execute Trade" on opportunity card
    │
    ↓
ArbitrageOpportunityCard.tsx calls handleTrade()
    │
    ├─ Store trade in database
    │
    ↓
fetch(`${VITE_FUNCTIONS_URL}/functions/execute-trade`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  },
  body: JSON.stringify({
    action: 'execute_single',
    tradeId: trade.id,
    userId: user.id
  })
})
    │
    ↓
VPS API receives POST /functions/execute-trade
    │
    ├─ Validate JWT token
    ├─ Load trade details from database
    ├─ Load user's API keys (encrypted)
    ├─ Connect to exchange APIs (Binance, Bybit, etc.)
    ├─ Place orders on both exchanges
    ├─ Monitor order fills
    ├─ Calculate actual profit
    │
    ↓
Database updated with trade status
    │
    ↓
Response sent back to frontend
    │
    ↓
Frontend displays execution result
```

## Component Integration Map

```
┌─ ArbitrageScanner.tsx ─────────────────┐
│                                         │
│  performScan() ────→ POST /arbitrage-scanner
│  │                                      │
│  └─→ setLoading(true)                   │
│      └─→ toast("Scanning...")           │
│                                         │
│  loadOpportunitiesFromDB() ─────────→  Query DB for results
│                                         │
│  Retry logic ──────→ POST /arbitrage-scanner (with fresh JWT)
│
└─────────────────────────────────────────┘

┌─ ArbitrageOpportunityCard.tsx ─────────┐
│                                         │
│  handleTrade() ────→ POST /execute-trade
│  │                                      │
│  └─→ toast("Trade executed!")           │
│
└─────────────────────────────────────────┘

┌─ TradeRecoveryPanel.tsx ───────────────┐
│                                         │
│  handleAttemptRecovery() ──→ POST /execute-trade
│  │                                      │
│  └─→ fetchRecoveries() ────→ Query DB  │
│
└─────────────────────────────────────────┘
```

## Environment Variable Flow

```
.env file
  │
  ├─ VITE_FUNCTIONS_URL=http://localhost:3001
  │    │
  │    └─→ import.meta.env.VITE_FUNCTIONS_URL
  │        └─→ Used in fetch() calls
  │
  ├─ SUPABASE_URL=https://...
  │    │
  │    └─→ Frontend auth
  │        └─→ Session token
  │            └─→ Authorization header
  │
  ├─ SUPABASE_SERVICE_ROLE_KEY=...
  │    │
  │    └─→ VPS API side only
  │        └─→ Initialize Supabase client
  │            └─→ Query database
  │
  └─ SKIP_SUPABASE=false
       │
       └─→ VPS API feature flag
           └─→ Control Supabase RPC vs direct DB queries

```

## Authentication Flow

```
User logs in (Supabase Auth)
    │
    ↓
Gets JWT token (session.access_token)
    │
    ├─ Valid for ~60 minutes
    ├─ Contains user ID (sub)
    ├─ Contains role (authenticated/service_role)
    │
    ↓
Frontend sends token in every request
    │
    ├─ Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
    │
    ↓
VPS API receives request
    │
    ├─ Extracts token from Authorization header
    ├─ Decodes JWT (verifies signature later if needed)
    ├─ Reads JWT payload
    │   ├─ sub → user ID
    │   ├─ role → user role
    │   ├─ iat → issued at
    │   └─ exp → expires at
    │
    ├─ Validates user permissions
    ├─ Proceeds with request
    │
    ↓
Response sent back with data (or 401/403 error)
```

## Request/Response Format

### Request (Frontend → VPS API)

```json
POST http://localhost:3001/functions/arbitrage-scanner

{
  "mode": "manual",
  "userId": "user-123",
  "action": "scan"
}

Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
```

### Response (VPS API → Frontend)

```json
{
  "status": 200,
  "data": {
    "opportunities_count": 3,
    "opportunities": [
      {
        "id": "opp-123",
        "exchange": "binance",
        "pair": "BTC/USDT",
        "buy_price": 42000,
        "sell_price": 42100,
        "profit_percent": 0.238,
        "estimated_profit": 23.80
      }
    ],
    "scan_duration_ms": 245
  }
}
```

### Error Response

```json
{
  "status": 401,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing JWT token"
  }
}
```

## Database Query Pattern

When **SKIP_SUPABASE=false** (default):

```
Frontend Request
    ↓
VPS API
    ├─ Validate JWT
    ├─ Call Supabase RPC function
    │   └─ SELECT ... FROM arbitrage_opportunities
    │
    ↓
Response from RPC
```

When **SKIP_SUPABASE=true**:

```
Frontend Request
    ↓
VPS API
    ├─ Validate JWT
    ├─ Query database directly
    │   └─ supabase.from('arbitrage_opportunities').select()
    │
    ↓
Response from database
```

**Result**: Faster response, fewer RPC calls, real data (not mocks)

## Deployment Architecture (Production)

```
┌─────────────────────────────────────────────────────────┐
│                 Users (Web Browser)                     │
│              https://yourdomain.com                     │
└─────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ↓                             ↓
    ┌──────────────┐          ┌──────────────────┐
    │ Frontend     │          │ VPS API Service  │
    │ (Vercel/    │          │ (Hetzner VPS)    │
    │ Netlify)    │          │ Port 3001        │
    └──────────────┘          │ or reverse proxy │
                              │ Port 443 (SSL)   │
                              └──────────────────┘
                                     │
                                     ↓
                              ┌──────────────┐
                              │ Supabase     │
                              │ PostgreSQL   │
                              └──────────────┘
```

## Performance Considerations

### Current Setup (Development)

```
Frontend (http://localhost:5173)
    │ (0-5ms local)
    ↓
VPS API (http://localhost:3001)
    │ (1-10ms to Supabase)
    ↓
Supabase Database
    │ (1-5ms response)
    ↓
Back to Frontend: ~10-20ms total
```

### Production Setup

```
Frontend (https://yourdomain.com, CDN cached)
    │ (varies, but optimized)
    ↓
VPS API (https://api.yourdomain.com, with caching)
    │ (1-50ms depending on geography)
    ↓
Supabase Database (or alternative DB)
    │ (1-10ms response)
    ↓
Back to Frontend: ~20-100ms total (depending on optimizations)

Optimizations available:
• Redis caching layer
• Connection pooling
• Query optimization
• Response compression
• CDN for API
```

## Security Considerations

### Data Flow Security

```
Browser ──[HTTPS/TLS]──→ VPS API ──[Direct DB Connection]──→ PostgreSQL
          (encrypted)              (internal network)        (encrypted)

JWT Token:
  • Generated by Supabase (not VPS)
  • Signed with Supabase's secret
  • Valid for ~60 minutes
  • Contains user ID and role
  • Used to authorize API requests
```

### API Security

```
VPS API validates:
  • JWT signature (matches Supabase key)
  • User exists in database
  • User has permission for action
  • Rate limits not exceeded
  • Request size not too large

If any validation fails:
  • Request rejected with 401/403
  • No sensitive data leaked in error
  • Error logged for security review
```

---

## Quick Reference

| Component | Location | Purpose |
|-----------|----------|---------|
| Frontend | `src/` | React app, calls VPS API |
| VPS API | `services/api/src/` | Express server, handles requests |
| Database | Supabase | Stores all data |
| Auth | Supabase | Authenticates users, issues JWT |
| Config | `.env` | Environment variables |

| URL | Environment | Purpose |
|-----|-------------|---------|
| http://localhost:5173 | Development | Frontend dev server |
| http://localhost:3001 | Development | VPS API dev server |
| https://yourdomain.com | Production | Frontend (CDN) |
| https://api.yourdomain.com | Production | VPS API (with SSL) |
| https://zupbliefzhnohsoguwuk.supabase.co | Production | Supabase backend |

---

This architecture provides:
- ✅ **Separation of concerns** (frontend, API, database)
- ✅ **Scalability** (each layer can scale independently)
- ✅ **Security** (JWT auth, HTTPS, RLS policies)
- ✅ **Flexibility** (can swap components as needed)
- ✅ **Cost efficiency** (no Supabase edge function billing)
