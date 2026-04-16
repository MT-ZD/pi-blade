<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let routes = $state<any[]>([]);
	let projects = $state<any[]>([]);
	let blades = $state<any[]>([]);
	let showForm = $state(false);
	let form = $state({ domain: '', projectId: 0, upstreams: [] as { bladeId: number; port: number; weight: number }[] });

	let editingRoute = $state<number | null>(null);
	let editDomain = $state('');
	let editProjectId = $state(0);
	let addingUpstreamTo = $state<number | null>(null);
	let newUpstream = $state({ bladeId: 0, port: 8080, weight: 1 });

	onMount(async () => {
		const [r, p, b] = await Promise.all([api.routes.list(), api.projects.list(), api.blades.list()]);
		routes = r;
		projects = p;
		blades = b;
		if (projects.length > 0) form.projectId = projects[0].id;
		if (blades.length > 0) newUpstream.bladeId = blades[0].id;
	});

	async function refresh() { routes = await api.routes.list(); }

	async function addRoute() {
		await api.routes.create(form);
		form = { domain: '', projectId: projects[0]?.id || 0, upstreams: [] };
		showForm = false;
		await refresh();
	}

	function addFormUpstream() {
		if (blades.length === 0) return;
		form.upstreams = [...form.upstreams, { bladeId: blades[0].id, port: 8080, weight: 1 }];
	}

	async function removeRoute(id: number) {
		if (!confirm('Delete this route?')) return;
		await api.routes.remove(id);
		await refresh();
	}

	function startEditRoute(route: any) {
		editingRoute = route.id;
		editDomain = route.domain;
		editProjectId = route.project_id;
	}

	async function saveEditRoute() {
		if (editingRoute === null) return;
		await api.routes.update(editingRoute, { domain: editDomain, projectId: editProjectId });
		editingRoute = null;
		await refresh();
	}

	function startAddUpstream(routeId: number) {
		addingUpstreamTo = routeId;
		newUpstream = { bladeId: blades[0]?.id || 0, port: 8080, weight: 1 };
	}

	async function addUpstreamToRoute() {
		if (addingUpstreamTo === null) return;
		await api.routes.addUpstream(addingUpstreamTo, newUpstream);
		addingUpstreamTo = null;
		await refresh();
	}

	async function removeUpstream(id: number) {
		await api.routes.removeUpstream(id);
		await refresh();
	}

	async function reloadNginx() {
		await api.nginx.reload();
		alert('Nginx reloaded');
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Routing</h1>
	<div class="flex gap-1">
		<button class="secondary" onclick={reloadNginx}>Reload Nginx</button>
		<button onclick={() => showForm = !showForm}>{showForm ? 'Cancel' : 'Add Route'}</button>
	</div>
</div>

{#if showForm}
	<div class="card mb-2">
		<div class="grid grid-2 gap-2 mb-1">
			<div>
				<label class="text-sm text-muted">Domain</label>
				<input bind:value={form.domain} placeholder="app.example.com" />
			</div>
			<div>
				<label class="text-sm text-muted">Project</label>
				<select bind:value={form.projectId}>
					{#each projects as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
		</div>
		<div class="mb-1">
			<div class="flex justify-between items-center mb-1">
				<span class="text-sm text-muted">Upstreams</span>
				<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={addFormUpstream}>+ Upstream</button>
			</div>
			{#each form.upstreams as u, i}
				<div class="flex gap-1 items-center mb-1">
					<select bind:value={u.bladeId} style="flex:1">
						{#each blades as b}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
					<input type="number" bind:value={u.port} placeholder="Port" style="width:80px" />
					<input type="number" bind:value={u.weight} placeholder="Weight" style="width:70px" />
					<button class="danger" style="font-size:0.75rem;padding:0.25rem 0.5rem" onclick={() => { form.upstreams = form.upstreams.filter((_, j) => j !== i); }}>x</button>
				</div>
			{/each}
		</div>
		<button onclick={addRoute}>Save</button>
	</div>
{/if}

{#each routes as route}
	<div class="card mb-1">
		<div class="flex justify-between items-center mb-1">
			{#if editingRoute === route.id}
				<div class="flex gap-1 items-center" style="flex:1;margin-right:0.5rem">
					<input bind:value={editDomain} style="font-size:0.85rem;flex:1" />
					<select bind:value={editProjectId} style="font-size:0.85rem;width:auto">
						{#each projects as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
					<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={saveEditRoute}>Save</button>
					<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => editingRoute = null}>Cancel</button>
				</div>
			{:else}
				<div>
					<strong>{route.domain}</strong>
					<span class="text-muted text-sm"> &rarr; {route.project_name}</span>
				</div>
				<div class="flex gap-1">
					<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => startEditRoute(route)}>Edit</button>
					<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => startAddUpstream(route.id)}>+ Upstream</button>
					<button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeRoute(route.id)}>Delete</button>
				</div>
			{/if}
		</div>

		{#if addingUpstreamTo === route.id}
			<div class="flex gap-1 items-center mb-1" style="padding:0.5rem;background:var(--bg);border-radius:4px">
				<select bind:value={newUpstream.bladeId} style="flex:1;font-size:0.85rem">
					{#each blades as b}
						<option value={b.id}>{b.name}</option>
					{/each}
				</select>
				<input type="number" bind:value={newUpstream.port} placeholder="Port" style="width:80px;font-size:0.85rem" />
				<input type="number" bind:value={newUpstream.weight} placeholder="Weight" style="width:70px;font-size:0.85rem" />
				<button style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={addUpstreamToRoute}>Add</button>
				<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => addingUpstreamTo = null}>Cancel</button>
			</div>
		{/if}

		{#if route.upstreams?.length > 0}
			<table>
				<thead><tr><th>Blade</th><th>Port</th><th>Weight</th><th></th></tr></thead>
				<tbody>
					{#each route.upstreams.filter((u: any) => u.id) as u}
						<tr>
							<td>{u.bladeName}</td>
							<td>{u.port}</td>
							<td>{u.weight}</td>
							<td><button class="danger" style="font-size:0.7rem;padding:0.2rem 0.4rem" onclick={() => removeUpstream(u.id)}>x</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/each}

{#if routes.length === 0 && !showForm}
	<div class="card text-muted">No routes configured</div>
{/if}
