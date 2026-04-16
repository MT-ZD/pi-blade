<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';

	let deploy = $state<any>(null);
	let logLines = $state<string[]>([]);
	let logDone = $state(false);
	let containerLogLines = $state<string[]>([]);
	let containerLogLoading = $state(false);
	let health = $state<any>(null);
	let logEventSource: EventSource | null = null;

	const deployId = parseInt($page.params.id);

	onMount(async () => {
		deploy = await api.deploys.get(deployId);
		loadLogs();
		checkHealth();
	});

	async function checkHealth() {
		if (!deploy || deploy.status !== 'running') return;
		const containerName = `${deploy.project_name.toLowerCase()}-${(deploy.branch || 'main').replace(/\//g, '-')}`;
		try {
			health = await api.blades.containerHealth(deploy.blade_id, containerName);
		} catch {}
	}

	onDestroy(() => {
		logEventSource?.close();
	});

	async function loadLogs() {
		if (!deploy) return;

		// Try live SSE first
		const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
		try {
			const activeRes = await fetch('/api/builds/active', {
				headers: token ? { 'Authorization': `Bearer ${token}` } : {}
			});
			const active = await activeRes.json() as any[];
			const key = `${deploy.project_name}:${deploy.image_tag}`;
			if (active.find((a: any) => a.key === key)) {
				openSSE(token);
				return;
			}
		} catch {}

		// Fall back to stored log
		logDone = true;
		try {
			const res = await fetch(`/api/deploys/${deployId}/log`, {
				headers: token ? { 'Authorization': `Bearer ${token}` } : {}
			});
			const data = await res.json();
			logLines = data.log ? data.log.split('\n') : inProgressMessage();
		} catch {
			logLines = ['Failed to load log'];
		}
	}

	function inProgressMessage(): string[] {
		const inProgress = ['building', 'pushing', 'deploying'].includes(deploy?.status);
		return inProgress ? ['Build in progress...'] : ['No log recorded for this deploy.'];
	}

	function openSSE(token: string | undefined) {
		logDone = false;
		const url = `/api/builds/${encodeURIComponent(deploy.project_name)}/${encodeURIComponent(deploy.image_tag)}/logs${token ? '?token=' + encodeURIComponent(token) : ''}`;
		logEventSource = new EventSource(url);
		logEventSource.onmessage = (e) => {
			const data = JSON.parse(e.data);
			if (data === '__DONE__') {
				logDone = true;
				logEventSource?.close();
				logEventSource = null;
				api.deploys.get(deployId).then((d) => deploy = d);
			} else {
				logLines = [...logLines, data];
				requestAnimationFrame(() => {
					const el = document.getElementById('build-log');
					if (el) el.scrollTop = el.scrollHeight;
				});
			}
		};
		logEventSource.onerror = () => { logDone = true; logEventSource?.close(); logEventSource = null; };
	}

	async function abortBuild() {
		if (!deploy) return;
		const token = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/)?.[1];
		await fetch(`/api/builds/${encodeURIComponent(deploy.project_name)}/${encodeURIComponent(deploy.image_tag)}/abort`, {
			method: 'POST', headers: token ? { 'Authorization': `Bearer ${token}` } : {}
		});
		logDone = true;
		deploy = await api.deploys.get(deployId);
	}

	async function loadContainerLogs() {
		if (!deploy) return;
		containerLogLoading = true;
		const containerName = `${deploy.project_name.toLowerCase()}-${(deploy.branch || 'main').replace(/\//g, '-')}`;
		try {
			const res = await api.blades.containerLogs(deploy.blade_id, containerName, 500);
			containerLogLines = (res.logs || 'No logs').split('\n');
		} catch (e: any) {
			containerLogLines = [`Failed: ${e.message}`];
		} finally {
			containerLogLoading = false;
		}
	}

	async function updateGithubStatus() {
		try {
			const res = await api.deploys.updateGithubStatus(deployId);
			alert(`GitHub status: ${res.state}`);
		} catch (e: any) {
			alert(`Failed: ${e.message}`);
		}
	}

	async function rollback() {
		if (!deploy || !confirm(`Rollback to ${deploy.image_tag}?`)) return;
		await api.rollback({ projectId: deploy.project_id, bladeId: deploy.blade_id, imageTag: deploy.image_tag });
		deploy = await api.deploys.get(deployId);
	}
