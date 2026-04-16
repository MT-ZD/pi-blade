<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let projects = $state<any[]>([]);
	let repos = $state<any[]>([]);
	let blades = $state<any[]>([]);
	let showForm = $state(false);
	let form = $state({ repoId: 0, name: '', path: '.', dockerfilePath: 'Dockerfile', branches: [] as string[], blades: [] as { bladeId: number; port: number }[] });
	let repoBranches = $state<Record<number, string[]>>({});

	let showImport = $state(false);
	let importRepoId = $state(0);
	let importBranch = $state('');
	let detected = $state<{ name: string; path: string; dockerfilePath: string }[]>([]);
	let detecting = $state(false);
	let importBlades = $state<{ bladeId: number; port: number }[]>([]);
	let importRepoBranches = $state<string[]>([]);
	let importSelectedBranches = $state<string[]>([]);

	onMount(async () => {
		const [p, r, b] = await Promise.all([api.projects.list(), api.repos.list(), api.blades.list()]);
		projects = p;
		repos = r;
		blades = b;
		if (repos.length > 0) {
			form.repoId = repos[0].id;
			importRepoId = repos[0].id;
			fetchBranches(repos[0].id);
		}
	});

	async function refresh() { projects = await api.projects.list(); }

	async function fetchBranches(repoId: number) {
		try {
			repoBranches[repoId] = await api.repos.branches(repoId);
		} catch {
			repoBranches[repoId] = [];
		}
	}

	async function onRepoChange(repoId: number) {
		form.repoId = repoId;
		if (!repoBranches[repoId]) await fetchBranches(repoId);
		form.branches = [];
	}

	async function onImportRepoChange(repoId: number) {
		importRepoId = repoId;
		if (!repoBranches[repoId]) await fetchBranches(repoId);
		importRepoBranches = repoBranches[repoId] || [];
		importBranch = importRepoBranches[0] || '';
		importSelectedBranches = importBranch ? [importBranch] : [];
		detected = [];
	}

	function toggleFormBranch(b: string) {
		if (form.branches.includes(b)) {
			form.branches = form.branches.filter((x) => x !== b);
		} else {
			form.branches = [...form.branches, b];
		}
	}

	async function addProject() {
		await api.projects.create(form);
		form = { repoId: repos[0]?.id || 0, name: '', path: '.', dockerfilePath: 'Dockerfile', branches: [], blades: [] };
		showForm = false;
		await refresh();
	}

	function addBladeToProject() {
		if (blades.length === 0) return;
		form.blades = [...form.blades, { bladeId: blades[0].id, port: 8080 }];
	}

	function removeBladeFromProject(idx: number) {
		form.blades = form.blades.filter((_, i) => i !== idx);
	}

	async function detect() {
		detecting = true;
		try {
			detected = await api.repos.detectProjects(importRepoId, importBranch || undefined);
		} catch (e: any) {
			alert('Detection failed: ' + e.message);
			detected = [];
		} finally {
			detecting = false;
		}
	}

	function addImportBlade() {
		if (blades.length === 0) return;
		importBlades = [...importBlades, { bladeId: blades[0].id, port: 8080 }];
	}

	function removeImportBlade(idx: number) {
		importBlades = importBlades.filter((_, i) => i !== idx);
	}

	function toggleImportBranch(b: string) {
		if (importSelectedBranches.includes(b)) {
			importSelectedBranches = importSelectedBranches.filter((x) => x !== b);
		} else {
			importSelectedBranches = [...importSelectedBranches, b];
		}
	}

	async function importProject(p: { name: string; path: string; dockerfilePath: string }) {
		await api.projects.create({
			repoId: importRepoId,
			name: p.name,
			path: p.path,
			dockerfilePath: p.dockerfilePath,
			branches: importSelectedBranches,
			blades: importBlades,
		});
		detected = detected.filter((d) => d.name !== p.name);
		await refresh();
	}

	async function importAll() {
		for (const p of [...detected]) {
			await importProject(p);
		}
	}

	async function removeProject(id: number) {
		if (!confirm('Delete this project?')) return;
		await api.projects.remove(id);
		await refresh();
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Projects</h1>
	<div class="flex gap-1">
		<button class="secondary" onclick={() => { showImport = !showImport; showForm = false; }}>{showImport ? 'Cancel' : 'Import from Repo'}</button>
		<button onclick={() => { showForm = !showForm; showImport = false; }}>{showForm ? 'Cancel' : 'Add Manual'}</button>
	</div>
</div>

{#if showImport}
	<div class="card mb-2">
		<div class="flex gap-1 items-end mb-1">
			<div style="flex:1">
				<label class="text-sm text-muted">Repository</label>
				<select bind:value={importRepoId} onchange={(e) => onImportRepoChange(parseInt((e.target as HTMLSelectElement).value))}>
					{#each repos as repo}
						<option value={repo.id}>{repo.url}</option>
					{/each}
				</select>
			</div>
			<div style="flex:0.5">
				<label class="text-sm text-muted">Scan Branch</label>
				{#if importRepoBranches.length > 0}
					<select bind:value={importBranch}>
						{#each importRepoBranches as b}
							<option value={b}>{b}</option>
						{/each}
					</select>
				{:else}
					<input bind:value={importBranch} placeholder="main" />
				{/if}
			</div>
			<button onclick={detect} disabled={detecting} style="margin-bottom:1px">
				{detecting ? 'Scanning...' : 'Detect'}
			</button>
		</div>

		{#if detected.length > 0}
			{#if importRepoBranches.length > 0}
				<div class="mb-1">
					<label class="text-sm text-muted">Branches to track</label>
					<div class="flex gap-1" style="flex-wrap:wrap;margin-top:0.25rem">
						{#each importRepoBranches as b}
							<label class="flex items-center gap-1 text-sm" style="cursor:pointer">
								<input type="checkbox" checked={importSelectedBranches.includes(b)} onchange={() => toggleImportBranch(b)} style="width:auto" />
								{b}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<div class="mb-1">
				<div class="flex justify-between items-center mb-1">
					<span class="text-sm text-muted">Target Blades</span>
					<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={addImportBlade}>+ Blade</button>
				</div>
				{#each importBlades as b, i}
					<div class="flex gap-1 items-center mb-1">
						<select bind:value={b.bladeId} style="flex:1">
							{#each blades as blade}
								<option value={blade.id}>{blade.name}</option>
							{/each}
						</select>
						<input type="number" bind:value={b.port} placeholder="Port" style="width:100px" />
						<button class="danger" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={() => removeImportBlade(i)}>x</button>
					</div>
				{/each}
			</div>

			<div class="flex justify-between items-center mb-1">
				<span class="text-sm"><strong>{detected.length}</strong> project(s) detected</span>
				<button onclick={importAll} style="font-size:0.75rem;padding:0.3rem 0.6rem">Import All</button>
			</div>
			<table>
				<thead><tr><th>Name</th><th>Path</th><th>Dockerfile</th><th></th></tr></thead>
				<tbody>
					{#each detected as p}
						<tr>
							<td>{p.name}</td>
							<td><code>{p.path}</code></td>
							<td><code>{p.dockerfilePath}</code></td>
							<td><button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => importProject(p)}>Import</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if !detecting}
			<div class="text-muted text-sm">Click "Detect" to scan for Dockerfiles</div>
		{/if}
	</div>
{/if}

{#if showForm}
	<div class="card mb-2">
		<div class="grid grid-2 gap-2 mb-1">
			<div>
				<label class="text-sm text-muted">Project Name</label>
				<input bind:value={form.name} placeholder="my-app" />
			</div>
			<div>
				<label class="text-sm text-muted">Repository</label>
				<select bind:value={form.repoId} onchange={(e) => onRepoChange(parseInt((e.target as HTMLSelectElement).value))}>
					{#each repos as repo}
						<option value={repo.id}>{repo.url}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="text-sm text-muted">Path in Repo</label>
				<input bind:value={form.path} placeholder="." />
			</div>
			<div>
				<label class="text-sm text-muted">Dockerfile Path</label>
				<input bind:value={form.dockerfilePath} placeholder="Dockerfile" />
			</div>
		</div>

		{#if repoBranches[form.repoId]?.length}
			<div class="mb-1">
				<label class="text-sm text-muted">Branches</label>
				<div class="flex gap-1" style="flex-wrap:wrap;margin-top:0.25rem">
					{#each repoBranches[form.repoId] as b}
						<label class="flex items-center gap-1 text-sm" style="cursor:pointer">
							<input type="checkbox" checked={form.branches.includes(b)} onchange={() => toggleFormBranch(b)} style="width:auto" />
							{b}
						</label>
					{/each}
				</div>
			</div>
		{/if}

		<div class="mb-1">
			<div class="flex justify-between items-center mb-1">
				<span class="text-sm text-muted">Target Blades</span>
				<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={addBladeToProject}>+ Blade</button>
			</div>
			{#each form.blades as b, i}
				<div class="flex gap-1 items-center mb-1">
					<select bind:value={b.bladeId} style="flex:1">
						{#each blades as blade}
							<option value={blade.id}>{blade.name}</option>
						{/each}
					</select>
					<input type="number" bind:value={b.port} placeholder="Port" style="width:100px" />
					<button class="danger" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={() => removeBladeFromProject(i)}>x</button>
				</div>
			{/each}
		</div>
		<button onclick={addProject}>Save</button>
	</div>
{/if}

<div class="card">
	<table>
		<thead>
			<tr><th>Name</th><th>Repo</th><th>Branches</th><th>Path</th><th></th></tr>
		</thead>
		<tbody>
			{#each projects as project}
				<tr>
					<td><a href="/projects/{project.id}">{project.name}</a></td>
					<td class="text-sm">{project.repo_url}</td>
					<td>
						{#each project.branches || [] as b}
							<code style="margin-right:0.3rem;font-size:0.75rem">{b}</code>
						{/each}
						{#if !project.branches?.length}
							<span class="text-muted text-sm">none</span>
						{/if}
					</td>
					<td>{project.path}</td>
					<td class="flex gap-1">
						<button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeProject(project.id)}>Delete</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if projects.length === 0}
		<div class="text-muted" style="padding:1rem">No projects configured</div>
	{/if}
</div>
