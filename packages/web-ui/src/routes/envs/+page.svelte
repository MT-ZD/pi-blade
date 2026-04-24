<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let projects = $state<any[]>([]);
	let selectedProject = $state<any>(null);
	let vars = $state<any[]>([]);
	let showVarForm = $state(false);
	let varForm = $state({ key: '', value: '', scope: 'global' });

	onMount(async () => {
		projects = await api.projects.list();
	});

	async function selectProject(project: any) {
		selectedProject = project;
		vars = await api.projectVars.list(project.id);
		showVarForm = false;
	}

	async function addVar() {
		if (!selectedProject) return;
		await api.projectVars.add(selectedProject.id, varForm);
		varForm = { key: '', value: '', scope: 'global' };
		showVarForm = false;
		vars = await api.projectVars.list(selectedProject.id);
	}

	async function removeVar(id: number) {
		await api.projectVars.remove(id);
		if (selectedProject) vars = await api.projectVars.list(selectedProject.id);
	}

	async function exportEnv() {
		if (!selectedProject) return;
		const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/);
		const headers: Record<string, string> = {};
		if (token) headers['Authorization'] = `Bearer ${decodeURIComponent(token[1])}`;
		const res = await fetch(`/api/projects/${selectedProject.id}/vars/export`, { headers });
		if (!res.ok) return;
		const blob = await res.blob();
		const cd = res.headers.get('Content-Disposition') || '';
		const m = cd.match(/filename="([^"]+)"/);
		const filename = m ? m[1] : `${selectedProject.name}.env`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	$effect(() => {
		if (selectedProject) {
			varForm.scope = 'global';
		}
	});

	function globalVars() { return vars.filter((v) => v.scope === 'global'); }
	function branchVars() { return vars.filter((v) => v.scope !== 'global'); }
</script>

<h1 class="mb-2">Environment Variables</h1>

<div class="mb-2">
	<label class="text-sm text-muted">Project</label>
	<select onchange={(e) => {
		const id = parseInt((e.target as HTMLSelectElement).value);
		const p = projects.find((p) => p.id === id);
		if (p) selectProject(p);
	}}>
		<option value="">Select a project...</option>
		{#each projects as project}
			<option value={project.id}>{project.name} ({project.branch})</option>
		{/each}
	</select>
</div>

{#if selectedProject}
	<div class="flex justify-between items-center mb-1">
		<h3>Variables for {selectedProject.name}</h3>
		<div class="flex gap-1">
			<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={exportEnv}>Export .env</button>
			<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showVarForm = !showVarForm}>
				{showVarForm ? 'Cancel' : '+ Variable'}
			</button>
		</div>
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
					<option value={selectedProject.branch}>{selectedProject.branch} (branch-specific)</option>
				</select>
			</div>
			<button onclick={addVar}>Add</button>
		</div>
	{/if}

	<div class="card mb-2">
		<h3 class="mb-1" style="font-size:0.9rem">Global Variables</h3>
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

	<div class="card">
		<h3 class="mb-1" style="font-size:0.9rem">Branch Variables <code style="font-size:0.8rem">({selectedProject.branch})</code></h3>
		<p class="text-sm text-muted mb-1">Override global variables for this branch</p>
		<table>
			<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
			<tbody>
				{#each branchVars() as v}
					<tr>
						<td><code>{v.key}</code></td>
						<td><code>{v.value}</code></td>
						<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if branchVars().length === 0}
			<div class="text-muted text-sm" style="padding:0.75rem">No branch-specific variables</div>
		{/if}
	</div>
{:else}
	<div class="card text-muted">Select a project to manage its variables</div>
{/if}
