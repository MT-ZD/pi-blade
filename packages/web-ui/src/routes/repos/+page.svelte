<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let repos = $state<any[]>([]);
	let showForm = $state(false);
	let form = $state({ url: '', branch: 'main', pollInterval: 60, isMonorepo: false, sshKey: '' });
	let generatedKey = $state<{ repoId: number; publicKey: string } | null>(null);
	let generating = $state(false);
	let connStatus = $state<Record<number, { ok: boolean; error?: string; loading: boolean }>>({});

	onMount(async () => { await refresh(); });

	async function refresh() {
		repos = await api.repos.list();
		testAll();
	}

	async function testAll() {
		for (const repo of repos) {
			connStatus[repo.id] = { ok: false, loading: true };
		}
		await Promise.all(repos.map(async (repo) => {
			try {
				const res = await api.repos.test(repo.id);
				connStatus[repo.id] = { ok: res.ok, error: res.error, loading: false };
			} catch (e: any) {
				connStatus[repo.id] = { ok: false, error: e.message, loading: false };
			}
		}));
	}

	async function addRepo() {
		await api.repos.create({
			...form,
			sshKey: form.sshKey || undefined,
		});
		form = { url: '', branch: 'main', pollInterval: 60, isMonorepo: false, sshKey: '' };
		showForm = false;
		await refresh();
	}

	async function removeRepo(id: number) {
		if (!confirm('Delete this repo and all its projects?')) return;
		await api.repos.remove(id);
		await refresh();
	}

	async function generateKey(id: number) {
		generating = true;
		try {
			const res = await api.repos.generateKey(id);
			generatedKey = { repoId: id, publicKey: res.publicKey };
			await refresh();
		} finally {
			generating = false;
		}
	}

	async function showPublicKey(id: number) {
		const res = await api.repos.getPublicKey(id);
		generatedKey = { repoId: id, publicKey: res.publicKey };
	}

	async function removeKey(id: number) {
		await api.repos.update(id, { sshKey: null });
		generatedKey = null;
		await refresh();
	}

	function copyKey() {
		if (generatedKey) navigator.clipboard.writeText(generatedKey.publicKey);
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
				<input bind:value={form.url} placeholder="git@github.com:user/repo.git" />
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
		<details class="mb-1">
			<summary class="text-sm" style="cursor:pointer">SSH Key (for private repos)</summary>
			<div style="margin-top:0.5rem">
				<label class="text-sm text-muted">Paste private key (optional — can generate after saving)</label>
				<textarea bind:value={form.sshKey} rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style="font-family:monospace;font-size:0.75rem"></textarea>
			</div>
		</details>
		<button onclick={addRepo}>Save</button>
	</div>
{/if}

{#if generatedKey}
	<div class="card mb-2" style="border:1px solid var(--accent)">
		<div class="flex justify-between items-center mb-1">
			<strong class="text-sm">Deploy Key (public)</strong>
			<button onclick={() => generatedKey = null} style="font-size:0.75rem;padding:0.2rem 0.5rem">Close</button>
		</div>
		<p class="text-sm text-muted mb-1">Add this key to your repository's deploy keys settings:</p>
		<pre style="font-size:0.7rem;overflow-x:auto;padding:0.5rem;background:var(--bg-secondary);border-radius:4px">{generatedKey.publicKey}</pre>
		<button onclick={copyKey} style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-top:0.5rem">Copy</button>
	</div>
{/if}

<div class="card">
	<table>
		<thead>
			<tr><th>URL</th><th>Branch</th><th>Poll</th><th>Monorepo</th><th>Status</th><th>SSH</th><th></th></tr>
		</thead>
		<tbody>
			{#each repos as repo}
				<tr>
					<td>{repo.url}</td>
					<td>{repo.branch}</td>
					<td>{repo.poll_interval}s</td>
					<td>{repo.is_monorepo ? 'Yes' : 'No'}</td>
					<td>
						{@const s = connStatus[repo.id]}
						{#if !s || s.loading}
							<span class="text-muted text-sm">testing...</span>
						{:else if s.ok}
							<span class="badge online">connected</span>
						{:else}
							<span class="badge offline" title={s.error}>failed</span>
						{/if}
					</td>
					<td>
						{#if repo.has_ssh_key}
							<span style="color:var(--success)" title="SSH key configured">&#x1f512;</span>
							<button onclick={() => showPublicKey(repo.id)} style="font-size:0.65rem;padding:0.15rem 0.4rem">View</button>
							<button onclick={() => removeKey(repo.id)} style="font-size:0.65rem;padding:0.15rem 0.4rem" class="danger">Remove</button>
						{:else}
							<button onclick={() => generateKey(repo.id)} disabled={generating} style="font-size:0.65rem;padding:0.15rem 0.4rem">
								{generating ? '...' : 'Generate'}
							</button>
						{/if}
					</td>
					<td><button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeRepo(repo.id)}>Delete</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if repos.length === 0}
		<div class="text-muted" style="padding:1rem">No repositories linked</div>
	{/if}
</div>