</script>

{#if deploy}
	<div class="flex justify-between items-center mb-2">
		<div>
			<a href="/deploys" class="text-sm text-muted">&larr; Deploys</a>
			<h1 style="margin-top:0.25rem">Deploy #{deploy.id}</h1>
		</div>
		<div class="flex gap-1">
			{#if !logDone}
				<button class="danger" onclick={abortBuild}>Abort</button>
			{/if}
			{#if deploy.commit_sha}
				<button class="secondary" onclick={updateGithubStatus}>GH Status</button>
			{/if}
			{#if deploy.status === 'running'}
				<button class="secondary" onclick={rollback}>Rollback</button>
			{/if}
		</div>
	</div>

	<div class="card mb-2">
		<div class="grid grid-3 gap-2 text-sm">
			<div><span class="text-muted">Project:</span> <a href="/projects/{deploy.project_id}">{deploy.project_name}</a></div>
			<div><span class="text-muted">Branch:</span> <code>{deploy.branch || '-'}</code></div>
			<div><span class="text-muted">Status:</span> <span class="badge {deploy.status}">{deploy.status}</span></div>
			<div><span class="text-muted">Image:</span> <code>{deploy.image_tag}</code></div>
			<div><span class="text-muted">Commit:</span> <code>{deploy.commit_sha || '-'}</code></div>
			<div><span class="text-muted">Blade:</span> <a href="/blades/{deploy.blade_id}">{deploy.blade_name}</a></div>
			<div><span class="text-muted">Time:</span> {new Date(deploy.timestamp + 'Z').toLocaleString()}</div>
			<div><span class="text-muted">Repo:</span> {deploy.repo_url}</div>
			{#if health}
				<div>
					<span class="text-muted">Health:</span>
					{#if health.healthy}
						<span class="badge online" style="font-size:0.7rem">healthy</span>
					{:else if health.running}
						<span class="badge degraded" style="font-size:0.7rem">degraded</span>
					{:else}
						<span class="badge offline" style="font-size:0.7rem">down</span>
					{/if}
					{#if health.uptime}<span class="text-sm text-muted" style="margin-left:0.3rem">up {health.uptime}</span>{/if}
					{#if health.restartCount > 0}<span class="text-sm" style="color:var(--warning);margin-left:0.3rem">{health.restartCount} restarts</span>{/if}
					{#if health.httpStatus !== null}<span class="text-sm text-muted" style="margin-left:0.3rem">HTTP {health.httpStatus}</span>{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if deploy.status === 'running'}
		<h2 class="mb-1">Container Log</h2>
		<div class="card mb-2">
			<div class="flex justify-between items-center mb-1">
				<span class="text-sm text-muted">{deploy.project_name.toLowerCase()}-{(deploy.branch || 'main').replace(/\//g, '-')} on {deploy.blade_name}</span>
				<button class="secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick={loadContainerLogs}>
					{containerLogLoading ? 'Loading...' : containerLogLines.length ? 'Refresh' : 'Load Logs'}
				</button>
			</div>
			{#if containerLogLines.length > 0}
				<div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;max-height:400px;overflow-y:auto;font-family:monospace;font-size:0.75rem;line-height:1.5;white-space:pre-wrap;word-break:break-all">
					{containerLogLines.join('\n')}
				</div>
			{/if}
		</div>
	{/if}

	<h2 class="mb-1">Build Log</h2>
	<div class="card mb-2">
		<div class="flex justify-between items-center mb-1">
			{#if !logDone}
				<span class="badge building">live</span>
			{:else}
				<span class="badge online">done</span>
			{/if}
		</div>
		<div id="build-log" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;max-height:500px;overflow-y:auto;font-family:monospace;font-size:0.75rem;line-height:1.5;white-space:pre-wrap;word-break:break-all">
			{logLines.join('\n')}
		</div>
	</div>
{:else}
	<div class="card text-muted">Loading...</div>
{/if}
