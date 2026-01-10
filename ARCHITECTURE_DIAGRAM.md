# Architecture Diagram - Edge Functions Migration

## Before (Supabase Edge Functions)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Application                      │
│                   (React/TypeScript)                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS Requests
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase Cloud                             │
├─────────────────────────────────────────────────────────────┤
│  Edge Functions (Deno):                                      │
│  ├── arbitrage-scanner                                       │
│  ├── execute-trade                                           │
│  ├── scheduled-arb-scan                                      │
│  ├── auto-trade-scheduler                                    │
│  ├── binance-websocket                                       │
│  ├── fetch-exchange-balances                                 │
│  ├── rate-limiter                                            │
│  ├── validate-api-keys                                       │
│  ├── rls-policy-tests          (stay here)                  │
│  ├── encrypt-api-keys          (stay here)                  │
│  └── clear-user-data           (stay here)                  │
│                                                              │
│  PostgreSQL Database                                         │
└────────┬──────────────────────────────────┬──────────────────┘
         │                                  │
         └──────────────────────────────────┘
```

## After (VPS + Supabase Edge Functions)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Application                      │
│                   (React/TypeScript)                         │
├────────┬────────────────────────────────────────────┬────────┤
│ local  │ Supabase functions for auth/security       │ VPS    │
│ API    │ RPC calls for data operations              │ API    │
└────┬───┴──────────────────┬──────────────────────────┴───┬────┘
     │                      │                              │
     │ HTTP               │ HTTPS                          │ HTTP
     │ localhost:3001      │                               │
     ▼                     ▼                               ▼
┌──────────────────┐   ┌──────────────────┐    ┌─────────────────┐
│  Your VPS        │   │  Supabase Cloud  │    │ Exchange APIs   │
│  (Hetzner)       │   │  (PostgreSQL)    │    │ (Binance, etc)  │
├──────────────────┤   ├──────────────────┤    └─────────────────┘
│ Express.js API   │   │ Auth System      │
│ Service          │   │ RLS Policies     │
├──────────────────┤   │ Vault (encrypt)  │
│ Routes:          │   │ Edge Functions:  │
│ ├─ /functions/   │   │ ├─ rls-tests     │
│ │  arbitrage-    │   │ ├─ encrypt-keys  │
│ │  scanner       │   │ └─ clear-data    │
│ │               │   │                  │
│ ├─ /functions/   │   │ Tables:          │
│ │  execute-      │   │ ├─ users         │
│ │  trade         │   │ ├─ credentials   │
│ │               │   │ ├─ opportunities │
│ ├─ /functions/   │   │ ├─ scan_logs     │
│ │  scheduled-    │   │ └─ ...           │
│ │  arb-scan      │   │                  │
│ │               │   │ RPC Functions:   │
│ ├─ /functions/   │   │ ├─ cleanup_old   │
│ │  auto-trade-   │   │ ├─ queue_trades  │
│ │  scheduler     │   │ └─ process_trades│
│ │               │   │                  │
│ ├─ /functions/   │   └──────────────────┘
│ │  binance-      │
│ │  websocket     │
│ │               │
│ ├─ /functions/   │
│ │  fetch-        │
│ │  balances      │
│ │               │
│ ├─ /functions/   │
│ │  rate-limit    │
│ │               │
│ └─ /functions/   │
│    validate-keys │
│                  │
│ Systemd Service: │
│ [api.service]    │
│                  │
│ Config:          │
│ ├─ .env file     │
│ ├─ nginx (proxy) │
│ └─ logs          │
└──────────────────┘
```

## Data Flow Examples

### Example 1: Arbitrage Scanning

```
User Request
    │
    ▼
┌─────────────────────────┐
│ Frontend (React)        │
│ POST /functions/arb-... │
└────────────┬────────────┘
             │
             │ HTTP (local network)
             ▼
┌─────────────────────────────────────────┐
│ VPS API Service (Express.js)            │
│ /functions/arbitrage-scanner            │
├─────────────────────────────────────────┤
│ 1. Verify JWT token from Supabase       │
│ 2. Fetch user settings from DB          │
│ 3. Fetch exchange prices                │
│ 4. Run scanning algorithms              │
│ 5. Score opportunities                  │
│ 6. Store results in DB                  │
└────────────┬────────────────────────────┘
             │
             │ PostgreSQL queries
             ▼
┌─────────────────────────┐
│ Supabase Cloud          │
│ Database                │
│                         │
│ Tables:                 │
│ - user_settings         │
│ - exchange_prices       │
│ - opportunities         │
└─────────────────────────┘
```

### Example 2: Execute Trade

