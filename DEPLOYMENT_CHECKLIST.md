# 🚀 VPS Deployment Checklist

This checklist ensures your project is ready for VPS deployment.

## ✅ Pre-Deployment Checklist

### 1. Environment Configuration
- [ ] Create `docker/.env` from template:
  ```bash
  cp docker/env.template docker/.env
  ```
- [ ] Fill in all required values in `docker/.env`:
  - [ ] `SUPABASE_URL` - Your Supabase project URL
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` - From Supabase Dashboard > Settings > API
  - [ ] `SUPABASE_ANON_KEY` - From Supabase Dashboard > Settings > API
  - [ ] `FUNCTIONS_URL` - Your VPS URL (e.g., `https://api.yourdomain.com` or `http://your-ip:8000`)
  - [ ] `FUNCTIONS_API_KEY` - Generate with: `openssl rand -hex 32`
  - [ ] `ALLOWED_ORIGINS` - Your frontend domain(s), comma-separated
  - [ ] `PORT` - Default: `8000`

### 2. Nginx Configuration (if using domain)
- [ ] Edit `docker/nginx.conf`
- [ ] Replace `api.yourdomain.com` with your actual domain
- [ ] Update SSL certificate paths if using Let's Encrypt

### 3. Cron Jobs Configuration
- [ ] Edit `production_setup_hetzner.sql`
- [ ] Replace `YOUR_HETZNER_FUNCTIONS_URL` with your VPS URL
- [ ] Replace `YOUR_SERVICE_ROLE_KEY` with your Supabase service role key
- [ ] Replace `YOUR_FUNCTIONS_API_KEY` with the key from `docker/.env`

### 4. Frontend Configuration
- [ ] Set `VITE_FUNCTIONS_URL` environment variable in your frontend deployment
- [ ] Point to your VPS URL (e.g., `https://api.yourdomain.com`)

## 📦 Files to Deploy to VPS

### Using Deployment Script (Recommended)
The script automatically handles:
- ✅ Docker image (includes all functions)
- ✅ `docker-compose.yml`
- ✅ `.env` file
- ✅ `nginx.conf`

### Manual Deployment
If deploying manually, copy these to `/opt/arbitrage-functions/`:
- `docker/docker-compose.yml`
- `docker/Dockerfile`
- `docker/nginx.conf` (optional)
- `docker/.env`
- `supabase/functions/` (entire directory)

## 🖥️ VPS Prerequisites

- [ ] Ubuntu 22.04 LTS (recommended)
- [ ] Minimum: 2GB RAM, 2 vCPU
- [ ] Docker installed
- [ ] Docker Compose installed
- [ ] Port 8000 open in firewall
- [ ] SSH access configured

## 🚀 Deployment Steps

### Step 1: Prepare VPS
```bash
ssh root@your-server-ip
apt update && apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose -y
```

### Step 2: Deploy
```bash
# Make script executable
chmod +x deploy/hetzner-deploy.sh

# Deploy
./deploy/hetzner-deploy.sh your-server-ip root
```

### Step 3: Verify Deployment
```bash
# Check container status
ssh root@your-server-ip 'cd /opt/arbitrage-functions && docker-compose ps'

# Test health endpoint
curl http://your-server-ip:8000/health
```

### Step 4: Setup Cron Jobs
1. Open Supabase Dashboard > SQL Editor
2. Copy contents of `production_setup_hetzner.sql` (with your values filled in)
3. Run the SQL script
4. Verify jobs are scheduled: `SELECT * FROM cron.job;`

### Step 5: Update Frontend
1. Set `VITE_FUNCTIONS_URL` environment variable
2. Redeploy frontend

## 🔍 Post-Deployment Verification

- [ ] Health endpoint responds: `curl http://your-server-ip:8000/health`
- [ ] Functions are accessible: Test arbitrage-scanner endpoint
- [ ] Cron jobs are running: Check Supabase SQL Editor for job runs
- [ ] Frontend can invoke functions: Test from browser
- [ ] SSL certificate works (if configured)
- [ ] Logs show no errors: `docker-compose logs -f`

## 📝 Quick Reference

### Generate API Key
```bash
openssl rand -hex 32
```

### View Logs
```bash
ssh root@your-server-ip
cd /opt/arbitrage-functions
docker-compose logs -f functions
```

### Restart Services
```bash
cd /opt/arbitrage-functions
docker-compose restart
```

### Check Container Status
```bash
docker-compose ps
docker stats arbitrage-functions
```

## ⚠️ Important Notes

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Update `ALLOWED_ORIGINS`** - Restrict to your frontend domain in production
3. **Use HTTPS** - Set up SSL certificate for production
4. **Monitor logs** - Check logs for first 24-48 hours after deployment
5. **Backup configuration** - Keep a secure copy of your `.env` file

## 🆘 Troubleshooting

### Container won't start
- Check logs: `docker-compose logs`
- Verify environment variables: `docker-compose config`
- Ensure port 8000 is not in use

### Functions not responding
- Check firewall: `ufw status`
- Verify Docker is running: `systemctl status docker`
- Test health endpoint: `curl http://localhost:8000/health`

### Database connection issues
- Verify Supabase credentials in `.env`
- Check Supabase dashboard for IP restrictions
- Test connection: `curl https://your-project.supabase.co/rest/v1/`

## 📚 Additional Resources

- `deploy/README.md` - Detailed deployment guide
- `MIGRATION_GUIDE.md` - Step-by-step migration instructions
- `HETZNER_MIGRATION_SUMMARY.md` - Implementation summary

