
# VPS Deployment: Files and Setup Instructions

## Files That Need to Be on the VPS

Your VPS backend consists of 4 Node.js services + a shared library, all requiring Redis. Here is every file that must be transferred:

### 1. Shared Library (`shared/`)
| File | Purpose |
|------|---------|
| `shared/package.json` | Dependencies for shared module |
| `shared/tsconfig.json` | TypeScript config |
| `shared/src/index.ts` | Barrel export |
| `shared/src/types.ts` | Shared type definitions |
| `shared/src/tier.config.ts` | Tier configuration |
| `shared/src/exchange.config.ts` | Exchange configuration |
| `shared/src/runtime.ts` | Runtime helpers |

### 2. Scanner Service (`services/scanner/`)
| File | Purpose |
|------|---------|
| `services/scanner/package.json` | Dependencies (ioredis, supabase-js) |
| `services/scanner/tsconfig.json` | TypeScript config |
| `services/scanner/src/index.ts` | Entry point - starts 8 exchange scanners |
| `services/scanner/src/ScannerService.ts` | Core service - subscribes to Redis depth data |
| `services/scanner/src/Scanner.ts` | Triangular arbitrage detection logic |
| `services/scanner/src/SupabaseWriter.ts` | Batched writes to Supabase with retry |
| `services/scanner/src/snapshotUrls.ts` | Exchange-specific REST snapshot configs |
| `services/scanner/src/pathGenerator.ts` | Dynamic arbitrage path generation |
| `services/scanner/src/movers.ts` | Top movers subscription |
| `services/scanner/src/paper/PaperExecutor.ts` | Paper trading executor |
| `services/scanner/src/paper/PaperWallet.ts` | Paper trading wallet |

### 3. Market Data Service (`services/market-data/`)
| File | Purpose |
|------|---------|
| `services/market-data/package.json` | Dependencies (ioredis, ws, axios) |
| `services/market-data/tsconfig.json` | TypeScript config |
| `services/market-data/src/index.ts` | Entry point - starts WebSocket consumers |
| `services/market-data/src/RedisClient.ts` | Redis client wrapper |
| `services/market-data/src/OrderBook.ts` | Order book data structure |
| `services/market-data/src/BinanceDepthConsumer.ts` | Binance WebSocket consumer |
| `services/market-data/src/BybitDepthConsumer.ts` | Bybit WebSocket consumer |
| `services/market-data/src/OKXDepthConsumer.ts` | OKX WebSocket consumer |
| `services/market-data/src/GateDepthConsumer.ts` | Gate.io WebSocket consumer |
| `services/market-data/src/MEXCDepthConsumer.ts` | MEXC WebSocket consumer |
| `services/market-data/src/KucoinDepthConsumer.ts` | KuCoin WebSocket consumer |
| `services/market-data/src/exchanges/*.ts` | Exchange REST clients (6 files) |
| `services/market-data/src/movers/*.ts` | Top movers fetchers (7 files + index) |
| `services/market-data/src/utils/Reconnector.ts` | WebSocket reconnection logic |

### 4. API Service (`services/api/`)
| File | Purpose |
|------|---------|
| `services/api/package.json` | Dependencies (express, supabase-js) |
| `services/api/tsconfig.json` | TypeScript config |
| `services/api/src/index.ts` | Express server entry point (port 3001) |
| `services/api/src/RequestVerifier.ts` | Request verification |
| `services/api/src/routes/*.ts` | Route handlers (7 files) |

### 5. Executor Service (`services/executor/`)
| File | Purpose |
|------|---------|
| `services/executor/package.json` | Dependencies (ioredis) |
| `services/executor/tsconfig.json` | TypeScript config |
| `services/executor/src/index.ts` | Entry point (requires TRADING_ENABLED=true) |
| `services/executor/src/ExecutorService.ts` | Main executor orchestration |
| `services/executor/src/ExecutionEngine.ts` | Trade execution engine |
| `services/executor/src/MultiExchangeExecutor.ts` | Multi-exchange coordination |
| `services/executor/src/BinanceExecutor.ts` | Binance trade execution |
| `services/executor/src/BybitExecutor.ts` | Bybit trade execution |
| `services/executor/src/GateExecutor.ts` | Gate.io trade execution |
| `services/executor/src/MexcExecutor.ts` | MEXC trade execution |
| `services/executor/src/OKXExecutor.ts` | OKX trade execution |
| `services/executor/src/AllocationEngine.ts` | Capital allocation logic |
| `services/executor/src/EligibilityFilter.ts` | Trade eligibility checks |
| `services/executor/src/JobScheduler.ts` | Job scheduling |
| `services/executor/src/KeyManager.ts` | API key management |
| `services/executor/src/UserService.ts` | User data service |
| `services/executor/src/AsyncLogger.ts` | Async logging |

