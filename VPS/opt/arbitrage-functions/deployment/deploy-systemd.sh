#!/bin/bash
# deploy-systemd.sh - Deploy Arbitrage Bot using systemd

set -e

echo "🚀 Deploying Arbitrage Bot (systemd)"
echo "===================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo "❌ This script must be run as root"
    exit 1
fi

# Variables
BOT_USER="arbitrage"
BOT_HOME="/opt/arbitrage-functions"
BOT_SERVICE="arbitrage-bot"
SYSTEMD_DIR="/etc/systemd/system"
CONFIG_DIR="/etc/arbitrage"
LOG_DIR="/var/log/arbitrage-bot"

echo "📋 Setup Information:"
echo "   User: $BOT_USER"
echo "   Home: $BOT_HOME"
echo "   Service: $BOT_SERVICE"
echo ""

# Step 1: Create bot user if doesn't exist
echo "1️⃣  Creating bot user..."
if ! id "$BOT_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d "$BOT_HOME" -m "$BOT_USER"
    echo "✅ User '$BOT_USER' created"
else
    echo "✅ User '$BOT_USER' already exists"
fi

# Step 2: Setup directories
echo ""
echo "2️⃣  Setting up directories..."
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$BOT_HOME/logs"

chown -R "$BOT_USER:$BOT_USER" "$BOT_HOME"
chown -R "$BOT_USER:$BOT_USER" "$LOG_DIR"
chmod 750 "$CONFIG_DIR"
chmod 750 "$LOG_DIR"
echo "✅ Directories configured"

# Step 3: Install systemd service
echo ""
echo "3️⃣  Installing systemd service..."
cp "$(dirname "$0")/arbitrage-bot.service" "$SYSTEMD_DIR/$BOT_SERVICE.service"
chmod 644 "$SYSTEMD_DIR/$BOT_SERVICE.service"
echo "✅ Service file installed"

# Step 4: Create environment file template
echo ""
echo "4️⃣  Creating environment file..."
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
# Or for Slack:
# WEBHOOK_TYPE=slack
# WEBHOOK_URL=https://hooks.slack.com/services/...
# Or for Telegram:
# WEBHOOK_TYPE=telegram
# WEBHOOK_TOKEN=<bot-token>:<chat-id>

# Logging
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:password@localhost/arbitrage

EOF
    chown "$BOT_USER:$BOT_USER" "$CONFIG_DIR/bot.env"
    chmod 600 "$CONFIG_DIR/bot.env"
    echo "✅ Environment file created at: $CONFIG_DIR/bot.env"
    echo "   ⚠️  EDIT THIS FILE with your API keys!"
else
    echo "⚠️  Environment file already exists: $CONFIG_DIR/bot.env"
fi

# Step 5: Reload systemd
echo ""
echo "5️⃣  Reloading systemd daemon..."
systemctl daemon-reload
echo "✅ Systemd reloaded"

# Step 6: Enable service
echo ""
echo "6️⃣  Enabling service..."
systemctl enable "$BOT_SERVICE.service"
echo "✅ Service enabled (auto-start on boot)"

echo ""
echo "===================================="
echo "✅ DEPLOYMENT COMPLETE!"
echo "===================================="
echo ""
echo "📚 NEXT STEPS:"
echo ""
echo "1. Edit configuration:"
echo "   nano $CONFIG_DIR/bot.env"
echo ""
echo "2. Test paper trading first:"
echo "   systemctl start $BOT_SERVICE"
echo "   journalctl -u $BOT_SERVICE -f  # Watch logs"
echo ""
echo "3. Check status:"
echo "   systemctl status $BOT_SERVICE"
echo ""
echo "4. After 24-48 hours of successful paper trading:"
echo "   - Edit $CONFIG_DIR/bot.env"
echo "   - Change: TRADING_MODE=real"
echo "   - Restart: systemctl restart $BOT_SERVICE"
echo ""
echo "5. View logs:"
echo "   journalctl -u $BOT_SERVICE -n 100 -f"
echo ""
echo "📖 Useful Commands:"
echo "   systemctl start $BOT_SERVICE     # Start service"
echo "   systemctl stop $BOT_SERVICE      # Stop service"
echo "   systemctl restart $BOT_SERVICE   # Restart service"
echo "   systemctl status $BOT_SERVICE    # Check status"
echo "   journalctl -u $BOT_SERVICE -f    # Follow logs"
echo ""
