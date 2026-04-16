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
	let showPasteForm = $state(false);
	let pasteContent = $state('');
	let pasteScope = $state('global');
	let showBladeForm = $state(false);
	let showBranchAdd = $state(false);
	let newBranch = $state('');
	let newBranchPort = $state(8080);

	let editing = $state(false);
	let editForm = $state({ name: '', path: '', dockerfilePath: '', containerPort: 3000 });

	let logLines = $state<string[]>([]);
	let logTitle = $state('');
	let logOpen = $state(false);
	let logDone = $state(false);
	let logEventSource: EventSource | null = null;
	let logImageTag = $state('');

	let containerLogLines = $state<string[]>([]);
	let containerLogTitle = $state('');
	let containerLogOpen = $state(false);

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
		} catch { repoBranches = []; }
	}

	// Branches
	async function addBranch() {
		if (!newBranch) return;
		await api.projects.addBranch(projectId, newBranch, newBranchPort);
		newBranch = '';
		newBranchPort = 8080;
		showBranchAdd = false;
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
		if (latest) openLiveLogs(latest.image_tag, branch);
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
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			await api.projectVars.add(projectId, { key, value, scope: pasteScope });
			count++;
		}
		pasteContent = '';
		showPasteForm = false;
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
		editForm = { name: project.name, path: project.path, dockerfilePath: project.dockerfile_path, containerPort: project.container_port || 3000 };
	}

	async function saveEdit() {
		await api.projects.update(projectId, editForm);
		editing = false;
		await refresh();
	}

	// Logs
	function openLiveLogs(imageTag: string, branch: string) {
		closeLog();
		logTitle = `${project.name} @ ${branch} (${imageTag})`;
		logImageTag = imageTag;
		logLines = [];
		logOpen = true;
		logDone = false;

		const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
		const url = `/api/builds/${encodeURIComponent(project.name)}/${encodeURIComponent(imageTag)}/logs${token ? '?token=' + encodeURIComponent(token) : ''}`;
		logEventSource = new EventSource(url);
		logEventSource.onmessage = (e) => {
			const data = JSON.parse(e.data);
			if (data === '__DONE__') {
				logDone = true;
				logEventSource?.close();
				logEventSource = null;
				api.deploys.byProject(projectId).then((d) => deploys = d);
			} else {
				logLines = [...logLines, data];
				setTimeout(() => {
					const el = document.getElementById('log-container');
					if (el) el.scrollTop = el.scrollHeight;
				}, 10);
			}
		};
		logEventSource.onerror = () => {
			logDone = true;
			logEventSource?.close();
			logEventSource = null;
		};
	}

	async function viewLog(deploy: any) {
		const { id: deployId, image_tag: imageTag, branch, status } = deploy;

		// Try live log first
		try {
			const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
			const activeRes = await fetch('/api/builds/active', {
				headers: token ? { 'Authorization': `Bearer ${token}` } : {}
			});
			const active = await activeRes.json() as { key: string; finished: boolean }[];
			const key = `${project.name}:${imageTag}`;
			if (active.find((a: any) => a.key === key)) {
				openLiveLogs(imageTag, branch);
				return;
			}
		} catch {}

		// Fall back to stored log
		closeLog();
		logTitle = `${project.name} @ ${branch || '?'} (${imageTag})`;
		logOpen = true;

		const inProgress = ['building', 'pushing', 'deploying'].includes(status);
		logDone = !inProgress;

		try {
			const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
			const res = await fetch(`/api/deploys/${deployId}/log`, {
				headers: token ? { 'Authorization': `Bearer ${token}` } : {}
			});
			const data = await res.json();
			if (data.log) {
				logLines = data.log.split('\n');
			} else if (inProgress) {
				logLines = ['Build in progress — logs will appear when the build service is updated to the latest version.'];
			} else {
				logLines = ['No log recorded for this deploy.'];
			}
		} catch {
			logLines = ['Failed to load log'];
		}
	}

	async function abortBuild() {
		if (!project || !logImageTag) return;
		const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
		await fetch(`/api/builds/${encodeURIComponent(project.name)}/${encodeURIComponent(logImageTag)}/abort`, {
			method: 'POST',
			headers: token ? { 'Authorization': `Bearer ${token}` } : {}
		});
	}

	function closeLog() {
		logEventSource?.close();
		logEventSource = null;
		logOpen = false;
		logLines = [];
		logImageTag = '';
	}

	// Rollback
	async function rollback(d: any) {
		if (!confirm(`Rollback to ${d.image_tag}?`)) return;
		await api.rollback({ projectId, bladeId: d.blade_id, imageTag: d.image_tag });
		deploys = await api.deploys.byProject(projectId);
	}

	function currentVersion(branch: string): string | null {
		const running = deploys.find((d: any) => d.branch === branch && d.status === 'running');
		return running?.image_tag || null;
	}

	function currentDeployId(branch: string): number | null {
		const running = deploys.find((d: any) => d.branch === branch && d.status === 'running');
		return running?.id || null;
	}

	async function redeploy(d: any) {
		if (!confirm(`Redeploy ${d.image_tag} on ${d.branch}?`)) return;
		await api.projects.deploy(projectId, d.branch);
		deploys = await api.deploys.byProject(projectId);
	}

	async function viewContainerLogs(branch: string) {
		if (!project?.blades?.length) return;
		const containerName = `${project.name.toLowerCase()}-${branch.replace(/\//g, '-')}`;
		const blade = project.blades[0]; // use first blade
		containerLogTitle = `${containerName} on ${blade.name}`;
		containerLogOpen = true;
		try {
			const res = await api.blades.containerLogs(blade.id, containerName, 500);
			containerLogLines = (res.logs || 'No logs').split('\n');
		} catch (e: any) {
			containerLogLines = [`Failed to fetch logs: ${e.message}`];
		}
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
			<div class="grid grid-4 gap-2 mb-1">
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
				<div>
					<label class="text-sm text-muted">Container Port</label>
					<input type="number" bind:value={editForm.containerPort} />
				</div>
			</div>
			<div class="flex gap-1">
				<button onclick={saveEdit}>Save</button>
				<button class="secondary" onclick={() => editing = false}>Cancel</button>
			</div>
		</div>
	{:else}
		<div class="card mb-2">
			<div class="grid grid-4 text-sm">
				<div><span class="text-muted">Repo:</span> {project.repo_url}</div>
				<div><span class="text-muted">Path:</span> {project.path}</div>
				<div><span class="text-muted">Dockerfile:</span> {project.dockerfile_path}</div>
				<div><span class="text-muted">Container Port:</span> {project.container_port || 3000}</div>
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
					<label class="text-sm text-muted">Branch</label>
					{#if unaddedBranches().length > 0}
						<select bind:value={newBranch}>
							<option value="">Select...</option>
							{#each unaddedBranches() as b}
								<option value={b}>{b}</option>
							{/each}
						</select>
					{:else}
						<input bind:value={newBranch} placeholder="branch name" />
					{/if}
				</div>
				<div style="width:120px">
					<label class="text-sm text-muted">Host Port</label>
					<input type="number" bind:value={newBranchPort} />
				</div>
				<button onclick={addBranch} style="margin-bottom:1px">Add</button>
			</div>
		</div>
	{/if}

	<div class="card mb-2">
		{#if project.branches?.length > 0}
			<table>
				<thead><tr><th>Branch</th><th>Host Port</th><th>Current Version</th><th></th></tr></thead>
				<tbody>
					{#each project.branches as b}
						{@const ver = currentVersion(b.branch)}
						<tr>
							<td><code>{b.branch}</code></td>
							<td>
								<input type="number" value={b.port} style="width:80px;font-size:0.8rem;padding:0.2rem 0.3rem"
									onchange={(e) => updateBranchPort(b.branch, parseInt((e.target as HTMLInputElement).value))} />
							</td>
							<td>
								{#if ver}
									<code style="font-size:0.75rem">{ver}</code>
									<span class="badge running" style="margin-left:0.3rem">live</span>
								{:else}
									<span class="text-muted text-sm">not deployed</span>
								{/if}
							</td>
							<td class="flex gap-1" style="justify-content:flex-end">
								{#if ver}
									<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => viewContainerLogs(b.branch)}>Container Logs</button>
								{/if}
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

	{#if containerLogOpen}
		<div class="card mb-2" style="border:1px solid var(--info)">
			<div class="flex justify-between items-center mb-1">
				<strong class="text-sm">{containerLogTitle}</strong>
				<div class="flex gap-1">
					<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => viewContainerLogs(containerLogTitle.split('-').slice(1).join('-').split(' on ')[0])}>Refresh</button>
					<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => containerLogOpen = false}>Close</button>
				</div>
			</div>
			<div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;max-height:400px;overflow-y:auto;font-family:monospace;font-size:0.75rem;line-height:1.5;white-space:pre-wrap;word-break:break-all">
				{#each containerLogLines as line}
					{line}
{/each}
			</div>
		</div>
	{/if}

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
					<select id="blade-select">
						{#each availableBlades() as blade}
							<option value={blade.id}>{blade.name}</option>
						{/each}
					</select>
				</div>
				<button onclick={() => {
					const sel = document.getElementById('blade-select') as HTMLSelectElement;
					if (sel?.value) addBlade(parseInt(sel.value));
				}} style="margin-bottom:1px">Add</button>
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
							<td>{blade.name}</td>
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

	<!-- Environment Variables -->
	<div class="flex justify-between items-center mb-1">
		<h2>Environment Variables</h2>
		<div class="flex gap-1">
			<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => { showPasteForm = !showPasteForm; showVarForm = false; }}>
				{showPasteForm ? 'Cancel' : 'Paste .env'}
			</button>
			<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => { showVarForm = !showVarForm; showPasteForm = false; }}>
				{showVarForm ? 'Cancel' : '+ Variable'}
			</button>
		</div>
	</div>

	{#if showPasteForm}
		<div class="card mb-2">
			<div class="mb-1">
				<label class="text-sm text-muted">Paste .env file content</label>
				<textarea bind:value={pasteContent} rows="8" placeholder="KEY=value&#10;# comments ignored" style="font-family:monospace;font-size:0.8rem"></textarea>
			</div>
			<div class="flex gap-1 items-end">
				<div style="flex:1">
					<label class="text-sm text-muted">Scope</label>
					<select bind:value={pasteScope}>
						<option value="global">Global</option>
						{#each project.branches || [] as b}
							<option value={b.branch}>{b.branch} only</option>
						{/each}
					</select>
				</div>
				<button onclick={importEnvFile}>Import</button>
			</div>
		</div>
	{/if}

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
					<option value="global">Global</option>
					{#each project.branches || [] as b}
						<option value={b.branch}>{b.branch} only</option>
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
								<td><code>{v.value}</code></td>
								<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/each}

	<!-- Log Viewer -->
	{#if logOpen}
		<div class="card mb-2" style="border:1px solid var(--primary)">
			<div class="flex justify-between items-center mb-1">
				<strong class="text-sm">{logTitle}</strong>
				<div class="flex items-center gap-1">
					{#if !logDone}
						<span class="badge building">live</span>
						<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={abortBuild}>Abort</button>
					{:else}
						<span class="badge online">done</span>
					{/if}
					<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={closeLog}>Close</button>
				</div>
			</div>
			<div id="log-container" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;max-height:400px;overflow-y:auto;font-family:monospace;font-size:0.75rem;line-height:1.5;white-space:pre-wrap;word-break:break-all">
				{#each logLines as line}
					{line}
{/each}
			</div>
		</div>
	{/if}

	<!-- Deploy History -->
	<h2 class="mb-1">Deploy History</h2>
	<div class="card">
		<table>
			<thead><tr><th>Branch</th><th>Blade</th><th>Image</th><th>Status</th><th>Time</th><th></th></tr></thead>
			<tbody>
				{#each deploys as d}
					{@const isCurrent = d.id === currentDeployId(d.branch)}
					<tr style={isCurrent ? 'background:rgba(74,222,128,0.05)' : ''}>
						<td><code>{d.branch || '-'}</code></td>
						<td>{d.blade_name}</td>
						<td>
							<code>{d.image_tag}</code>
							{#if isCurrent}
								<span class="badge running" style="margin-left:0.3rem">current</span>
							{/if}
						</td>
						<td><span class="badge {d.status}">{d.status}</span></td>
						<td class="text-muted text-sm">{new Date(d.timestamp + 'Z').toLocaleString()}</td>
						<td class="flex gap-1">
							<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => viewLog(d)}>Logs</button>
							{#if d.status === 'running' && !isCurrent}
								<button class="secondary" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => rollback(d)}>Rollback</button>
							{/if}
							{#if !['building', 'pushing', 'deploying'].includes(d.status)}
								<button style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => redeploy(d)}>Redeploy</button>
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
