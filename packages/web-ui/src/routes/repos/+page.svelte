<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let repos = $state<any[]>([]);
	let showForm = $state(false);
	let form = $state({ url: '', branch: 'main', pollInterval: 60, isMonorepo: false });

	onMount(async () => { await refresh(); });

	async function refresh() { repos = await api.repos.list(); }

	async function addRepo() {
		await api.repos.create(form);
		form = { url: '', branch: 'main', pollInterval: 60, isMonorepo: false };
		showForm = false;
		await refresh();
	}

	async function removeRepo(id: number) {
		if (!confirm('Delete this repo and all its projects?')) return;
		await api.repos.remove(id);
		await refresh();
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Repositories</h1>
	<button onclick={() => showForm = !showForm}>{showForm ? 'Cancel' : 'Add Repo'}</button>
</div>

{#if showForm}
	<div class="card mb-2">
		<div class="grid grid-2 gap-2 mb-1">
			<div>
				<label class="text-sm text-muted">Repository URL</label>
				<input bind:value={form.url} placeholder="https://github.com/user/repo.git" />
			</div>
			<div>
				<label class="text-sm text-muted">Branch</label>
				<input bind:value={form.branch} />
			</div>
			<div>
				<label class="text-sm text-muted">Poll Interval (seconds)</label>
				<input type="number" bind:value={form.pollInterval} />
			</div>
			<div class="flex items-center gap-1" style="padding-top:1.2rem">
				<input type="checkbox" bind:checked={form.isMonorepo} id="monorepo" style="width:auto" />
				<label for="monorepo" class="text-sm">Monorepo</label>
			</div>
		</div>
		<button onclick={addRepo}>Save</button>
	</div>
{/if}

<div class="card">
	<table>
		<thead>
			<tr><th>URL</th><th>Branch</th><th>Poll</th><th>Monorepo</th><th></th></tr>
		</thead>
		<tbody>
			{#each repos as repo}
				<tr>
					<td>{repo.url}</td>
					<td>{repo.branch}</td>
					<td>{repo.poll_interval}s</td>
					<td>{repo.is_monorepo ? 'Yes' : 'No'}</td>
					<td><button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeRepo(repo.id)}>Delete</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if repos.length === 0}
		<div class="text-muted" style="padding:1rem">No repositories linked</div>
	{/if}
</div>
