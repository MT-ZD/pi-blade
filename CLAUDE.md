# Pi-Blade

Raspberry Pi Docker deployment system. One master orchestrates fleet of "blades" running containerized web services.

## Architecture

- **Master** (piblade-master.local): API server, git poller, Docker builder, deployer, nginx manager, resource monitor, SvelteKit UI, local Docker registry, SQLite DB
- **Blades**: lightweight agent on each Pi (including master-as-blade), receives deploy commands, reports metrics
- **Routing**: Cloudflare Tunnel → master nginx → upstream groups (load-balanced replicas across blades), subdomain-based routing
- **Deploys**: git change detected → master builds image → pushes to local registry → blades pull + run → nginx reload
- **Rollback**: last 5 image tags kept per project, one-click revert

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **Web UI**: SvelteKit
- **Database**: SQLite
- **Reverse proxy**: nginx (config generated from DB)
- **Containers**: Docker, single container per project
- **Registry**: local Docker registry on master (port 5000)
- **Networking**: avahi/mDNS for .local hostnames
- **Target hardware**: Raspberry Pi 4 and 5

## Project Structure

```
pi-blade/
├── packages/
│   ├── master/           # API server, poller, builder, deployer, monitor
│   ├── blade-agent/      # Blade agent service (runs on every Pi)
│   ├── web-ui/           # SvelteKit dashboard
│   └── shared/           # Shared types, constants, utils
├── scripts/
│   ├── setup-master.sh
│   └── setup-blade.sh    # Interactive: prompts for blade name
├── package.json          # Bun workspace root
└── bunfig.toml
```

## Key Concepts

- **Blade**: a Raspberry Pi running the blade-agent, registered with master
- **Project**: a deployable unit within a repo (supports monorepos via path config)
- **Upstream**: a route's set of blade:port targets for nginx load balancing
- **Environment**: per-project env var set (production/staging/development), one active at deploy time

## Data Model

Core tables: blades, repos (with optional encrypted ssh_key), projects (with active_environment), project_environments, project_env_vars, deploys, routes, upstreams, alerts, settings

## Blade Agent API

- `POST /deploy` — pull image from master registry, stop old container, start new
- `POST /rollback` — revert to previous image tag
- `POST /update` — git pull + bun install + self-restart
- `GET /status` — running containers, health, version
- `GET /version` — current git SHA
- `GET /metrics` — CPU, RAM, disk, per-container stats
- `POST /register` — initial handshake with master (includes version)

## Conventions

- All backend code in TypeScript, run with Bun
- Shell operations via Bun's shell API (`Bun.spawn` / `Bun.$`)
- No Docker Compose for deployed projects — single containers only
- Master builds all images — blades never build
- Nginx config regenerated from SQLite on routing changes
- Resource metrics collected every 30s from blade agents
- Alerts: UI notifications + optional Discord webhook
- Blade setup is interactive (prompts for name), not flag-based

## Commands

```bash
bun install              # Install all workspace dependencies
bun run --filter master  # Run master services (dev)
bun run --filter blade-agent  # Run blade agent (dev)
bun run --filter web-ui dev   # Run SvelteKit UI (dev)
```
