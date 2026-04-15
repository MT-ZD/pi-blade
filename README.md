> **Disclaimer:** This project is vibe coded. I take no responsibility for anyone using it. Use at your own risk.

# Pi-Blade

Raspberry Pi Docker deployment system. One master orchestrates a fleet of "blades" running containerized web services.

## How It Works

- **Master** (single Pi) runs the API server, polls git repos for changes, builds Docker images, pushes them to a local registry, and deploys to blades via HTTP. Nginx handles subdomain-based routing with load balancing across replicas.
- **Blades** (any number of Pis) run a lightweight agent that receives deploy/rollback commands and reports metrics.
- **Routing** goes through a Cloudflare Tunnel to master's nginx, which proxies to upstream blade containers based on subdomain.

```
Cloudflare Tunnel → master nginx → blade containers
                         ↑
                    SQLite DB (routes, deploys, blades)
```

## Tech Stack

- **Runtime:** Bun (TypeScript)
- **Web UI:** SvelteKit
- **Database:** SQLite
- **Reverse Proxy:** nginx (config generated from DB)
- **Containers:** Docker (single container per project, no Compose)
- **Registry:** Local Docker registry on master (port 5000)
- **Networking:** avahi/mDNS for `.local` hostnames
- **Hardware:** Raspberry Pi 4 and 5

## Project Structure

```
pi-blade/
├── packages/
│   ├── master/        # API server, git poller, builder, deployer, monitor
│   ├── blade-agent/   # Runs on every Pi, receives deploy commands
│   ├── web-ui/        # SvelteKit dashboard
│   └── shared/        # Shared types, constants, utils
├── scripts/
│   ├── setup-master.sh
│   └── setup-blade.sh
└── package.json       # Bun workspace root
```

## Setup

### Master

```bash
./scripts/setup-master.sh
```

The setup script installs all dependencies (Docker, Bun, nginx, avahi) and runs `bun install` automatically.

### Adding a Blade

On the new Pi:

```bash
curl http://piblade-master.local:3000/setup/blade | bash
```

The setup script is interactive and will prompt for the blade's name.

## Development

```bash
bun install                         # Install all workspace dependencies
bun run --filter master dev         # Run master services
bun run --filter blade-agent dev    # Run blade agent
bun run --filter web-ui dev         # Run SvelteKit UI
```

## Deploy Flow

1. Git poller detects new commit on configured branch
2. Master clones repo, builds Docker image
3. Image pushed to local registry
4. Each assigned blade pulls image and starts container
5. Nginx config regenerated if routes changed
6. Last 5 image tags kept per project for one-click rollback

## GitHub Commit Statuses

Pi-Blade can post deploy statuses back to GitHub commits (pending, success, failure).

1. Create a GitHub personal access token with `repo:status` scope
2. Configure it:
   ```bash
   curl -X PUT http://piblade-master.local:3000/api/settings/github-token \
     -H "Content-Type: application/json" \
     -d '{"token": "ghp_..."}'
   ```
3. Each deploy will now post status checks as `pi-blade/<project-name>`

Non-GitHub repos are unaffected — status posting is silently skipped.

## Key Concepts

- **Blade** — a Raspberry Pi running the blade-agent, registered with master
- **Project** — a deployable unit within a repo (supports monorepos via path config)
- **Upstream** — a route's set of blade:port targets for nginx load balancing
- **Env Group** — named set of environment variables (prod/staging/dev) assigned per project

## API

### Blade Agent (port 3001)

| Endpoint | Method | Description |
|---|---|---|
| `/deploy` | POST | Pull image, stop old container, start new |
| `/rollback` | POST | Revert to previous image tag |
| `/status` | GET | Running containers and health |
| `/metrics` | GET | CPU, RAM, disk, per-container stats |
| `/register` | POST | Initial handshake with master |

### Settings

| Endpoint | Method | Description |
|---|---|---|
| `/api/settings/github-token` | GET | Check if GitHub token is configured |
| `/api/settings/github-token` | PUT | Set GitHub token |
| `/api/settings/github-token` | DELETE | Remove GitHub token |
| `/api/settings/discord-webhook` | GET | Get Discord webhook URL |
| `/api/settings/discord-webhook` | PUT | Set Discord webhook URL |
