<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';

	let project = $state<any>(null);
	let allBlades = $state<any[]>([]);
	let vars = $state<any[]>([]);
	let deploys = $state<any[]>([]);
	let repoBranches = $state<string[]>([]);

	let showVarForm = $state(false);
	let varForm = $state({ key: '', value: '', scope: 'global' });
	let showBladeForm = $state(false);
	let bladeForm = $state({ bladeId: 0, port: 8080 });
	let showBranchAdd = $state(false);
	let newBranch = $state('');

	let editing = $state(false);
	let editForm = $state({ name: '', path: '', dockerfilePath: '' });

	const projectId = parseInt($page.params.id);

	onMount(async () => {
		await refresh();
		allBlades = await api.blades.list();
		if (allBlades.length > 0) bladeForm.bladeId = allBlades[0].id;
	});

	async function refresh() {
		project = await api.projects.get(projectId);
		vars = await api.projectVars.list(projectId);
		deploys = await api.deploys.byProject(projectId);
		try {
			repoBranches = await api.repos.branches(project.repo_id);
		} catch { repoBranches = []; }
	}

	// Branches
	async function addBranch() {
		if (!newBranch) return;
		await api.projects.addBranch(projectId, newBranch);
		newBranch = '';
		showBranchAdd = false;
		await refresh();
	}

	async function removeBranch(branch: string) {
		if (!confirm(`Remove branch "${branch}"?`)) return;
		await api.projects.removeBranch(projectId, branch);
		await refresh();
	}

	async function deployBranch(branch: string) {
		await api.projects.deploy(projectId, branch);
		alert(`Build triggered for ${branch}`);
		deploys = await api.deploys.byProject(projectId);
	}

	// Env vars
	async function addVar() {
		await api.projectVars.add(projectId, varForm);
		varForm = { key: '', value: '', scope: 'global' };
		showVarForm = false;
		vars = await api.projectVars.list(projectId);
	}

	async function removeVar(id: number) {
		await api.projectVars.remove(id);
		vars = await api.projectVars.list(projectId);
	}

	// Blades
	async function addBlade() {
		await api.projects.addBlade(projectId, bladeForm.bladeId, bladeForm.port);
		showBladeForm = false;
		project = await api.projects.get(projectId);
	}

	async function removeBlade(bladeId: number) {
		await api.projects.removeBlade(projectId, bladeId);
		project = await api.projects.get(projectId);
	}

	// Edit
	function startEdit() {
		editing = true;
		editForm = { name: project.name, path: project.path, dockerfilePath: project.dockerfile_path };
	}

	async function saveEdit() {
		await api.projects.update(projectId, editForm);
		editing = false;
		await refresh();
	}

	// Rollback
	async function rollback(d: any) {
		if (!confirm(`Rollback to ${d.image_tag}?`)) return;
		await api.rollback({ projectId, bladeId: d.blade_id, imageTag: d.image_tag });
		deploys = await api.deploys.byProject(projectId);
	}

	function globalVars() { return vars.filter((v: any) => v.scope === 'global'); }
	function branchVars(branch: string) { return vars.filter((v: any) => v.scope === branch); }
	function availableBlades() {
		const assigned = new Set(project?.blades?.map((b: any) => b.id) || []);
		return allBlades.filter((b) => !assigned.has(b.id));
	}
	function unaddedBranches() {
		const added = new Set(project?.branches || []);
		return repoBranches.filter((b) => !added.has(b));
	}
</script>

