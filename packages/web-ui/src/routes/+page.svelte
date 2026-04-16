<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let blades = $state<any[]>([]);
	let metrics = $state<Record<string, any>>({});
	let alerts = $state<any[]>([]);
	let deploys = $state<any[]>([]);

	onMount(async () => {
		const [b, m, a, d] = await Promise.all([
			api.blades.list(),
			api.metrics.all(),
			api.alerts.list(),
			api.deploys.list()
		]);
		blades = b;
		metrics = m;
		alerts = a.slice(0, 5);
		deploys = d.slice(0, 5);
	});

	function usageClass(pct: number): string {
		if (pct > 80) return 'crit';
		if (pct > 60) return 'warn';
		return 'ok';
	}
</script>

<h1 class="mb-2">Dashboard</h1>

<div class="grid grid-4 mb-2">
	<div class="card">
		<div class="text-muted text-sm">Blades Online</div>
		<div style="font-size:2rem;font-weight:700">{blades.filter(b => b.status === 'online').length}/{blades.length}</div>
	</div>
	<div class="card">
		<div class="text-muted text-sm">Degraded</div>
		<div style="font-size:2rem;font-weight:700;color:var(--warning)">{blades.filter(b => b.status === 'degraded').length}</div>
	</div>
	<div class="card">
		<div class="text-muted text-sm">Offline</div>
		<div style="font-size:2rem;font-weight:700;color:var(--danger)">{blades.filter(b => b.status === 'offline').length}</div>
	</div>
	<div class="card">
		<div class="text-muted text-sm">Recent Alerts</div>
		<div style="font-size:2rem;font-weight:700">{alerts.length}</div>
	</div>
</div>

<div class="grid grid-2 mb-2">
	<div class="card">
		<h3 class="mb-2">Blade Resources</h3>
		{#each blades as blade}
			{@const m = metrics[blade.id]}
			<div class="mb-1">
				<div class="flex justify-between items-center mb-1">
					<span>{blade.name}</span>
					<span class="badge {blade.status}">{blade.status}</span>
				</div>
				{#if m}
					<div class="text-sm text-muted mb-1">
						CPU: {m.cpuPercent}% | RAM: {m.memoryPercent}% | Disk: {m.diskPercent}%
					</div>
					<div class="progress-bar mb-1">
						<div class="fill {usageClass(m.cpuPercent)}" style="width:{m.cpuPercent}%"></div>
					</div>
				{:else}
					<div class="text-sm text-muted">No metrics</div>
				{/if}
			</div>
		{/each}
		{#if blades.length === 0}
			<div class="text-muted">No blades registered</div>
		{/if}
	</div>

	<div class="card">
		<h3 class="mb-2">Recent Deploys</h3>
		{#if deploys.length > 0}
			<table>
				<thead>
					<tr><th>Project</th><th>Blade</th><th>Status</th></tr>
				</thead>
				<tbody>
					{#each deploys as d}
						<tr>
							<td>{d.project_name}</td>
							<td>{d.blade_name}</td>
							<td><span class="badge {d.status}">{d.status}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="text-muted">No deploys yet</div>
		{/if}
	</div>
</div>

<div class="card">
	<h3 class="mb-2">Recent Alerts</h3>
	{#if alerts.length > 0}
		<table>
			<thead>
				<tr><th>Type</th><th>Message</th><th>Time</th></tr>
			</thead>
			<tbody>
				{#each alerts as a}
					<tr>
						<td><span class="badge {a.type === 'blade_down' ? 'offline' : a.type === 'deploy_failed' ? 'failed' : 'degraded'}">{a.type}</span></td>
						<td>{a.message}</td>
						<td class="text-muted">{new Date(a.timestamp + 'Z').toLocaleString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div class="text-muted">No alerts</div>
	{/if}
</div>
