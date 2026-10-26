#!/bin/bash
# install-deno.sh - Install Deno runtime required for bot

set -e

echo "📦 Installing Deno Runtime"
echo "=========================="

# Check if Deno is already installed
if command -v deno &> /dev/null; then
    echo "✅ Deno is already installed:"
    deno --version
    exit 0
fi

# Detect OS
OS=$(uname -s)
ARCH=$(uname -m)

echo "🔍 Detected: $OS ($ARCH)"
echo ""

case "$OS" in
    Linux)
        # Install curl if needed
        if ! command -v curl &> /dev/null; then
            echo "📥 Installing curl..."
            if command -v apt-get &> /dev/null; then
                apt-get update
                apt-get install -y curl
            elif command -v yum &> /dev/null; then
                yum install -y curl
            fi
        fi

        echo "📥 Downloading Deno..."
        curl -fsSL https://deno.land/x/install/install.sh | sh

        # Add to PATH
        echo ""
        echo "⚙️  Setting up PATH..."
        export PATH="$HOME/.deno/bin:$PATH"

        # Try to update shell config files
        for rc in ~/.bashrc ~/.zshrc ~/.profile; do
            if [ -f "$rc" ]; then
                if ! grep -q "deno/bin" "$rc"; then
                    echo 'export PATH="$HOME/.deno/bin:$PATH"' >> "$rc"
                fi
            fi
        done

        echo "✅ Deno installed to ~/.deno/bin"
        echo ""
        echo "⚠️  Add to PATH manually if not using bash/zsh:"
        echo "   export PATH=\"\$HOME/.deno/bin:\$PATH\""
        ;;

    Darwin)
        # macOS installation using Homebrew
        if ! command -v brew &> /dev/null; then
            echo "❌ Homebrew not found. Install from: https://brew.sh"
            exit 1
        fi

        echo "📥 Installing Deno via Homebrew..."
        brew install deno
        echo "✅ Deno installed via Homebrew"
        ;;

    *)
        echo "❌ Unsupported OS: $OS"
        echo "Install Deno manually from: https://deno.land"
        exit 1
        ;;
esac

echo ""
echo "=========================="
deno --version
echo "=========================="
echo "✅ Installation complete!"
