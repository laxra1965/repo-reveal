# Migration Guide: Supabase Edge Functions → Hetzner Singapore VPS

## Overview

This guide walks you through migrating your edge functions from Supabase to Hetzner Singapore VPS for better latency to Asian cryptocurrency exchanges.

## Prerequisites

✅ **Completed:**
- [x] Docker infrastructure created
- [x] Unified HTTP server created
- [x] Function handlers updated to export default
- [x] Inter-function calls updated
- [x] Frontend updated to support Hetzner URL
- [x] Cron jobs SQL updated
- [x] Deployment scripts created

## Step-by-Step Migration

### Step 1: Prepare Your Hetzner VPS

1. **SSH into your VPS:**
   ```bash
   ssh root@your-server-ip
   ```

2. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   apt install docker-compose -y
   ```

3. **Create deployment directory:**
   ```bash
   mkdir -p /opt/arbitrage-functions
   ```

### Step 2: Configure Environment Variables

1. **On your local machine, create `docker/.env`:**
   ```bash
   cp docker/.env.template docker/.env
   ```

2. **Edit `docker/.env` with your values:**
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - From Supabase Dashboard
   - `SUPABASE_ANON_KEY` - From Supabase Dashboard
   - `ALLOWED_ORIGINS` - Your frontend domain(s)
   - `FUNCTIONS_API_KEY` - Generate with: `openssl rand -hex 32`
   - `FUNCTIONS_URL` - Your Hetzner VPS URL (e.g., `https://api.yourdomain.com`)

### Step 3: Deploy to Hetzner

**Option A: Using deployment script (recommended)**

```bash
chmod +x deploy/hetzner-deploy.sh
./deploy/hetzner-deploy.sh your-server-ip root
```

**Option B: Manual deployment**

1. **Copy files to server:**
   ```bash
   scp -r docker/* root@your-server-ip:/opt/arbitrage-functions/
   scp -r supabase/functions root@your-server-ip:/opt/arbitrage-functions/
   ```

2. **On server, build and start:**
   ```bash
   ssh root@your-server-ip
   cd /opt/arbitrage-functions
   docker-compose up -d --build
   ```

### Step 4: Verify Deployment

1. **Check container status:**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

2. **Test health endpoint:**
   ```bash
   curl http://your-server-ip:8000/health
   ```

3. **Test function endpoint:**
   ```bash
   curl -X POST http://your-server-ip:8000/functions/arbitrage-scanner \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
     -d '{"mode": "auto"}'
   ```

### Step 5: Update Cron Jobs

1. **Edit `production_setup_hetzner.sql`:**
   - Replace `YOUR_HETZNER_FUNCTIONS_URL` with your VPS URL
   - Replace `YOUR_SERVICE_ROLE_KEY` with your Supabase service role key
   - Replace `YOUR_FUNCTIONS_API_KEY` with your API key (from docker/.env)

2. **Run in Supabase SQL Editor:**
   ```sql
   -- First, unschedule old jobs (if they exist)
   SELECT cron.unschedule('arbitrage-scanner-auto');
   SELECT cron.unschedule('auto-trade-scheduler');
   SELECT cron.unschedule('arbitrage-cleanup');
   
   -- Then run the new setup
   -- (Copy contents of production_setup_hetzner.sql)
   ```

### Step 6: Update Frontend

1. **Set environment variable:**
   - In your deployment platform (Vercel, etc.), add:
     ```
     VITE_FUNCTIONS_URL=https://api.yourdomain.com
     ```
   - Or for local development, create `.env.local`:
     ```
     VITE_FUNCTIONS_URL=http://localhost:8000
     ```

2. **Redeploy frontend** (if using Vercel, it will auto-deploy)

### Step 7: SSL Setup (Recommended)

1. **Install Certbot:**
   ```bash
   apt install certbot python3-certbot-nginx -y
   ```

2. **Get certificate:**
   ```bash
   certbot certonly --standalone -d api.yourdomain.com
   ```

3. **Update nginx.conf** with certificate paths

4. **Install and configure Nginx:**
   ```bash
   apt install nginx -y
   cp /opt/arbitrage-functions/nginx.conf /etc/nginx/sites-available/functions
   ln -s /etc/nginx/sites-available/functions /etc/nginx/sites-enabled/
   nginx -t
   systemctl reload nginx
   ```

## Testing Checklist

- [ ] Health endpoint responds: `curl http://your-server-ip:8000/health`
- [ ] Arbitrage scanner works: Test with manual scan
- [ ] Auto-trade scheduler runs: Check cron job logs
- [ ] Frontend can invoke functions: Test from browser
- [ ] Inter-function calls work: Check auto-trade-scheduler logs
- [ ] Database connectivity: Health check shows "connected"
- [ ] SSL certificate works (if configured)

## Rollback Plan

If you need to rollback to Supabase:

1. **Revert frontend:**
   - Remove or clear `VITE_FUNCTIONS_URL` environment variable
   - Redeploy frontend

2. **Revert cron jobs:**
   - Run `production_setup.sql` (original Supabase URLs)
   - Unschedule Hetzner jobs

3. **Keep Hetzner running** for debugging if needed

## Monitoring

### View Logs

```bash
# On Hetzner VPS
cd /opt/arbitrage-functions
docker-compose logs -f functions
```

### Check Resource Usage

```bash
docker stats arbitrage-functions
```

### Monitor Health

Set up a monitoring service (UptimeRobot, etc.) to check:
- `https://api.yourdomain.com/health`

## Expected Performance Improvement

**Before (Supabase US/EU):**
- Binance API: ~200-300ms latency
- Bybit API: ~250-350ms latency

**After (Hetzner Singapore):**
- Binance API: ~50-100ms latency (60-70% improvement)
- Bybit API: ~80-150ms latency (50-60% improvement)

## Troubleshooting

### Container won't start
- Check logs: `docker-compose logs`
- Verify environment variables: `docker-compose config`
- Ensure port 8000 is not in use: `netstat -tulpn | grep 8000`

### Functions not responding
- Check firewall: `ufw status`
- Verify Docker is running: `systemctl status docker`
- Test health endpoint directly: `curl http://localhost:8000/health`

### Database connection issues
- Verify Supabase credentials in `.env`
- Check Supabase dashboard for IP restrictions
- Test connection: `curl https://your-project.supabase.co/rest/v1/`

## Next Steps

1. ✅ Deploy to Hetzner
2. ✅ Update cron jobs
3. ✅ Update frontend
4. ⏳ Monitor for 24-48 hours
5. ⏳ Remove Supabase functions (after validation)

## Support

If you encounter issues:
1. Check logs: `docker-compose logs -f`
2. Verify all environment variables are set
3. Test each function individually
4. Check Supabase dashboard for any restrictions

