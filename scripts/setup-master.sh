#!/bin/bash
set -e

MASTER_NAME="piblade-master"
MASTER_PORT=3000
REGISTRY_PORT=5000

echo "==============================="
echo "  Pi-Blade — Master Setup"
echo "==============================="
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
  echo "[1/7] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  DOCKER_GROUP_ADDED=1
else
  echo "[1/7] Docker already installed"
fi

# Use sg to run docker commands with group membership if just added
if [ "${DOCKER_GROUP_ADDED:-0}" = "1" ]; then
  docker() { sg docker -c "docker $*"; }
fi

# Install Bun
if ! command -v bun &> /dev/null; then
  echo "[2/7] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "[2/7] Bun already installed"
fi

# Install nginx
if ! command -v nginx &> /dev/null; then
  echo "[3/7] Installing nginx..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq nginx
else
  echo "[3/7] nginx already installed"
fi

# Install avahi-daemon for mDNS
if ! command -v avahi-daemon &> /dev/null; then
  echo "[4/7] Installing avahi-daemon..."
  sudo apt-get install -y -qq avahi-daemon avahi-utils
else
  echo "[4/7] avahi-daemon already installed"
fi

# Install git
if ! command -v git &> /dev/null; then
  echo "Installing git..."
  sudo apt-get install -y -qq git
fi

# Set hostname
echo "[5/7] Setting hostname to ${MASTER_NAME}..."
sudo hostnamectl set-hostname "$MASTER_NAME"
if ! grep -q "127.0.1.1.*${MASTER_NAME}" /etc/hosts; then
  sudo sed -i "/127\.0\.1\.1/d" /etc/hosts
  echo "127.0.1.1 ${MASTER_NAME}" | sudo tee -a /etc/hosts > /dev/null
fi
sudo systemctl restart avahi-daemon

# Start local Docker registry
echo "[6/7] Starting local Docker registry..."
if ! docker ps --format '{{.Names}}' | grep -q '^pi-blade-registry$'; then
  docker run -d \
    --name pi-blade-registry \
    --restart unless-stopped \
    -p ${REGISTRY_PORT}:5000 \
    registry:2
  echo "Registry started on port ${REGISTRY_PORT}"
else
  echo "Registry already running"
fi

# Configure Docker to allow insecure local registry
DAEMON_JSON="/etc/docker/daemon.json"
if [ ! -f "$DAEMON_JSON" ] || ! grep -q "localhost:${REGISTRY_PORT}" "$DAEMON_JSON"; then
  echo "Configuring Docker for local registry..."
  sudo mkdir -p /etc/docker
  sudo tee "$DAEMON_JSON" > /dev/null <<EOF
{
  "insecure-registries": ["localhost:${REGISTRY_PORT}", "${MASTER_NAME}.local:${REGISTRY_PORT}"]
}
EOF
  sudo systemctl restart docker
fi

# Install Pi-Blade
echo "[7/7] Installing Pi-Blade..."

INSTALL_DIR="/opt/pi-blade"
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER:$USER" "$INSTALL_DIR"

REPO_URL="https://github.com/MT-ZD/pi-blade.git"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# Re-exec from repo copy so the rest of the script is always up to date
if [ "${PI_BLADE_REEXEC:-0}" != "1" ]; then
  export PI_BLADE_REEXEC=1
  exec bash "$INSTALL_DIR/scripts/setup-master.sh"
fi

cd "$INSTALL_DIR"
bun install
cd "$INSTALL_DIR/packages/web-ui" && bun run build && cd "$INSTALL_DIR"

# Configure nginx
sudo tee /etc/nginx/conf.d/pi-blade.conf > /dev/null <<EOF
# Pi-Blade managed config — will be regenerated automatically
# Initial empty config
EOF

sudo tee /etc/nginx/conf.d/pi-blade-dashboard.conf > /dev/null <<EOF
server {
    listen 80;
    server_name ${MASTER_NAME}.local;

    location /api {
        proxy_pass http://127.0.0.1:${MASTER_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

# Remove default nginx site that catches all requests
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Create systemd services
sudo tee /etc/systemd/system/pi-blade-master.service > /dev/null <<EOF
[Unit]
Description=Pi-Blade Master
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=$USER
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which bun || echo "$HOME/.bun/bin/bun") run --cwd packages/master start
Restart=always
RestartSec=5
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pi-blade-agent.service > /dev/null <<EOF
[Unit]
Description=Pi-Blade Agent (Master as Blade)
After=network.target docker.service pi-blade-master.service
Requires=docker.service

[Service]
Type=simple
User=$USER
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which bun || echo "$HOME/.bun/bin/bun") run --cwd packages/blade-agent start
Restart=always
RestartSec=5
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pi-blade-web.service > /dev/null <<EOF
[Unit]
Description=Pi-Blade Web UI
After=network.target pi-blade-master.service

[Service]
Type=simple
User=$USER
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which bun || echo "$HOME/.bun/bin/bun") run --cwd packages/web-ui start
Restart=always
RestartSec=5
Environment=PORT=5173
Environment=ORIGIN=http://${MASTER_NAME}.local
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable pi-blade-master pi-blade-agent pi-blade-web
sudo systemctl restart pi-blade-master pi-blade-agent pi-blade-web

echo ""
echo "==============================="
echo "  Master setup complete!"
echo "  Hostname: ${MASTER_NAME}.local"
echo "  Dashboard: http://${MASTER_NAME}.local"
echo "  API: http://${MASTER_NAME}.local/api"
echo "  Registry: localhost:${REGISTRY_PORT}"
echo ""
echo "  Next: Set up Cloudflare Tunnel"
echo "  Run: cloudflared tunnel login"
echo "==============================="
