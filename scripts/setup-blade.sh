#!/bin/bash
set -e

MASTER_HOST="piblade-master.local"
MASTER_PORT=3000
AGENT_PORT=3001

echo "==============================="
echo "  Pi-Blade — Blade Setup"
echo "==============================="
echo ""

# Prompt for blade name
while true; do
  read -rp "Enter blade name (e.g. blade1): " BLADE_NAME
  if [[ "$BLADE_NAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    break
  fi
  echo "Invalid name. Use alphanumeric characters and hyphens only."
done

BLADE_HOSTNAME="${BLADE_NAME}.local"
echo ""
echo "Setting up blade: ${BLADE_NAME} (${BLADE_HOSTNAME})"
echo ""

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "Unsupported OS"
  exit 1
fi

# Install Docker
if ! command -v docker &> /dev/null; then
  echo "[1/5] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
else
  echo "[1/5] Docker already installed"
fi

# Install Bun
if ! command -v bun &> /dev/null; then
  echo "[2/5] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "[2/5] Bun already installed"
fi

# Install avahi-daemon for mDNS
if ! command -v avahi-daemon &> /dev/null; then
  echo "[3/5] Installing avahi-daemon..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq avahi-daemon avahi-utils
else
  echo "[3/5] avahi-daemon already installed"
fi

# Set hostname
echo "[4/5] Setting hostname to ${BLADE_NAME}..."
sudo hostnamectl set-hostname "$BLADE_NAME"
sudo systemctl restart avahi-daemon

# Install and start blade agent
echo "[5/5] Installing blade agent..."

AGENT_DIR="/opt/pi-blade/blade-agent"
sudo mkdir -p "$AGENT_DIR"

# Download blade agent from master
curl -fsSL "http://${MASTER_HOST}:${MASTER_PORT}/api/blade-agent/bundle" -o /tmp/blade-agent.tar.gz 2>/dev/null || true

# If bundle not available, clone from repo
if [ ! -f /tmp/blade-agent.tar.gz ] || [ ! -s /tmp/blade-agent.tar.gz ]; then
  echo "Downloading blade agent source..."
  sudo git clone --depth 1 "http://${MASTER_HOST}:${MASTER_PORT}/repo" "$AGENT_DIR" 2>/dev/null || {
    echo "Note: Could not download agent bundle. Manual setup may be required."
    echo "Copy the blade-agent package to ${AGENT_DIR}"
  }
fi

# Create systemd service
sudo tee /etc/systemd/system/pi-blade-agent.service > /dev/null <<EOF
[Unit]
Description=Pi-Blade Agent
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=$USER
WorkingDirectory=${AGENT_DIR}
ExecStart=$(which bun || echo "$HOME/.bun/bin/bun") run start
Restart=always
RestartSec=5
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable pi-blade-agent
sudo systemctl start pi-blade-agent

# Register with master
echo ""
echo "Registering with master..."
curl -fsSL -X POST "http://${MASTER_HOST}:${MASTER_PORT}/api/blades/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${BLADE_NAME}\", \"hostname\": \"${BLADE_HOSTNAME}\"}" \
  2>/dev/null && echo "Registered successfully!" || echo "Could not reach master. Agent will retry on startup."

echo ""
echo "==============================="
echo "  Setup complete!"
echo "  Blade: ${BLADE_NAME}"
echo "  Hostname: ${BLADE_HOSTNAME}"
echo "  Agent port: ${AGENT_PORT}"
echo "==============================="
