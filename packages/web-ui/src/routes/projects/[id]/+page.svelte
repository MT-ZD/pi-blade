<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';

	let project = $state<any>(null);
	let allBlades = $state<any[]>([]);
	let vars = $state<any[]>([]);
	let deploys = $state<any[]>([]);
	let repoBranches = $state<string[]>([]);
	let latestCommits = $state<Record<string, string>>({});

	let showVarForm = $state(false);
	let varForm = $state({ key: '', value: '', scope: 'global' });
	let showPasteForm = $state(false);
	let pasteContent = $state('');
	let pasteScope = $state('global');
	let showBladeForm = $state(false);
	let selectedBladeId = $state(0);
	let showBranchAdd = $state(false);
	let newBranch = $state('');
	let newBranchPort = $state(8080);

	let editing = $state(false);
	let editForm = $state({ name: '', path: '', dockerfilePath: '', containerPort: 3000, buildContext: '' });

	let envsOpen = $state(false);
	let revealedVars = $state(new Set<number>());
	let deployPage = $state(1);
	const deployPerPage = 10;

	const projectId = parseInt($page.params.id);

	onMount(async () => {
		await refresh();
		allBlades = await api.blades.list();
	});

	async function refresh() {
		project = await api.projects.get(projectId);
		vars = await api.projectVars.list(projectId);
		deploys = await api.deploys.byProject(projectId);
		try {
			repoBranches = await api.repos.branches(project.repo_id);
			// Fetch latest commit per branch
			const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
			for (const b of project.branches || []) {
				try {
					const res = await fetch(`/api/repos/${project.repo_id}/test`, {
						headers: token ? { 'Authorization': `Bearer ${token}` } : {}
					});
					// Use ls-remote to get latest commit per branch — reuse the poller's approach
				} catch {}
			}
		} catch { repoBranches = []; }
	}

	// Branches
	async function addBranch() {
		if (!newBranch) return;
		await api.projects.addBranch(projectId, newBranch, newBranchPort);
		newBranch = ''; newBranchPort = 8080; showBranchAdd = false;
		await refresh();
	}

	async function removeBranch(branch: string) {
		if (!confirm(`Remove branch "${branch}"?`)) return;
		await api.projects.removeBranch(projectId, branch);
		await refresh();
	}

	async function updateBranchPort(branch: string, port: number) {
		await api.projects.updateBranch(projectId, branch, port);
	}

	async function deployBranch(branch: string) {
		await api.projects.deploy(projectId, branch);
		deploys = await api.deploys.byProject(projectId);
		const latest = deploys.find((d: any) => d.branch === branch && ['building', 'pushing', 'deploying'].includes(d.status));
		if (latest) window.location.href = `/deploys/${latest.id}`;
	}

	// Env vars
	async function addVar() {
		await api.projectVars.add(projectId, varForm);
		varForm = { key: '', value: '', scope: 'global' }; showVarForm = false;
		vars = await api.projectVars.list(projectId);
	}

	async function removeVar(id: number) {
		await api.projectVars.remove(id);
		vars = await api.projectVars.list(projectId);
	}

	async function importEnvFile() {
		const lines = pasteContent.split('\n');
		let count = 0;
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx < 1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let value = trimmed.slice(eqIdx + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
			await api.projectVars.add(projectId, { key, value, scope: pasteScope });
			count++;
		}
		pasteContent = ''; showPasteForm = false;
		vars = await api.projectVars.list(projectId);
		alert(`Imported ${count} variable(s)`);
	}

	// Blades
	async function addBlade(bladeId: number) {
		await api.projects.addBlade(projectId, bladeId);
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
		editForm = { name: project.name, path: project.path, dockerfilePath: project.dockerfile_path, containerPort: project.container_port || 3000, buildContext: project.build_context || '' };
	}

	async function saveEdit() {
		await api.projects.update(projectId, editForm);
		editing = false;
		await refresh();
	}

	function currentVersion(branch: string): string | null {
		return deploys.find((d: any) => d.branch === branch && d.status === 'running')?.image_tag || null;
	}

	function currentDeployId(branch: string): number | null {
		return deploys.find((d: any) => d.branch === branch && d.status === 'running')?.id || null;
	}

	function globalVars() { return vars.filter((v: any) => v.scope === 'global'); }
	function branchVars(branch: string) { return vars.filter((v: any) => v.scope === branch); }
	function availableBlades() {
		const assigned = new Set(project?.blades?.map((b: any) => b.id) || []);
		return allBlades.filter((b) => !assigned.has(b.id));
	}
	function unaddedBranches() {
		const added = new Set((project?.branches || []).map((b: any) => b.branch));
		return repoBranches.filter((b) => !added.has(b));
	}
	function pagedDeploys() { return deploys.slice((deployPage - 1) * deployPerPage, deployPage * deployPerPage); }
	function deployTotalPages() { return Math.max(1, Math.ceil(deploys.length / deployPerPage)); }