### 6. Build and Deploy Files (root level)
| File | Purpose |
|------|---------|
| `Dockerfile.node` | Node.js Docker image for all services |
| `docker-compose.yml` | Orchestrates all services + Redis |
| `docker/Dockerfile` | Deno functions bridge (legacy) |
| `docker/docker-compose.yml` | Alternative Docker Compose |
| `docker/nginx.conf` | Nginx reverse proxy config |
| `docker/env.template` | Environment variable template |
| `deploy/hetzner-deploy.sh` | Automated deploy script |
| `deploy/systemd/*.service` | Systemd unit files (4 services) |
| `tsconfig.json` | Root TypeScript config |
| `package.json` | Root package.json |

---

## Step-by-Step Deployment Instructions

### Option A: Docker Compose (Recommended)

```text
Step 1: SSH into your VPS
   ssh -i tri-arb-key.pem ubuntu@16.16.77.247

Step 2: Install Docker and Docker Compose (if not already)
   sudo apt update && sudo apt install -y docker.io docker-compose
   sudo usermod -aG docker ubuntu
   (log out and back in for group change)

Step 3: Create project directory
   sudo mkdir -p /opt/arbitrage
   sudo chown ubuntu:ubuntu /opt/arbitrage
   cd /opt/arbitrage

Step 4: Copy files from local machine (run from your local project root)
   scp -i tri-arb-key.pem -r services/ shared/ ubuntu@16.16.77.247:/opt/arbitrage/
   scp -i tri-arb-key.pem Dockerfile.node docker-compose.yml package.json tsconfig.json ubuntu@16.16.77.247:/opt/arbitrage/
   scp -i tri-arb-key.pem -r docker/ ubuntu@16.16.77.247:/opt/arbitrage/

Step 5: Create .env file on VPS
   nano /opt/arbitrage/.env

   Add these values:
   RUNTIME=vps
   REDIS_URL=redis://redis:6379
   SUPABASE_URL=https://zupbliefzhnohsoguwuk.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   SUPABASE_ANON_KEY=<your-anon-key>
   API_CONTROL_SECRET=<generate with: openssl rand -hex 32>
   TRADING_ENABLED=true

Step 6: Build and start all services
   cd /opt/arbitrage
   docker-compose up -d --build

Step 7: Verify everything is running
   docker-compose ps
   docker-compose logs -f scanner
   docker-compose logs -f market-data
```

### Option B: Systemd (No Docker)

```text
Step 1: SSH into VPS and install Node.js 20 + Redis
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs redis-server
   sudo systemctl enable redis-server && sudo systemctl start redis-server

Step 2: Copy files and install dependencies
   cd /opt/arbitrage
   (copy all files as in Option A Step 4)
   cd shared && npm install && npm run build && cd ..
   cd services/scanner && npm install && npm run build && cd ../..
   cd services/market-data && npm install && npm run build && cd ../..
   cd services/api && npm install && npm run build && cd ../..
   cd services/executor && npm install && npm run build && cd ../..

Step 3: Copy systemd unit files
   sudo cp deploy/systemd/*.service /etc/systemd/system/
   sudo systemctl daemon-reload

Step 4: Set environment variables in each .service file
   Edit each file under /etc/systemd/system/ to add:
   Environment=SUPABASE_URL=https://zupbliefzhnohsoguwuk.supabase.co
   Environment=SUPABASE_SERVICE_ROLE_KEY=<your-key>
   Environment=REDIS_URL=redis://127.0.0.1:6379

Step 5: Start services
   sudo systemctl enable --now market-data scanner api executor
   sudo journalctl -u scanner -f
```

---

## Service Startup Order (Important)

```text
1. Redis         -- must be running first
2. market-data   -- connects to exchanges via WebSocket, publishes depth to Redis
3. scanner       -- subscribes to Redis depth data, detects arbitrage, writes to Supabase
4. api           -- Express server on port 3001 for frontend calls
5. executor      -- listens for trade signals (only if TRADING_ENABLED=true)
```

The scanner depends on market-data because it subscribes to `depth:{exchange}:*` Redis channels that market-data publishes. Without market-data running, the scanner will start but never receive any order book updates.

---

## Required Environment Variables Summary

| Variable | Where to Get It |
|----------|-----------------|
| `SUPABASE_URL` | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard > Settings > API (secret) |
| `SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API |
| `REDIS_URL` | `redis://redis:6379` (Docker) or `redis://127.0.0.1:6379` (bare metal) |
| `RUNTIME` | Must be `vps` (all services check this) |
| `TRADING_ENABLED` | `true` to enable executor |
| `API_CONTROL_SECRET` | Generate with `openssl rand -hex 32` |

---

## Next Steps

Once you upload your VPS logs, I can diagnose exactly why the scanner is not starting and tell you what is missing or misconfigured.
