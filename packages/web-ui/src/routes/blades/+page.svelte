<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend } from 'chart.js';
	import 'chart.js/auto';

	Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend);

	let blades = $state<any[]>([]);
	let metrics = $state<Record<string, any>>({});
	let masterVersion = $state('');
	let expandedBlade = $state<number | null>(null);
	let charts = new Map<string, Chart>();

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

	async function toggleHistory(bladeId: number) {
		if (expandedBlade === bladeId) {
			destroyCharts(bladeId);
			expandedBlade = null;
			return;
		}
		expandedBlade = bladeId;

		// Wait for DOM
		await new Promise((r) => setTimeout(r, 50));

		const history = await api.metrics.history(bladeId);
		if (history.length === 0) return;

		const labels = history.map((h: any) => new Date(h.timestamp + 'Z').toLocaleString(undefined, {
			month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
		}));

		// Downsample if too many points (keep ~200 points for performance)
		const maxPoints = 200;
		let data = history;
		let displayLabels = labels;
		if (history.length > maxPoints) {
			const step = Math.ceil(history.length / maxPoints);
			data = history.filter((_: any, i: number) => i % step === 0);
			displayLabels = labels.filter((_: any, i: number) => i % step === 0);
		}

		createChart(bladeId, 'cpu', displayLabels, data.map((h: any) => h.cpu_percent), 'CPU %', '#3b82f6');
		createChart(bladeId, 'mem', displayLabels, data.map((h: any) => h.memory_percent), 'RAM %', '#8b5cf6');
		createChart(bladeId, 'disk', displayLabels, data.map((h: any) => h.disk_percent), 'Disk %', '#f59e0b');
	}

	function createChart(bladeId: number, metric: string, labels: string[], data: number[], label: string, color: string) {
		const key = `${bladeId}-${metric}`;
		if (charts.has(key)) charts.get(key)!.destroy();

		const el = document.getElementById(`chart-${key}`) as HTMLCanvasElement;
		if (!el) return;

		const chart = new Chart(el, {
			type: 'line',
			data: {
				labels,
				datasets: [{
					label,
					data,
					borderColor: color,
					backgroundColor: color + '20',
					borderWidth: 1.5,
					pointRadius: 0,
					fill: true,
					tension: 0.3,
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: { mode: 'index', intersect: false },
				},
				scales: {
					x: {
						display: true,
						ticks: { maxTicksLimit: 6, font: { size: 10 }, color: '#888' },
						grid: { display: false },
					},
					y: {
						min: 0,
						max: 100,
						ticks: { stepSize: 25, font: { size: 10 }, color: '#888' },
						grid: { color: '#333' },
					}
				},
				interaction: { mode: 'nearest', axis: 'x', intersect: false },
			}
		});
		charts.set(key, chart);
	}

	function destroyCharts(bladeId: number) {
		for (const metric of ['cpu', 'mem', 'disk']) {
			const key = `${bladeId}-${metric}`;
			if (charts.has(key)) {
				charts.get(key)!.destroy();
				charts.delete(key);
			}
		}
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

			<div class="mt-2 flex gap-1">
				<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => toggleHistory(blade.id)}>
					{expandedBlade === blade.id ? 'Hide History' : 'History'}
				</button>
				<button class="danger" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={() => removeBlade(blade.id)}>Remove</button>
			</div>
		</div>
	{/each}
</div>

{#if expandedBlade}
	{@const blade = blades.find((b) => b.id === expandedBlade)}
	{#if blade}
		<div class="card mt-2">
			<h3 class="mb-2">{blade.name} — Past Week</h3>
			<div class="grid grid-3 gap-2">
				<div>
					<div class="text-sm text-muted mb-1">CPU</div>
					<div style="height:180px"><canvas id="chart-{blade.id}-cpu"></canvas></div>
				</div>
				<div>
					<div class="text-sm text-muted mb-1">RAM</div>
					<div style="height:180px"><canvas id="chart-{blade.id}-mem"></canvas></div>
				</div>
				<div>
					<div class="text-sm text-muted mb-1">Disk</div>
					<div style="height:180px"><canvas id="chart-{blade.id}-disk"></canvas></div>
				</div>
			</div>
		</div>
	{/if}
{/if}

{#if blades.length === 0}
	<div class="card text-muted">No blades registered. Run the setup script on a Raspberry Pi to add one.</div>
{/if}