```
User Request (with opportunity)
    │
    ▼
┌──────────────────────────┐
│ Frontend (React)         │
│ POST /functions/execute- │
│       trade              │
└─────────┬────────────────┘
          │
          │ HTTP
          ▼
┌──────────────────────────────────────┐
│ VPS API Service (Express.js)         │
│ /functions/execute-trade             │
├──────────────────────────────────────┤
│ 1. Verify JWT token                  │
│ 2. Get user's encrypted credentials  │
│ 3. Decrypt credentials               │
│ 4. Call decrypt function on Supabase │
│ 5. Sign exchange API request         │
│ 6. Call exchange API                 │
│ 7. Log trade attempt                 │
│ 8. Return result                     │
└─┬──────────────────────────────────┬─┘
  │                                  │
  │ HTTPS                   HTTPS    │
  ▼                         ▼        │
┌──────────────────┐   ┌─────────────────┐
│ Exchange API     │   │ Supabase        │
│ (Binance, etc)   │   │ /functions/     │
│                  │   │ decrypt-keys    │
│ Execute trade    │   │                 │
└──────────────────┘   └─────────────────┘
```

### Example 3: Scheduled Cleanup

```
Cron Job (systemd timer or external)
    │
    ▼
┌──────────────────────────────┐
│ VPS API Service              │
│ GET /functions/scheduled-..  │
├──────────────────────────────┤
│ 1. Call RPC: cleanup_old...  │
│    - Delete old opportunities│
│    - Delete old scan logs    │
│ 2. Return statistics         │
└────────┬─────────────────────┘
         │
         │ PostgreSQL RPC
         ▼
┌──────────────────────┐
│ Supabase Cloud       │
│ Database             │
│                      │
│ RPC Function:        │
│ cleanup_old_...      │
│                      │
│ Executes SQL:        │
│ DELETE FROM ...      │
│ WHERE created_at <   │
│       (NOW - 24h)    │
└──────────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│            Hetzner Cloud (VPS)                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │  Ubuntu Server                              │  │
│  │  ├─ Node.js runtime                         │  │
│  │  ├─ npm packages                            │  │
│  │  ├─ .env configuration                      │  │
│  │  └─ Systemd services                        │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │  Services (Systemd)                         │  │
│  │  ├─ api.service (Port 3001) ←── HERE       │  │
│  │  ├─ executor.service                        │  │
│  │  ├─ scanner.service                         │  │
│  │  └─ market-data.service                     │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │  Networking                                 │  │
│  │  ├─ Nginx (reverse proxy on port 80/443)   │  │
│  │  ├─ Internal routing                        │  │
│  │  └─ Firewall rules                          │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
         │
         │ HTTPS
         ▼
   Internet / Frontend
```

## File Structure (Post-Migration)

```
repo-reveal-main/
├── services/
│   ├── api/                    (Updated with new routes)
│   │   ├── src/
│   │   │   ├── index.ts        (MODIFIED - route registration)
│   │   │   ├── RequestVerifier.ts
│   │   │   └── routes/         (NEW DIRECTORY)
│   │   │       ├── arbitrage-scanner.ts
│   │   │       ├── execute-trade.ts
│   │   │       ├── scheduled-arb-scan.ts
│   │   │       ├── auto-trade-scheduler.ts
│   │   │       ├── binance-websocket.ts
│   │   │       ├── fetch-exchange-balances.ts
│   │   │       ├── rate-limiter.ts
│   │   │       └── validate-api-keys.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── executor/
│   ├── scanner/
│   └── market-data/
├── supabase/
│   └── functions/              (Original - some stay here)
│       ├── rls-policy-tests/   (STAYS - RLS specific)
│       ├── encrypt-api-keys/   (STAYS - Vault specific)
│       ├── clear-user-data/    (STAYS - Auth specific)
│       └── [OTHER FUNCTIONS]   (MOVED to VPS)
├── EDGE_FUNCTIONS_MIGRATION.md (NEW)
├── VPS_API_REFERENCE.md        (NEW)
├── MIGRATION_STATUS.md         (NEW)
└── MIGRATION_COMPLETE.md       (NEW)
```

## Integration Points

```
┌─────────────────────────────────────────────┐
│            Frontend Application             │
│  Updates API calls from:                    │
│  supabase.co/functions/v1/name              │
│  to:                                        │
│  vps-ip:3001/functions/name                 │
└────────────┬────────────────────────────────┘
             │
      ┌──────┴──────┐
      │             │
      ▼             ▼
  VPS API      Supabase Auth
  (8 functions)  (3 functions)
    │             │
    └──────┬──────┘
           ▼
      PostgreSQL Database
      (Shared - all data here)
      │
      ├─ User accounts
      ├─ API credentials
      ├─ Opportunities
      ├─ Scan logs
      └─ Settings
```

---

**Architecture Diagram Created**: January 9, 2026
