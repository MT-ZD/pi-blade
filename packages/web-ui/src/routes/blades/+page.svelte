<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let blades = $state<any[]>([]);
	let metrics = $state<Record<string, any>>({});
	let masterVersion = $state('');

	onMount(async () => {
		await refresh();
	});

	async function refresh() {
		const [b, m, v] = await Promise.all([api.blades.list(), api.metrics.all(), api.version()]);
		blades = b;
		metrics = m;
		masterVersion = v.short;
	}

	async function removeBlade(id: number) {
		if (!confirm('Remove this blade?')) return;
		await api.blades.remove(id);
		await refresh();
	}

	function usageClass(pct: number): string {
		if (pct > 80) return 'crit';
		if (pct > 60) return 'warn';
		return 'ok';
	}
</script>

<div class="flex justify-between items-center mb-2">
	<h1>Blades</h1>
	<div class="flex items-center gap-1">
		{#if masterVersion}
			<span class="text-sm text-muted">master: {masterVersion}</span>
		{/if}
		<button class="secondary" onclick={refresh}>Refresh</button>
	</div>
</div>

<div class="grid grid-3">
	{#each blades as blade}
		{@const m = metrics[blade.id]}
		<div class="card">
			<div class="flex justify-between items-center mb-1">
				<h3>{blade.name}</h3>
				<span class="badge {blade.status}">{blade.status}</span>
			</div>
			<div class="text-sm text-muted mb-1">{blade.hostname}</div>
			{#if m?.version}
				{@const bladeV = m.version.slice(0, 12)}
				<div class="text-sm mb-2" style="font-family:monospace">
					{bladeV}
					{#if masterVersion && bladeV !== masterVersion}
						<span style="color:var(--warning)" title="Version mismatch with master"> !</span>
					{/if}
				</div>
			{/if}

			{#if m}
				<div class="mb-1">
					<div class="flex justify-between text-sm"><span>CPU</span><span>{m.cpuPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(m.cpuPercent)}" style="width:{m.cpuPercent}%"></div></div>
				</div>
				<div class="mb-1">
					<div class="flex justify-between text-sm"><span>RAM</span><span>{m.memoryPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(m.memoryPercent)}" style="width:{m.memoryPercent}%"></div></div>
				</div>
				<div class="mb-1">
					<div class="flex justify-between text-sm"><span>Disk</span><span>{m.diskPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(m.diskPercent)}" style="width:{m.diskPercent}%"></div></div>
				</div>
				{#if m.containers?.length > 0}
					<div class="mt-2 text-sm">
						<strong>{m.containers.length} container(s)</strong>
					</div>
				{/if}
			{:else}
				<div class="text-muted text-sm">No metrics available</div>
			{/if}

			<div class="mt-2">
				<button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeBlade(blade.id)}>Remove</button>
			</div>
		</div>
	{/each}
</div>

{#if blades.length === 0}
	<div class="card text-muted">No blades registered. Run the setup script on a Raspberry Pi to add one.</div>
{/if}