{#if project}
	<div class="flex justify-between items-center mb-2">
		<div>
			<a href="/projects" class="text-sm text-muted">&larr; Projects</a>
			<h1 style="margin-top:0.25rem">{project.name}</h1>
		</div>
		<div class="flex gap-1">
			{#if !editing}
				<button class="secondary" onclick={startEdit}>Edit</button>
			{/if}
		</div>
	</div>

	{#if editing}
		<div class="card mb-2">
			<div class="grid grid-3 gap-2 mb-1">
				<div>
					<label class="text-sm text-muted">Name</label>
					<input bind:value={editForm.name} />
				</div>
				<div>
					<label class="text-sm text-muted">Path</label>
					<input bind:value={editForm.path} />
				</div>
				<div>
					<label class="text-sm text-muted">Dockerfile</label>
					<input bind:value={editForm.dockerfilePath} />
				</div>
			</div>
			<div class="flex gap-1">
				<button onclick={saveEdit}>Save</button>
				<button class="secondary" onclick={() => editing = false}>Cancel</button>
			</div>
		</div>
	{:else}
		<div class="card mb-2">
			<div class="grid grid-3 text-sm">
				<div><span class="text-muted">Repo:</span> {project.repo_url}</div>
				<div><span class="text-muted">Path:</span> {project.path}</div>
				<div><span class="text-muted">Dockerfile:</span> {project.dockerfile_path}</div>
			</div>
		</div>
	{/if}

	<!-- Branches -->
	<div class="flex justify-between items-center mb-1">
		<h2>Branches</h2>
		<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showBranchAdd = !showBranchAdd}>
			{showBranchAdd ? 'Cancel' : '+ Branch'}
		</button>
	</div>

	{#if showBranchAdd}
		<div class="card mb-2">
			<div class="flex gap-1 items-end">
				<div style="flex:1">
					{#if unaddedBranches().length > 0}
						<select bind:value={newBranch}>
							<option value="">Select branch...</option>
							{#each unaddedBranches() as b}
								<option value={b}>{b}</option>
							{/each}
						</select>
					{:else}
						<input bind:value={newBranch} placeholder="branch name" />
					{/if}
				</div>
				<button onclick={addBranch} style="margin-bottom:1px">Add</button>
			</div>
		</div>
	{/if}

	<div class="card mb-2">
		{#if project.branches?.length > 0}
			<table>
				<thead><tr><th>Branch</th><th></th></tr></thead>
				<tbody>
					{#each project.branches as branch}
						<tr>
							<td><code>{branch}</code></td>
							<td class="flex gap-1" style="justify-content:flex-end">
								<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => deployBranch(branch)}>Deploy</button>
								<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeBranch(branch)}>Remove</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="text-muted" style="padding:0.75rem">No branches configured — add a branch to start deploying</div>
		{/if}
	</div>

	<!-- Blades -->
	<div class="flex justify-between items-center mb-1">
		<h2>Target Blades</h2>
		<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showBladeForm = !showBladeForm}>
			{showBladeForm ? 'Cancel' : '+ Blade'}
		</button>
	</div>

	{#if showBladeForm}
		<div class="card mb-2">
			<div class="flex gap-1 items-end">
				<div style="flex:1">
					<label class="text-sm text-muted">Blade</label>
					<select bind:value={bladeForm.bladeId}>
						{#each availableBlades() as blade}
							<option value={blade.id}>{blade.name}</option>
						{/each}
					</select>
				</div>
				<div style="width:120px">
					<label class="text-sm text-muted">Port</label>
					<input type="number" bind:value={bladeForm.port} />
				</div>
				<button onclick={addBlade} style="margin-bottom:1px">Add</button>
			</div>
		</div>
	{/if}

	<div class="card mb-2">
		{#if project.blades?.length > 0}
			<table>
				<thead><tr><th>Blade</th><th>Hostname</th><th>Port</th><th></th></tr></thead>
				<tbody>
					{#each project.blades as blade}
						<tr>
							<td>{blade.name}</td>
							<td class="text-sm text-muted">{blade.hostname}</td>
							<td>{blade.port}</td>
							<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeBlade(blade.id)}>Remove</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="text-muted" style="padding:0.75rem">No blades assigned</div>
		{/if}
	</div>

	<!-- Environment Variables -->
	<div class="flex justify-between items-center mb-1">
		<h2>Environment Variables</h2>
		<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showVarForm = !showVarForm}>
			{showVarForm ? 'Cancel' : '+ Variable'}
		</button>
	</div>

	{#if showVarForm}
		<div class="card mb-2">
			<div class="grid grid-2 gap-2 mb-1">
				<div>
					<label class="text-sm text-muted">Key</label>
					<input bind:value={varForm.key} placeholder="DATABASE_URL" />
				</div>
				<div>
					<label class="text-sm text-muted">Value</label>
					<input bind:value={varForm.value} placeholder="postgres://..." />
				</div>
			</div>
			<div class="mb-1">
				<label class="text-sm text-muted">Scope</label>
				<select bind:value={varForm.scope}>
					<option value="global">Global (all branches)</option>
					{#each project.branches || [] as branch}
						<option value={branch}>{branch} only</option>
					{/each}
				</select>
			</div>
			<button onclick={addVar}>Add</button>
		</div>
	{/if}

	<div class="card mb-2">
		<h3 class="mb-1" style="font-size:0.9rem">Global</h3>
		<table>
			<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
			<tbody>
				{#each globalVars() as v}
					<tr>
						<td><code>{v.key}</code></td>
						<td><code>{v.value}</code></td>
						<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if globalVars().length === 0}
			<div class="text-muted text-sm" style="padding:0.75rem">No global variables</div>
		{/if}
	</div>

	{#each project.branches || [] as branch}
		{@const bVars = branchVars(branch)}
		{#if bVars.length > 0}
			<div class="card mb-2">
				<h3 class="mb-1" style="font-size:0.9rem"><code>{branch}</code> overrides</h3>
				<table>
					<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
					<tbody>
						{#each bVars as v}
							<tr>
								<td><code>{v.key}</code></td>
								<td><code>{v.value}</code></td>
								<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/each}

	<!-- Deploy History -->
	<h2 class="mb-1">Deploy History</h2>
	<div class="card">
		<table>
			<thead><tr><th>Branch</th><th>Blade</th><th>Image</th><th>Status</th><th>Time</th><th></th></tr></thead>
			<tbody>
				{#each deploys as d}
					<tr>
						<td><code>{d.branch || '-'}</code></td>
						<td>{d.blade_name}</td>
						<td><code>{d.image_tag}</code></td>
						<td><span class="badge {d.status}">{d.status}</span></td>
						<td class="text-muted text-sm">{new Date(d.timestamp).toLocaleString()}</td>
						<td>
							{#if d.status === 'running'}
								<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => rollback(d)}>Rollback</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if deploys.length === 0}
			<div class="text-muted" style="padding:0.75rem">No deploys yet</div>
		{/if}
	</div>
{:else}
	<div class="card text-muted">Loading...</div>
{/if}