</script>

{#if project}
	<div class="flex justify-between items-center mb-2">
		<div>
			<a href="/projects" class="text-sm text-muted">&larr; Projects</a>
			<h1 style="margin-top:0.25rem">{project.name}</h1>
		</div>
		{#if !editing}
			<button class="secondary" onclick={startEdit}>Edit</button>
		{/if}
	</div>

	{#if editing}
		<div class="card mb-2">
			<div class="grid grid-4 gap-2 mb-1">
				<div><label class="text-sm text-muted">Name</label><input bind:value={editForm.name} /></div>
				<div><label class="text-sm text-muted">Path</label><input bind:value={editForm.path} /></div>
				<div><label class="text-sm text-muted">Dockerfile</label><input bind:value={editForm.dockerfilePath} /></div>
				<div><label class="text-sm text-muted">Container Port</label><input type="number" bind:value={editForm.containerPort} /></div>
			</div>
			<div class="mb-1">
				<label class="text-sm text-muted">Build Context <span style="font-weight:normal">(relative to repo root, empty = project path)</span></label>
				<input bind:value={editForm.buildContext} placeholder="e.g. . for repo root" />
			</div>
			<div class="flex gap-1">
				<button onclick={saveEdit}>Save</button>
				<button class="secondary" onclick={() => editing = false}>Cancel</button>
			</div>
		</div>
	{:else}
		<div class="card mb-2">
			<div class="grid grid-4 gap-2 text-sm">
				<div><span class="text-muted">Repo:</span> {project.repo_url}</div>
				<div><span class="text-muted">Path:</span> {project.path}</div>
				<div><span class="text-muted">Dockerfile:</span> {project.dockerfile_path}</div>
				<div><span class="text-muted">Port:</span> {project.container_port || 3000}</div>
				{#if project.build_context}
					<div><span class="text-muted">Build Context:</span> {project.build_context}</div>
				{/if}
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
						<select bind:value={newBranch}><option value="">Select...</option>{#each unaddedBranches() as b}<option value={b}>{b}</option>{/each}</select>
					{:else}
						<input bind:value={newBranch} placeholder="branch name" />
					{/if}
				</div>
				<div style="width:120px"><label class="text-sm text-muted">Host Port</label><input type="number" bind:value={newBranchPort} /></div>
				<button onclick={addBranch} style="margin-bottom:1px">Add</button>
			</div>
		</div>
	{/if}

	<div class="card mb-2">
		{#if project.branches?.length > 0}
			<table>
				<thead><tr><th>Branch</th><th>Host Port</th><th>Deployed</th><th></th></tr></thead>
				<tbody>
					{#each project.branches as b}
						{@const ver = currentVersion(b.branch)}
						<tr>
							<td><code>{b.branch}</code></td>
							<td><input type="number" value={b.port} style="width:80px;font-size:0.8rem;padding:0.2rem 0.3rem" onchange={(e) => updateBranchPort(b.branch, parseInt((e.target as HTMLInputElement).value))} /></td>
							<td>
								{#if ver}
									<code style="font-size:0.75rem">{ver}</code>
									<span class="badge running" style="margin-left:0.3rem">live</span>
								{:else}
									<span class="text-muted text-sm">not deployed</span>
								{/if}
							</td>
							<td class="flex gap-1" style="justify-content:flex-end">
								<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => deployBranch(b.branch)}>Deploy</button>
								<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeBranch(b.branch)}>Remove</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="text-muted" style="padding:0.75rem">No branches configured</div>
		{/if}
	</div>

	<!-- Blades -->
	<div class="flex justify-between items-center mb-1">
		<h2>Target Blades</h2>
		<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => { showBladeForm = !showBladeForm; const avail = availableBlades(); if (avail.length) selectedBladeId = avail[0].id; }}>
			{showBladeForm ? 'Cancel' : '+ Blade'}
		</button>
	</div>

	{#if showBladeForm}
		<div class="card mb-2">
			<div class="flex gap-1 items-end">
				<div style="flex:1"><select bind:value={selectedBladeId}>{#each availableBlades() as blade}<option value={blade.id}>{blade.name}</option>{/each}</select></div>
				<button onclick={() => { if (selectedBladeId) addBlade(selectedBladeId); }} style="margin-bottom:1px">Add</button>
			</div>
		</div>
	{/if}

	<div class="card mb-2">
		{#if project.blades?.length > 0}
			<table>
				<thead><tr><th>Blade</th><th>Hostname</th><th></th></tr></thead>
				<tbody>
					{#each project.blades as blade}
						<tr>
							<td><a href="/blades/{blade.id}">{blade.name}</a></td>
							<td class="text-sm text-muted">{blade.hostname}</td>
							<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeBlade(blade.id)}>Remove</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="text-muted" style="padding:0.75rem">No blades assigned</div>
		{/if}
	</div>

	<!-- Environment Variables (collapsible) -->
	<div class="flex justify-between items-center mb-1">
		<h2 style="cursor:pointer" onclick={() => envsOpen = !envsOpen}>
			Environment Variables <span class="text-sm text-muted">({vars.length})</span>
			<span style="font-size:0.75rem;margin-left:0.3rem">{envsOpen ? '▼' : '▶'}</span>
		</h2>
		{#if envsOpen}
			<div class="flex gap-1">
				<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => { showPasteForm = !showPasteForm; showVarForm = false; }}>
					{showPasteForm ? 'Cancel' : 'Paste .env'}
				</button>
				<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => { showVarForm = !showVarForm; showPasteForm = false; }}>
					{showVarForm ? 'Cancel' : '+ Variable'}
				</button>
			</div>
		{/if}
	</div>

	{#if envsOpen}
		{#if showPasteForm}
			<div class="card mb-2">
				<textarea bind:value={pasteContent} rows="6" placeholder="KEY=value&#10;# comments ignored" style="font-family:monospace;font-size:0.8rem;margin-bottom:0.5rem"></textarea>
				<div class="flex gap-1 items-end">
					<div style="flex:1"><select bind:value={pasteScope}><option value="global">Global</option>{#each project.branches || [] as b}<option value={b.branch}>{b.branch}</option>{/each}</select></div>
					<button onclick={importEnvFile}>Import</button>
				</div>
			</div>
		{/if}

		{#if showVarForm}
			<div class="card mb-2">
				<div class="grid grid-2 gap-2 mb-1">
					<div><input bind:value={varForm.key} placeholder="KEY" /></div>
					<div><input bind:value={varForm.value} placeholder="value" /></div>
				</div>
				<div class="mb-1"><select bind:value={varForm.scope}><option value="global">Global</option>{#each project.branches || [] as b}<option value={b.branch}>{b.branch}</option>{/each}</select></div>
				<button onclick={addVar}>Add</button>
			</div>
		{/if}

		<div class="card mb-2">
			<h3 class="mb-1" style="font-size:0.9rem">Global</h3>
			{#if globalVars().length > 0}
				<table>
					<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
					<tbody>
						{#each globalVars() as v}
							<tr>
								<td><code>{v.key}</code></td>
								<td style="max-width:200px">
									{#if revealedVars.has(v.id)}
										<code style="word-break:break-all">{v.value}</code>
										<button class="secondary" style="font-size:0.6rem;padding:0.1rem 0.3rem;margin-left:0.3rem" onclick={() => { revealedVars.delete(v.id); revealedVars = new Set(revealedVars); }}>Hide</button>
									{:else}
										<code style="color:var(--text-muted)">••••••</code>
										<button class="secondary" style="font-size:0.6rem;padding:0.1rem 0.3rem;margin-left:0.3rem" onclick={() => { revealedVars.add(v.id); revealedVars = new Set(revealedVars); }}>Show</button>
									{/if}
								</td>
								<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<div class="text-muted text-sm" style="padding:0.5rem">No global variables</div>
			{/if}
		</div>

		{#each project.branches || [] as b}
			{@const bVars = branchVars(b.branch)}
			{#if bVars.length > 0}
				<div class="card mb-2">
					<h3 class="mb-1" style="font-size:0.9rem"><code>{b.branch}</code> overrides</h3>
					<table>
						<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
						<tbody>
							{#each bVars as v}
								<tr>
									<td><code>{v.key}</code></td>
									<td style="max-width:200px">
										{#if revealedVars.has(v.id)}
											<code style="word-break:break-all">{v.value}</code>
											<button class="secondary" style="font-size:0.6rem;padding:0.1rem 0.3rem;margin-left:0.3rem" onclick={() => { revealedVars.delete(v.id); revealedVars = new Set(revealedVars); }}>Hide</button>
										{:else}
											<code style="color:var(--text-muted)">••••••</code>
											<button class="secondary" style="font-size:0.6rem;padding:0.1rem 0.3rem;margin-left:0.3rem" onclick={() => { revealedVars.add(v.id); revealedVars = new Set(revealedVars); }}>Show</button>
										{/if}
									</td>
									<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/each}
	{/if}

	<!-- Deploy History (paginated) -->
	<h2 class="mb-1">Deploy History</h2>
	<div class="card">
		<table>
			<thead><tr><th>Branch</th><th>Blade</th><th>Image</th><th>Status</th><th>Time</th><th></th></tr></thead>
			<tbody>
				{#each pagedDeploys() as d}
					{@const isCurrent = d.id === currentDeployId(d.branch)}
					<tr style={isCurrent ? 'background:rgba(74,222,128,0.05)' : ''}>
						<td><code>{d.branch || '-'}</code></td>
						<td><a href="/blades/{d.blade_id}">{d.blade_name}</a></td>
						<td>
							<a href="/deploys/{d.id}"><code>{d.image_tag}</code></a>
							{#if isCurrent}
								<span class="badge running" style="margin-left:0.3rem">current</span>
							{/if}
						</td>
						<td><span class="badge {d.status}">{d.status}</span></td>
						<td class="text-muted text-sm">{new Date(d.timestamp + 'Z').toLocaleString()}</td>
						<td class="flex gap-1">
							{#if d.status === 'running' && !isCurrent}
								<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => { if (confirm('Rollback?')) api.rollback({ projectId, bladeId: d.blade_id, imageTag: d.image_tag }).then(() => api.deploys.byProject(projectId).then(dd => deploys = dd)); }}>Rollback</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if deploys.length === 0}
			<div class="text-muted" style="padding:0.75rem">No deploys yet</div>
		{/if}
		{#if deployTotalPages() > 1}
			<div class="flex justify-between items-center" style="padding:0.75rem">
				<span class="text-sm text-muted">{deploys.length} deploys</span>
				<div class="flex gap-1 items-center">
					<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" disabled={deployPage <= 1} onclick={() => deployPage--}>Prev</button>
					<span class="text-sm">{deployPage} / {deployTotalPages()}</span>
					<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" disabled={deployPage >= deployTotalPages()} onclick={() => deployPage++}>Next</button>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="card text-muted">Loading...</div>
{/if}
