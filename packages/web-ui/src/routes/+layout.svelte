<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { api, setToken } from '$lib/api';

	const nav = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/blades', label: 'Blades' },
		{ href: '/repos', label: 'Repos' },
		{ href: '/projects', label: 'Projects' },
		{ href: '/routing', label: 'Routing' },
		{ href: '/envs', label: 'Environments' },
		{ href: '/deploys', label: 'Deploys' },
		{ href: '/alerts', label: 'Alerts' },
		{ href: '/settings', label: 'Settings' }
	];

	let { children } = $props();
	let authed = $state(false);
	let authEnabled = $state(false);
	let loading = $state(true);
	let password = $state('');
	let loginError = $state('');

	onMount(async () => {
		try {
			const status = await api.auth.status();
			authEnabled = status.enabled;
			if (!authEnabled) {
				authed = true;
			} else {
				// Try existing token
				try {
					await api.blades.list();
					authed = true;
				} catch {
					authed = false;
				}
			}
		} catch {
			authed = true; // auth endpoint failed, assume no auth
		}
		loading = false;

		window.addEventListener('pi-blade-unauthorized', () => {
			authed = false;
		});
	});

	async function login() {
		loginError = '';
		try {
			const res = await api.auth.login(password);
			setToken(res.token);
			authed = true;
			password = '';
		} catch {
			loginError = 'Invalid password';
		}
	}

	async function logout() {
		try { await api.auth.logout(); } catch {}
		setToken(null);
		authed = false;
	}
</script>

{#if loading}
	<div style="display:flex;align-items:center;justify-content:center;height:100vh">
		<span class="text-muted">Loading...</span>
	</div>
{:else if !authed}
	<div style="display:flex;align-items:center;justify-content:center;height:100vh">
		<div class="card" style="width:320px">
			<h2 style="margin-bottom:1.5rem;text-align:center">Pi-Blade</h2>
			<form onsubmit={(e) => { e.preventDefault(); login(); }}>
				<div style="margin-bottom:1rem">
					<input type="password" bind:value={password} placeholder="Password" autofocus
						style="width:100%" />
				</div>
				{#if loginError}
					<div style="color:var(--danger);font-size:0.8rem;margin-bottom:0.75rem">{loginError}</div>
				{/if}
				<button type="submit" style="width:100%">Login</button>
			</form>
		</div>
	</div>
{:else}
	<div class="layout">
		<nav class="sidebar">
			<div class="logo">
				<h2>Pi-Blade</h2>
			</div>
			<ul>
				{#each nav as item}
					<li>
						<a href={item.href}>{item.label}</a>
					</li>
				{/each}
			</ul>
			{#if authEnabled}
				<div style="padding:0.75rem 1.25rem;margin-top:auto;border-top:1px solid var(--border)">
					<button class="secondary" style="width:100%;font-size:0.75rem" onclick={logout}>Logout</button>
				</div>
			{/if}
		</nav>
		<main class="content">
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.layout {
		display: flex;
		min-height: 100vh;
	}

	.sidebar {
		width: 220px;
		background: var(--bg-card);
		border-right: 1px solid var(--border);
		padding: 1.5rem 0;
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.logo {
		padding: 0 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1rem;
	}

	ul {
		list-style: none;
	}

	li a {
		display: block;
		padding: 0.6rem 1.25rem;
		color: var(--text-muted);
		font-size: 0.875rem;
		transition: all 0.15s;
	}

	li a:hover {
		color: var(--text);
		background: var(--bg-hover);
	}

	.content {
		margin-left: 220px;
		padding: 2rem;
		flex: 1;
	}
</style>
