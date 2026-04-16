#!/bin/bash
set -e

MASTER_NAME="piblade-master"
MASTER_PORT=3000
REGISTRY_PORT=5000
STEP=1
STEPS=7

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

# Ensure git is available for clone + re-exec
if ! command -v git &> /dev/null; then
  echo "Installing git..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq git
fi

# Clone/update pi-blade repo and re-exec from latest version
INSTALL_DIR="/opt/pi-blade"
REPO_URL="https://github.com/MT-ZD/pi-blade.git"
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER:$USER" "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

if [ "${PI_BLADE_REEXEC:-0}" != "1" ]; then
  export PI_BLADE_REEXEC=1
  exec bash "$INSTALL_DIR/scripts/setup-master.sh"
fi

# Install Docker
if ! command -v docker &> /dev/null; then
  echo "[${STEP}/${STEPS}] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  DOCKER_GROUP_ADDED=1
else
  echo "[${STEP}/${STEPS}] Docker already installed"
fi
STEP=$((STEP + 1))

# Use sg to run docker commands with group membership if just added
if [ "${DOCKER_GROUP_ADDED:-0}" = "1" ]; then
  docker() { sg docker -c "docker $*"; }
fi

# Install Bun
if ! command -v bun &> /dev/null; then
  echo "[${STEP}/${STEPS}] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "[${STEP}/${STEPS}] Bun already installed"
fi
STEP=$((STEP + 1))

# Install nginx
if ! command -v nginx &> /dev/null; then
  echo "[${STEP}/${STEPS}] Installing nginx..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq nginx
else
  echo "[${STEP}/${STEPS}] nginx already installed"
fi
STEP=$((STEP + 1))

# Install avahi-daemon for mDNS
if ! command -v avahi-daemon &> /dev/null; then
  echo "[${STEP}/${STEPS}] Installing avahi-daemon..."
  sudo apt-get install -y -qq avahi-daemon avahi-utils
else
  echo "[${STEP}/${STEPS}] avahi-daemon already installed"
fi
STEP=$((STEP + 1))

# Install cloudflared
if ! command -v cloudflared &> /dev/null; then
  echo "[${STEP}/${STEPS}] Installing cloudflared..."
  ARCH=$(dpkg --print-architecture)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
else
  echo "[${STEP}/${STEPS}] cloudflared already installed"
fi
STEP=$((STEP + 1))

# Set hostname
echo "[${STEP}/${STEPS}] Setting hostname to ${MASTER_NAME}..."
sudo hostnamectl set-hostname "$MASTER_NAME"
if ! grep -q "127.0.1.1.*${MASTER_NAME}" /etc/hosts; then
  sudo sed -i "/127\.0\.1\.1/d" /etc/hosts
  echo "127.0.1.1 ${MASTER_NAME}" | sudo tee -a /etc/hosts > /dev/null
fi
sudo systemctl restart avahi-daemon

STEP=$((STEP + 1))

# Start local Docker registry
echo "[${STEP}/${STEPS}] Starting local Docker registry..."
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

STEP=$((STEP + 1))

# Install Pi-Blade dependencies + build
echo "[${STEP}/${STEPS}] Installing Pi-Blade..."
cd "$INSTALL_DIR"
bun install
cd "$INSTALL_DIR/packages/web-ui" && bun run build && cd "$INSTALL_DIR"

# Allow passwordless sudo for nginx and systemctl (needed by pi-blade services)
SUDOERS_FILE="/etc/sudoers.d/pi-blade"
if [ ! -f "$SUDOERS_FILE" ]; then
  sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
$USER ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/nginx/conf.d/*
$USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx
$USER ALL=(ALL) NOPASSWD: /usr/bin/nginx
$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart pi-blade-*
$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart pi-blade-*
EOF
  sudo chmod 0440 "$SUDOERS_FILE"
fi

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
