<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let alerts = $state<any[]>([]);

	onMount(async () => { await refresh(); });

	async function refresh() { alerts = await api.alerts.list(); }

	async function dismiss(id: number) {
		await api.alerts.remove(id);
		await refresh();
	}

	async function clearAll() {
		if (!confirm('Clear all alerts?')) return;
		await api.alerts.clearAll();
		await refresh();
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Alerts</h1>
	{#if alerts.length > 0}
		<button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={clearAll}>Clear All</button>
	{/if}
</div>

<div class="card">
	<table>
		<thead>
			<tr><th>Type</th><th>Blade</th><th>Message</th><th>Discord</th><th>Time</th><th></th></tr>
		</thead>
		<tbody>
			{#each alerts as a}
				<tr>
					<td>
						<span class="badge {a.type === 'blade_down' ? 'offline' : a.type === 'deploy_failed' ? 'failed' : 'degraded'}">
							{a.type.replace('_', ' ')}
						</span>
					</td>
					<td>{a.blade_name || '-'}</td>
					<td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={a.message}>{a.message}</td>
					<td>{a.discord_sent ? 'Sent' : '-'}</td>
					<td class="text-muted">{new Date(a.timestamp + 'Z').toLocaleString()}</td>
					<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => dismiss(a.id)}>x</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if alerts.length === 0}
		<div class="text-muted" style="padding:1rem">No alerts</div>
	{/if}
</div>
