<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let allDeploys = $state<any[]>([]);
	let search = $state('');
	let sortBy = $state('timestamp');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let pageNum = $state(1);
	const perPage = 20;

	onMount(async () => { allDeploys = await api.deploys.list(); });

	function filtered() {
		let d = allDeploys;
		if (search) {
			const q = search.toLowerCase();
			d = d.filter((x: any) =>
				x.project_name?.toLowerCase().includes(q) ||
				x.blade_name?.toLowerCase().includes(q) ||
				x.branch?.toLowerCase().includes(q) ||
				x.image_tag?.toLowerCase().includes(q) ||
				x.status?.toLowerCase().includes(q)
			);
		}
		d = [...d].sort((a: any, b: any) => {
			const av = a[sortBy] || '', bv = b[sortBy] || '';
			const cmp = av < bv ? -1 : av > bv ? 1 : 0;
			return sortDir === 'asc' ? cmp : -cmp;
		});
		return d;
	}

	function paged() {
		const f = filtered();
		return f.slice((pageNum - 1) * perPage, pageNum * perPage);
	}

	function totalPages() { return Math.max(1, Math.ceil(filtered().length / perPage)); }

	function toggleSort(col: string) {
		if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortBy = col; sortDir = 'desc'; }
		pageNum = 1;
	}

	function sortIcon(col: string) {
		if (sortBy !== col) return '';
		return sortDir === 'asc' ? ' ▲' : ' ▼';
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Deploy History</h1>
	<input bind:value={search} placeholder="Search deploys..." style="width:250px" oninput={() => pageNum = 1} />
</div>

<div class="card">
	<table>
		<thead>
			<tr>
				<th style="cursor:pointer" onclick={() => toggleSort('project_name')}>Project{sortIcon('project_name')}</th>
				<th style="cursor:pointer" onclick={() => toggleSort('blade_name')}>Blade{sortIcon('blade_name')}</th>
				<th style="cursor:pointer" onclick={() => toggleSort('branch')}>Branch{sortIcon('branch')}</th>
				<th>Image</th>
				<th style="cursor:pointer" onclick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
				<th style="cursor:pointer" onclick={() => toggleSort('trigger')}>Trigger{sortIcon('trigger')}</th>
				<th style="cursor:pointer" onclick={() => toggleSort('timestamp')}>Time{sortIcon('timestamp')}</th>
			</tr>
		</thead>
		<tbody>
			{#each paged() as d}
				<tr>
					<td><a href="/projects/{d.project_id}">{d.project_name}</a></td>
					<td><a href="/blades/{d.blade_id}">{d.blade_name}</a></td>
					<td><code>{d.branch || '-'}</code></td>
					<td><a href="/deploys/{d.id}"><code>{d.image_tag}</code></a></td>
					<td><span class="badge {d.status}">{d.status}</span></td>
					<td class="text-sm text-muted">{d.trigger || 'manual'}</td>
					<td class="text-muted text-sm">{new Date(d.timestamp + 'Z').toLocaleString()}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if filtered().length === 0}
		<div class="text-muted" style="padding:1rem">{search ? 'No matching deploys' : 'No deploys yet'}</div>
	{/if}
	{#if totalPages() > 1}
		<div class="flex justify-between items-center" style="padding:0.75rem">
			<span class="text-sm text-muted">{filtered().length} deploys</span>
			<div class="flex gap-1 items-center">
				<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" disabled={pageNum <= 1} onclick={() => pageNum--}>Prev</button>
				<span class="text-sm">{pageNum} / {totalPages()}</span>
				<button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem" disabled={pageNum >= totalPages()} onclick={() => pageNum++}>Next</button>
			</div>
		</div>
	{/if}
</div>
