<script>
	import '../app.css';

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
</script>

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
	</nav>
	<main class="content">
		{@render children()}
	</main>
</div>

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
