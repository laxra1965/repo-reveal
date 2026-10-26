#!/bin/bash
# deploy-supervisor.sh - Deploy Arbitrage Bot using supervisor

set -e

echo "🚀 Deploying Arbitrage Bot (supervisor)"
echo "========================================"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo "❌ This script must be run as root"
    exit 1
fi

# Variables
BOT_USER="arbitrage"
BOT_HOME="/opt/arbitrage-functions"
BOT_SERVICE="arbitrage-bot"
SUPERVISOR_DIR="/etc/supervisor/conf.d"
CONFIG_DIR="/etc/arbitrage"
LOG_DIR="/var/log/arbitrage-bot"

echo "📋 Setup Information:"
echo "   User: $BOT_USER"
echo "   Home: $BOT_HOME"
echo "   Service: $BOT_SERVICE"
echo ""

# Step 1: Check if supervisor is installed
echo "1️⃣  Checking supervisor installation..."
if ! command -v supervisord &> /dev/null; then
    echo "⚠️  Supervisor not found. Installing..."
    if command -v apt-get &> /dev/null; then
        apt-get update
        apt-get install -y supervisor
    elif command -v yum &> /dev/null; then
        yum install -y supervisor
    else
        echo "❌ Package manager not found. Install supervisor manually."
        exit 1
    fi
fi
echo "✅ Supervisor is installed"

# Step 2: Create bot user if doesn't exist
echo ""
echo "2️⃣  Creating bot user..."
if ! id "$BOT_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d "$BOT_HOME" -m "$BOT_USER"
    echo "✅ User '$BOT_USER' created"
else
    echo "✅ User '$BOT_USER' already exists"
fi

# Step 3: Setup directories
echo ""
echo "3️⃣  Setting up directories..."
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$BOT_HOME/logs"

chown -R "$BOT_USER:$BOT_USER" "$BOT_HOME"
chown -R "$BOT_USER:$BOT_USER" "$LOG_DIR"
chmod 750 "$CONFIG_DIR"
chmod 750 "$LOG_DIR"
echo "✅ Directories configured"

# Step 4: Install supervisor configuration
echo ""
echo "4️⃣  Installing supervisor configuration..."
cp "$(dirname "$0")/arbitrage-bot.conf" "$SUPERVISOR_DIR/$BOT_SERVICE.conf"
chmod 644 "$SUPERVISOR_DIR/$BOT_SERVICE.conf"
echo "✅ Supervisor config installed"

# Step 5: Create environment file template
echo ""
echo "5️⃣  Creating environment file..."
if [ ! -f "$CONFIG_DIR/bot.env" ]; then
    cat > "$CONFIG_DIR/bot.env" << 'EOF'
# Arbitrage Bot Configuration

# Trading Mode
TRADING_MODE=paper

# Exchange API Keys (from Binance API Management)
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key

# Webhook Alerts (optional)
WEBHOOK_ENABLED=false
WEBHOOK_TYPE=discord
WEBHOOK_URL=https://discord.com/api/webhooks/...

# Logging
LOG_LEVEL=info

EOF
    chown "$BOT_USER:$BOT_USER" "$CONFIG_DIR/bot.env"
    chmod 600 "$CONFIG_DIR/bot.env"
    echo "✅ Environment file created at: $CONFIG_DIR/bot.env"
    echo "   ⚠️  EDIT THIS FILE with your API keys!"
else
    echo "⚠️  Environment file already exists: $CONFIG_DIR/bot.env"
fi

# Step 6: Reload supervisor
echo ""
echo "6️⃣  Reloading supervisor..."
supervisorctl reread
supervisorctl update
echo "✅ Supervisor reloaded"

# Step 7: Start the service
echo ""
echo "7️⃣  Starting service..."
supervisorctl start "$BOT_SERVICE"
sleep 2
supervisorctl status "$BOT_SERVICE"

echo ""
echo "========================================"
echo "✅ DEPLOYMENT COMPLETE!"
echo "========================================"
echo ""
echo "📚 NEXT STEPS:"
echo ""
echo "1. Edit configuration:"
echo "   nano $CONFIG_DIR/bot.env"
echo ""
echo "2. Test paper trading:"
echo "   supervisorctl tail -f $BOT_SERVICE"
echo ""
echo "3. Check status:"
echo "   supervisorctl status $BOT_SERVICE"
echo ""
echo "4. After 24-48 hours of successful paper trading:"
echo "   - Edit $CONFIG_DIR/bot.env"
echo "   - Change: TRADING_MODE=real"
echo "   - Restart: supervisorctl restart $BOT_SERVICE"
echo ""
echo "📖 Useful Commands:"
echo "   supervisorctl start $BOT_SERVICE     # Start service"
echo "   supervisorctl stop $BOT_SERVICE      # Stop service"
echo "   supervisorctl restart $BOT_SERVICE   # Restart service"
echo "   supervisorctl status $BOT_SERVICE    # Check status"
echo "   supervisorctl tail -f $BOT_SERVICE   # Follow logs"
echo "   tail -f $LOG_DIR/stdout.log          # View raw logs"
echo ""
