<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let repos = $state<any[]>([]);
	let showForm = $state(false);
	let form = $state({ url: '', pollInterval: 60, isMonorepo: false, sshKey: '', githubToken: '' });
	let generatedKey = $state<{ repoId: number; publicKey: string } | null>(null);
	let generating = $state(false);
	let connStatus = $state<Record<number, { ok: boolean; error?: string; loading: boolean }>>({});
	let editingId = $state<number | null>(null);
	let editForm = $state({ url: '', pollInterval: 60, isMonorepo: false, githubToken: '' });

	onMount(async () => { await refresh(); });

	async function refresh() {
		repos = await api.repos.list();
		testAll();
	}

	async function testAll() {
		for (const repo of repos) connStatus[repo.id] = { ok: false, loading: true };
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
		await api.repos.create({ ...form, sshKey: form.sshKey || undefined, githubToken: form.githubToken || undefined });
		form = { url: '', pollInterval: 60, isMonorepo: false, sshKey: '', githubToken: '' };
		showForm = false;
		await refresh();
	}

	function startEdit(repo: any) {
		editingId = repo.id;
		editForm = { url: repo.url, pollInterval: repo.poll_interval, isMonorepo: !!repo.is_monorepo, githubToken: '' };
		showForm = false;
	}

	async function saveEdit() {
		if (editingId === null) return;
		const data: any = { url: editForm.url, pollInterval: editForm.pollInterval, isMonorepo: editForm.isMonorepo };
		if (editForm.githubToken) data.githubToken = editForm.githubToken;
		await api.repos.update(editingId, data);
		editingId = null;
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
		} finally { generating = false; }
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
	<button onclick={() => { showForm = !showForm; editingId = null; }}>{showForm ? 'Cancel' : 'Add Repo'}</button>
</div>

{#if showForm}
	<div class="card mb-2">
		<div class="grid grid-2 gap-2 mb-1">
			<div><label class="text-sm text-muted">Repository URL</label><input bind:value={form.url} placeholder="git@github.com:user/repo.git" /></div>
			<div><label class="text-sm text-muted">Poll Interval (seconds)</label><input type="number" bind:value={form.pollInterval} /></div>
		</div>
		<div class="flex items-center gap-1 mb-1">
			<input type="checkbox" bind:checked={form.isMonorepo} id="monorepo" style="width:auto" />
			<label for="monorepo" class="text-sm">Monorepo</label>
		</div>
		<details class="mb-1"><summary class="text-sm" style="cursor:pointer">SSH Key</summary>
			<textarea bind:value={form.sshKey} rows="3" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style="font-family:monospace;font-size:0.75rem;margin-top:0.5rem"></textarea>
		</details>
		<details class="mb-1"><summary class="text-sm" style="cursor:pointer">GitHub Token</summary>
			<input type="password" bind:value={form.githubToken} placeholder="ghp_..." style="margin-top:0.5rem" />
		</details>
		<button onclick={addRepo}>Save</button>
	</div>
{/if}

{#if editingId !== null}
	{@const repo = repos.find(r => r.id === editingId)}
	{#if repo}
		<div class="card mb-2" style="border:1px solid var(--primary)">
			<h3 class="mb-1">Edit Repository</h3>
			<div class="grid grid-2 gap-2 mb-1">
				<div><label class="text-sm text-muted">URL</label><input bind:value={editForm.url} /></div>
				<div><label class="text-sm text-muted">Poll Interval</label><input type="number" bind:value={editForm.pollInterval} /></div>
			</div>
			<div class="flex items-center gap-1 mb-1">
				<input type="checkbox" bind:checked={editForm.isMonorepo} style="width:auto" />
				<label class="text-sm">Monorepo</label>
			</div>
			<div class="mb-1">
				<label class="text-sm text-muted">GitHub Token (leave empty to keep current)</label>
				<input type="password" bind:value={editForm.githubToken} placeholder="ghp_..." />
			</div>
			<div class="flex gap-1">
				<button onclick={saveEdit}>Save</button>
				<button class="secondary" onclick={() => editingId = null}>Cancel</button>
			</div>
		</div>
	{/if}
{/if}

{#if generatedKey}
	<div class="card mb-2" style="border:1px solid var(--accent)">
		<div class="flex justify-between items-center mb-1">
			<strong class="text-sm">Deploy Key (public)</strong>
			<button onclick={() => generatedKey = null} style="font-size:0.75rem;padding:0.2rem 0.5rem">Close</button>
		</div>
		<pre style="font-size:0.7rem;overflow-x:auto;padding:0.5rem;background:var(--bg);border-radius:4px">{generatedKey.publicKey}</pre>
		<button onclick={copyKey} style="font-size:0.75rem;padding:0.3rem 0.6rem;margin-top:0.5rem">Copy</button>
	</div>
{/if}

{#each repos as repo}
	{@const s = connStatus[repo.id]}
	<div class="card mb-1">
		<div class="flex justify-between items-center">
			<div>
				<strong>{repo.url}</strong>
				<div class="flex gap-1 items-center" style="margin-top:0.25rem">
					<span class="text-sm text-muted">Poll: {repo.poll_interval}s</span>
					{#if repo.is_monorepo}<span class="badge pending" style="font-size:0.65rem">monorepo</span>{/if}
					{#if !s || s.loading}
						<span class="text-muted text-sm">testing...</span>
					{:else if s.ok}
						<span class="badge online" style="font-size:0.65rem">connected</span>
					{:else}
						<span class="badge offline" style="font-size:0.65rem" title={s.error}>failed</span>
					{/if}
					{#if repo.has_ssh_key}<span class="badge online" style="font-size:0.6rem">SSH</span>{/if}
					{#if repo.has_github_token}<span class="badge online" style="font-size:0.6rem">PAT</span>{/if}
				</div>
			</div>
			<div class="flex gap-1">
				{#if repo.has_ssh_key}
					<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => showPublicKey(repo.id)}>View Key</button>
					<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeKey(repo.id)}>Remove Key</button>
				{:else}
					<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => generateKey(repo.id)} disabled={generating}>{generating ? '...' : 'Generate Key'}</button>
				{/if}
				<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => startEdit(repo)}>Edit</button>
				<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeRepo(repo.id)}>Delete</button>
			</div>
		</div>
	</div>
{/each}

{#if repos.length === 0 && !showForm}
	<div class="card text-muted">No repositories linked</div>
{/if}
