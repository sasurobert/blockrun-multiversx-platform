#!/usr/bin/env bash
set -e

echo "=================================================="
echo "  BlockRun MultiversX Hetzner Auto-Deployment     "
echo "=================================================="

# 1. Detect or ask for public IP
DETECTED_IP=$(curl -s https://api.ipify.org || echo "")
if [ -n "$1" ]; then
    SERVER_IP="$1"
elif [ -n "$DETECTED_IP" ]; then
    SERVER_IP="$DETECTED_IP"
else
    read -p "Enter your Hetzner public IP: " SERVER_IP
fi

DOMAIN="${SERVER_IP}.sslip.io"
echo "-> Detected Server IP: $SERVER_IP"
echo "-> Automated SSL Domain: $DOMAIN"

# 2. Check Docker & Docker Compose
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

# 3. Create production .env file
if [ ! -f .env ]; then
    echo "Creating .env configuration..."
    cat << ENV_EOF > .env
PORT=3000
FACILITATOR_PORT=3402
MULTIVERSX_NETWORK=multiversx:D
MULTIVERSX_API_URL=https://devnet-api.multiversx.com
USDC_TOKEN_IDENTIFIER=USDC-350c4e
SERVER_DOMAIN=${DOMAIN}
GEMINI_API_KEY=${GEMINI_API_KEY:-""}
ENV_EOF
    chmod 600 .env
else
    # Update SERVER_DOMAIN if needed
    if grep -q "SERVER_DOMAIN=" .env; then
        sed -i "s/SERVER_DOMAIN=.*/SERVER_DOMAIN=${DOMAIN}/" .env 2>/dev/null || sed -i '' "s/SERVER_DOMAIN=.*/SERVER_DOMAIN=${DOMAIN}/" .env
    else
        echo "SERVER_DOMAIN=${DOMAIN}" >> .env
    fi
fi

# 4. Build and run containers
echo "-> Building and starting Docker containers with automatic HTTPS (Caddy)..."
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build

echo ""
echo "=================================================="
echo "  Deployment Complete! System is Online!          "
echo "=================================================="
echo "WebUI & AI Gateway: https://${DOMAIN}"
echo "Gateway Health:     https://${DOMAIN}/health"
echo "x402 Discovery:     https://${DOMAIN}/.well-known/x402"
echo "Fleet Status API:   https://${DOMAIN}/api/v1/fleet/status"
echo ""
echo "For Vercel Deployment, set this Environment Variable in Vercel:"
echo "VITE_API_BASE_URL=https://${DOMAIN}"
echo "=================================================="
