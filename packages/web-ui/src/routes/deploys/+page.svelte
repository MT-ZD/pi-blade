<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let deploys = $state<any[]>([]);

	onMount(async () => { deploys = await api.deploys.list(); });

	async function rollback(d: any) {
		if (!confirm(`Rollback "${d.project_name}" on ${d.blade_name} to ${d.image_tag}?`)) return;
		await api.rollback({ projectId: d.project_id, bladeId: d.blade_id, imageTag: d.image_tag });
		deploys = await api.deploys.list();
	}
</script>

<h1 class="mb-2">Deploy History</h1>

<div class="card">
	<table>
		<thead>
			<tr><th>Project</th><th>Blade</th><th>Image</th><th>Status</th><th>Time</th><th></th></tr>
		</thead>
		<tbody>
			{#each deploys as d}
				<tr>
					<td>{d.project_name}</td>
					<td>{d.blade_name}</td>
					<td><code>{d.image_tag}</code></td>
					<td><span class="badge {d.status}">{d.status}</span></td>
					<td class="text-muted">{new Date(d.timestamp).toLocaleString()}</td>
					<td>
						{#if d.status === 'running'}
							<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={() => rollback(d)}>Rollback</button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if deploys.length === 0}
		<div class="text-muted" style="padding:1rem">No deploys yet</div>
	{/if}
</div>
