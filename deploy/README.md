# Hetzner Singapore VPS Deployment Guide

## Prerequisites

1. **Hetzner VPS** (Singapore location)
   - Ubuntu 22.04 LTS recommended
   - Minimum: 2GB RAM, 2 vCPU
   - Docker and Docker Compose installed

2. **Domain name** (optional but recommended)
   - Point DNS A record to VPS IP
   - Example: `api.yourdomain.com` → `your-vps-ip`

3. **SSL Certificate** (for HTTPS)
   - Use Let's Encrypt with Certbot

## Initial Server Setup

### 1. Connect to your VPS

```bash
ssh root@your-server-ip
```

### 2. Install Docker and Docker Compose

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker --version
docker-compose --version
```

### 3. Create deployment directory

```bash
mkdir -p /opt/arbitrage-functions
cd /opt/arbitrage-functions
```

## Configuration

### 1. Create environment file

Copy `docker/.env.example` to `docker/.env` and fill in your values:

```bash
# On your local machine
cp docker/.env.example docker/.env
# Edit docker/.env with your actual values
```

Required values:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (from Supabase Dashboard)
- `SUPABASE_ANON_KEY` - Anon key (from Supabase Dashboard)
- `ALLOWED_ORIGINS` - Your frontend domain(s)
- `FUNCTIONS_API_KEY` - Secure API key for cron job authentication

### 2. Update nginx.conf

Edit `docker/nginx.conf` and replace `api.yourdomain.com` with your actual domain.

## Deployment

### Option 1: Using deployment script (recommended)

```bash
# Make script executable
chmod +x deploy/hetzner-deploy.sh

# Deploy
./deploy/hetzner-deploy.sh your-server-ip root
```

### Option 2: Manual deployment

1. **Copy files to server:**

```bash
scp -r docker/* root@your-server-ip:/opt/arbitrage-functions/
scp -r supabase/functions root@your-server-ip:/opt/arbitrage-functions/
```

2. **On server, build and start:**

```bash
cd /opt/arbitrage-functions
docker-compose up -d --build
```

## SSL Setup (Optional but Recommended)

### Install Certbot

```bash
apt install certbot python3-certbot-nginx -y
```

### Get SSL certificate

```bash
certbot certonly --standalone -d api.yourdomain.com
```

### Update nginx.conf

Update the SSL certificate paths in `docker/nginx.conf`:

```nginx
ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
```

### Setup Nginx (if using reverse proxy)

Install Nginx and configure it to use the provided `nginx.conf`:

```bash
apt install nginx -y
cp /opt/arbitrage-functions/nginx.conf /etc/nginx/sites-available/functions
ln -s /etc/nginx/sites-available/functions /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## Verification

### Check container status

```bash
cd /opt/arbitrage-functions
docker-compose ps
docker-compose logs -f
```

### Test health endpoint

```bash
curl http://localhost:8000/health
# Or from outside:
curl http://your-server-ip:8000/health
```

### Test function endpoint

```bash
curl -X POST http://your-server-ip:8000/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{"mode": "auto"}'
```

## Updating Functions

To update functions after code changes:

```bash
# Rebuild and restart
cd /opt/arbitrage-functions
docker-compose down
docker-compose up -d --build
```

Or use the deployment script again.

## Monitoring

### View logs

```bash
docker-compose logs -f functions
```

### Check resource usage

```bash
docker stats arbitrage-functions
```

### Restart services

```bash
docker-compose restart
```

## Troubleshooting

### Container won't start

1. Check logs: `docker-compose logs`
2. Verify environment variables: `docker-compose config`
3. Test health endpoint manually

### Functions not responding

1. Check if port 8000 is open: `netstat -tulpn | grep 8000`
2. Verify firewall rules allow port 8000
3. Check Docker logs for errors

### Database connection issues

1. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
2. Test connection from server: `curl https://your-project.supabase.co/rest/v1/`
3. Check Supabase dashboard for any restrictions

## Next Steps

After deployment:

1. Update frontend to use new function URLs
2. Update cron jobs in `production_setup.sql`
3. Monitor logs for first 24 hours
4. Set up monitoring/alerting (optional)

