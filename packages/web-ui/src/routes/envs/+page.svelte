<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let projects = $state<any[]>([]);
	let selectedProject = $state<any>(null);
	let environments = $state<any[]>([]);
	let selectedEnv = $state<any>(null);
	let showEnvForm = $state(false);
	let showVarForm = $state(false);
	let newEnvName = $state('production');
	let varForm = $state({ key: '', value: '' });

	onMount(async () => {
		projects = await api.projects.list();
	});

	async function selectProject(project: any) {
		selectedProject = project;
		selectedEnv = null;
		environments = await api.environments.list(project.id);
	}

	async function selectEnv(id: number) {
		selectedEnv = await api.environments.get(id);
		showVarForm = false;
	}

	async function addEnv() {
		if (!selectedProject) return;
		await api.environments.create(selectedProject.id, newEnvName);
		newEnvName = 'production';
		showEnvForm = false;
		environments = await api.environments.list(selectedProject.id);
	}

	async function removeEnv(id: number) {
		if (!confirm('Delete this environment and all its variables?')) return;
		await api.environments.remove(id);
		if (selectedEnv?.id === id) selectedEnv = null;
		environments = await api.environments.list(selectedProject.id);
	}

	async function setActive(environment: string) {
		if (!selectedProject) return;
		await api.environments.setActive(selectedProject.id, environment);
		selectedProject.active_environment = environment;
		projects = await api.projects.list();
	}

	async function addVar() {
		if (!selectedEnv) return;
		await api.environments.addVar(selectedEnv.id, varForm);
		varForm = { key: '', value: '' };
		showVarForm = false;
		await selectEnv(selectedEnv.id);
	}

	async function removeVar(id: number) {
		await api.environments.removeVar(id);
		if (selectedEnv) await selectEnv(selectedEnv.id);
	}
</script>

<h1 class="mb-2">Environments</h1>

<div class="mb-2">
	<label class="text-sm text-muted">Project</label>
	<select onchange={(e) => {
		const id = parseInt((e.target as HTMLSelectElement).value);
		const p = projects.find((p) => p.id === id);
		if (p) selectProject(p);
	}}>
		<option value="">Select a project...</option>
		{#each projects as project}
			<option value={project.id}>{project.name}</option>
		{/each}
	</select>
</div>

{#if selectedProject}
	<div class="grid grid-2 gap-2">
		<div>
			<div class="flex justify-between items-center mb-1">
				<h3>Environments</h3>
				<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showEnvForm = !showEnvForm}>
					{showEnvForm ? 'Cancel' : '+ Environment'}
				</button>
			</div>

			{#if showEnvForm}
				<div class="card mb-1">
					<div class="mb-1">
						<select bind:value={newEnvName}>
							<option value="production">Production</option>
							<option value="staging">Staging</option>
							<option value="development">Development</option>
						</select>
					</div>
					<button onclick={addEnv}>Save</button>
				</div>
			{/if}

			{#each environments as env}
				<div class="card mb-1" style="cursor:pointer" role="button" tabindex="0"
					onclick={() => selectEnv(env.id)}
					onkeydown={(e) => e.key === 'Enter' && selectEnv(env.id)}>
					<div class="flex justify-between items-center">
						<div>
							<strong>{env.environment}</strong>
							{#if selectedProject.active_environment === env.environment}
								<span class="badge online" style="margin-left:0.5rem">active</span>
							{/if}
							<span class="text-sm text-muted" style="margin-left:0.5rem">{env.var_count} vars</span>
						</div>
						<div class="flex gap-1">
							{#if selectedProject.active_environment !== env.environment}
								<button style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={(e) => { e.stopPropagation(); setActive(env.environment); }}>Activate</button>
							{/if}
							<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem"
								onclick={(e) => { e.stopPropagation(); removeEnv(env.id); }}>x</button>
						</div>
					</div>
				</div>
			{/each}
			{#if environments.length === 0}
				<div class="card text-muted">No environments configured</div>
			{/if}
		</div>

		<div>
			{#if selectedEnv}
				<div class="flex justify-between items-center mb-1">
					<h3>{selectedEnv.environment} — Variables</h3>
					<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showVarForm = !showVarForm}>
						{showVarForm ? 'Cancel' : '+ Variable'}
					</button>
				</div>

				{#if showVarForm}
					<div class="card mb-1">
						<div class="flex gap-1 mb-1">
							<input bind:value={varForm.key} placeholder="KEY" style="flex:1" />
							<input bind:value={varForm.value} placeholder="value" style="flex:2" />
						</div>
						<button onclick={addVar}>Add</button>
					</div>
				{/if}

				<div class="card">
					<table>
						<thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
						<tbody>
							{#each selectedEnv.vars || [] as v}
								<tr>
									<td><code>{v.key}</code></td>
									<td><code>{v.value}</code></td>
									<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if !selectedEnv.vars?.length}
						<div class="text-muted" style="padding:0.75rem">No variables</div>
					{/if}
				</div>
			{:else}
				<div class="card text-muted">Select an environment to view variables</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="card text-muted">Select a project to manage its environments</div>
{/if}
