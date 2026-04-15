<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let groups = $state<any[]>([]);
	let selectedGroup = $state<any>(null);
	let showGroupForm = $state(false);
	let showVarForm = $state(false);
	let groupForm = $state({ name: '', environment: 'production' });
	let varForm = $state({ key: '', value: '' });

	onMount(async () => { await refresh(); });

	async function refresh() { groups = await api.envGroups.list(); }

	async function selectGroup(id: number) {
		selectedGroup = await api.envGroups.get(id);
		showVarForm = false;
	}

	async function addGroup() {
		await api.envGroups.create(groupForm);
		groupForm = { name: '', environment: 'production' };
		showGroupForm = false;
		await refresh();
	}

	async function removeGroup(id: number) {
		if (!confirm('Delete this env group?')) return;
		await api.envGroups.remove(id);
		if (selectedGroup?.id === id) selectedGroup = null;
		await refresh();
	}

	async function addVar() {
		if (!selectedGroup) return;
		await api.envGroups.addVar(selectedGroup.id, varForm);
		varForm = { key: '', value: '' };
		showVarForm = false;
		await selectGroup(selectedGroup.id);
	}

	async function removeVar(id: number) {
		await api.envGroups.removeVar(id);
		if (selectedGroup) await selectGroup(selectedGroup.id);
	}
</script>

<h1 class="mb-2">Environments</h1>

<div class="grid grid-2 gap-2">
	<div>
		<div class="flex justify-between items-center mb-1">
			<h3>Groups</h3>
			<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => showGroupForm = !showGroupForm}>
				{showGroupForm ? 'Cancel' : '+ Group'}
			</button>
		</div>

		{#if showGroupForm}
			<div class="card mb-1">
				<div class="mb-1">
					<input bind:value={groupForm.name} placeholder="Group name" />
				</div>
				<div class="mb-1">
					<select bind:value={groupForm.environment}>
						<option value="production">Production</option>
						<option value="staging">Staging</option>
						<option value="development">Development</option>
					</select>
				</div>
				<button onclick={addGroup}>Save</button>
			</div>
		{/if}

		{#each groups as group}
			<div class="card mb-1" style="cursor:pointer" role="button" tabindex="0"
				onclick={() => selectGroup(group.id)}
				onkeydown={(e) => e.key === 'Enter' && selectGroup(group.id)}>
				<div class="flex justify-between items-center">
					<div>
						<strong>{group.name}</strong>
						<span class="badge" style="margin-left:0.5rem">{group.environment}</span>
					</div>
					<button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem"
						onclick={(e) => { e.stopPropagation(); removeGroup(group.id); }}>x</button>
				</div>
			</div>
		{/each}
		{#if groups.length === 0}
			<div class="card text-muted">No env groups</div>
		{/if}
	</div>

	<div>
		{#if selectedGroup}
			<div class="flex justify-between items-center mb-1">
				<h3>{selectedGroup.name} — Variables</h3>
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
						{#each selectedGroup.vars || [] as v}
							<tr>
								<td><code>{v.key}</code></td>
								<td><code>{v.value}</code></td>
								<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeVar(v.id)}>x</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if !selectedGroup.vars?.length}
					<div class="text-muted" style="padding:0.75rem">No variables</div>
				{/if}
			</div>
		{:else}
			<div class="card text-muted">Select a group to view variables</div>
		{/if}
	</div>
</div>
