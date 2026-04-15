<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let alerts = $state<any[]>([]);

	onMount(async () => { alerts = await api.alerts.list(); });
</script>

<h1 class="mb-2">Alerts</h1>

<div class="card">
	<table>
		<thead>
			<tr><th>Type</th><th>Blade</th><th>Message</th><th>Discord</th><th>Time</th></tr>
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
					<td>{a.message}</td>
					<td>{a.discord_sent ? 'Sent' : '-'}</td>
					<td class="text-muted">{new Date(a.timestamp).toLocaleString()}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if alerts.length === 0}
		<div class="text-muted" style="padding:1rem">No alerts</div>
	{/if}
</div>
