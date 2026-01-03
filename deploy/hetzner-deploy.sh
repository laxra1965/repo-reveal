#!/bin/bash
# Deployment script for Hetzner Singapore VPS
# Usage: ./hetzner-deploy.sh [server_ip] [ssh_user]

set -e

SERVER_IP=${1:-"your-server-ip"}
SSH_USER=${2:-"root"}
DEPLOY_DIR="/opt/arbitrage-functions"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🚀 Starting deployment to Hetzner Singapore VPS..."
echo "📡 Server: $SSH_USER@$SERVER_IP"
echo "📁 Deploy directory: $DEPLOY_DIR"

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/docker/.env" ]; then
    echo "❌ Error: docker/.env file not found!"
    echo "   Please create docker/.env from docker/env.template"
    echo "   Command: cp docker/env.template docker/.env"
    exit 1
fi

# Build Docker image locally (optional - can also build on server)
echo "📦 Building Docker image..."
cd "$PROJECT_DIR"
docker build -f docker/Dockerfile -t arbitrage-functions:latest .

# Save image to tar file
echo "💾 Saving Docker image..."
docker save arbitrage-functions:latest | gzip > /tmp/arbitrage-functions.tar.gz

# Copy files to server
echo "📤 Copying files to server..."
ssh "$SSH_USER@$SERVER_IP" "mkdir -p $DEPLOY_DIR"
scp /tmp/arbitrage-functions.tar.gz "$SSH_USER@$SERVER_IP:/tmp/"
scp "$PROJECT_DIR/docker/docker-compose.yml" "$SSH_USER@$SERVER_IP:$DEPLOY_DIR/"
scp "$PROJECT_DIR/docker/.env" "$SSH_USER@$SERVER_IP:$DEPLOY_DIR/"
scp "$PROJECT_DIR/docker/nginx.conf" "$SSH_USER@$SERVER_IP:$DEPLOY_DIR/"

# Deploy on server
echo "🔧 Deploying on server..."
ssh "$SSH_USER@$SERVER_IP" << 'ENDSSH'
    set -e
    cd /opt/arbitrage-functions
    
    # Load Docker image
    echo "📥 Loading Docker image..."
    docker load < /tmp/arbitrage-functions.tar.gz
    rm /tmp/arbitrage-functions.tar.gz
    
    # Stop existing containers
    echo "🛑 Stopping existing containers..."
    docker-compose down || true
    
    # Start new containers
    echo "▶️  Starting containers..."
    docker-compose up -d
    
    # Show logs
    echo "📋 Container logs:"
    docker-compose logs --tail=50
    
    # Health check
    echo "🏥 Running health check..."
    sleep 5
    curl -f http://localhost:8000/health || echo "⚠️  Health check failed - check logs"
ENDSSH

echo "✅ Deployment complete!"
echo "🌐 Functions should be available at: http://$SERVER_IP:8000"
echo "📊 Check status: ssh $SSH_USER@$SERVER_IP 'cd $DEPLOY_DIR && docker-compose ps'"

