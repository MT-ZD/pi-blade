<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import { Chart, LineController, LineElement, PointElement, LinearScale, Filler, Tooltip } from 'chart.js';
	import 'chart.js/auto';

	Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

	let blade = $state<any>(null);
	let allBlades = $state<any[]>([]);
	let metrics = $state<any>(null);
	let masterVersion = $state('');
	let deploys = $state<any[]>([]);
	let charts = new Map<string, Chart>();

	const bladeId = parseInt($page.params.id);

	onMount(async () => {
		const [blades, m, v, allDeploys] = await Promise.all([
			api.blades.list(), api.metrics.all(), api.version(), api.deploys.list()
		]);
		allBlades = blades;
		blade = blades.find((b: any) => b.id === bladeId);
		metrics = m[bladeId];
		masterVersion = v.short;
		deploys = allDeploys.filter((d: any) => d.blade_id === bladeId).slice(0, 20);
		if (blade) loadHistory();
	});

	function usageClass(pct: number): string {
		if (pct > 80) return 'crit';
		if (pct > 60) return 'warn';
		return 'ok';
	}

	async function loadHistory() {
		const history = await api.metrics.history(bladeId);
		if (history.length === 0) return;

		const maxPoints = 200;
		let data = history;
		if (history.length > maxPoints) {
			const step = Math.ceil(history.length / maxPoints);
			data = history.filter((_: any, i: number) => i % step === 0);
		}
		const labels = data.map((h: any) => new Date(h.timestamp + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

		createChart('cpu', labels, data.map((h: any) => h.cpu_percent), 'CPU %', '#3b82f6');
		createChart('mem', labels, data.map((h: any) => h.memory_percent), 'RAM %', '#8b5cf6');
		createChart('disk', labels, data.map((h: any) => h.disk_percent), 'Disk %', '#f59e0b');
	}

	function createChart(metric: string, labels: string[], data: number[], label: string, color: string) {
		const el = document.getElementById(`chart-${metric}`) as HTMLCanvasElement;
		if (!el) return;
		if (charts.has(metric)) charts.get(metric)!.destroy();
		charts.set(metric, new Chart(el, {
			type: 'line',
			data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: color + '20', borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.3 }] },
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
				scales: {
					x: { ticks: { maxTicksLimit: 6, font: { size: 10 }, color: '#888' }, grid: { display: false } },
					y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 10 }, color: '#888' }, grid: { color: '#333' } }
				},
				interaction: { mode: 'nearest', axis: 'x', intersect: false },
			}
		}));
	}

	async function removeBlade() {
		if (!confirm('Remove this blade?')) return;
		await api.blades.remove(bladeId);
		window.location.href = '/blades';
	}
</script>

{#if blade}
	<div class="flex justify-between items-center mb-2">
		<div>
			<a href="/blades" class="text-sm text-muted">&larr; Blades</a>
			<h1 style="margin-top:0.25rem">{blade.name}</h1>
		</div>
		<div class="flex gap-1">
			<span class="badge {blade.status}">{blade.status}</span>
			<button class="danger" onclick={removeBlade}>Remove</button>
		</div>
	</div>

	<div class="card mb-2">
		<div class="grid grid-3 gap-2 text-sm">
			<div><span class="text-muted">Hostname:</span> {blade.hostname}</div>
			<div><span class="text-muted">Registered:</span> {new Date(blade.registered_at + 'Z').toLocaleString()}</div>
			<div>
				<span class="text-muted">Version:</span>
				{#if metrics?.version}
					<code>{metrics.version.slice(0, 12)}</code>
					{#if masterVersion && metrics.version.slice(0, 12) !== masterVersion}
						<span style="color:var(--warning)" title="Mismatch"> !</span>
					{/if}
				{:else}
					<span class="text-muted">unknown</span>
				{/if}
			</div>
		</div>
	</div>

	{#if metrics}
		<h2 class="mb-1">Current Usage</h2>
		<div class="card mb-2">
			<div class="grid grid-3 gap-2">
				<div>
					<div class="flex justify-between text-sm"><span>CPU</span><span>{metrics.cpuPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(metrics.cpuPercent)}" style="width:{metrics.cpuPercent}%"></div></div>
				</div>
				<div>
					<div class="flex justify-between text-sm"><span>RAM</span><span>{metrics.memoryPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(metrics.memoryPercent)}" style="width:{metrics.memoryPercent}%"></div></div>
				</div>
				<div>
					<div class="flex justify-between text-sm"><span>Disk</span><span>{metrics.diskPercent}%</span></div>
					<div class="progress-bar"><div class="fill {usageClass(metrics.diskPercent)}" style="width:{metrics.diskPercent}%"></div></div>
				</div>
			</div>
			{#if metrics.containers?.length > 0}
				<div class="mt-2 text-sm"><strong>{metrics.containers.length} container(s) running</strong></div>
			{/if}
		</div>
	{/if}

	<h2 class="mb-1">History (Past Week)</h2>
	<div class="card mb-2">
		<div class="grid grid-3 gap-2">
			<div>
				<div class="text-sm text-muted mb-1">CPU</div>
				<div style="height:180px"><canvas id="chart-cpu"></canvas></div>
			</div>
			<div>
				<div class="text-sm text-muted mb-1">RAM</div>
				<div style="height:180px"><canvas id="chart-mem"></canvas></div>
			</div>
			<div>
				<div class="text-sm text-muted mb-1">Disk</div>
				<div style="height:180px"><canvas id="chart-disk"></canvas></div>
			</div>
		</div>
	</div>

	<h2 class="mb-1">Recent Deploys</h2>
	<div class="card">
		<table>
			<thead><tr><th>Project</th><th>Branch</th><th>Image</th><th>Status</th><th>Time</th></tr></thead>
			<tbody>
				{#each deploys as d}
					<tr>
						<td><a href="/projects/{d.project_id}">{d.project_name}</a></td>
						<td><code>{d.branch || '-'}</code></td>
						<td><a href="/deploys/{d.id}"><code>{d.image_tag}</code></a></td>
						<td><span class="badge {d.status}">{d.status}</span></td>
						<td class="text-muted text-sm">{new Date(d.timestamp + 'Z').toLocaleString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if deploys.length === 0}
			<div class="text-muted" style="padding:0.75rem">No deploys on this blade</div>
		{/if}
	</div>
{:else}
	<div class="card text-muted">Loading...</div>
{/if}
