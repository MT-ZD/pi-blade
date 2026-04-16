<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let webhookUrl = $state('');
	let saved = $state(false);
	let newPassword = $state('');
	let passwordSaved = $state(false);

	// Import/Export
	let importFile = $state<any>(null);
	let importPreview = $state<any>(null);
	let importError = $state('');
	let conflictStrategy = $state<'skip' | 'overwrite'>('skip');
	let importing = $state(false);
	let importDone = $state(false);

	onMount(async () => {
		const data = await api.discord.get();
		webhookUrl = data.url;
	});

	async function save() {
		await api.discord.set(webhookUrl);
		saved = true;
		setTimeout(() => saved = false, 2000);
	}

	async function setPassword() {
		if (!newPassword) return;
		await api.auth.setPassword(newPassword);
		newPassword = '';
		passwordSaved = true;
		setTimeout(() => passwordSaved = false, 2000);
	}

	async function exportConfig() {
		const config = await api.config.export();
		const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `pi-blade-config-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importPreview = null;
		importError = '';
		importDone = false;

		try {
			const text = await file.text();
			importFile = JSON.parse(text);
			await previewImport();
		} catch (err: any) {
			importError = 'Invalid JSON: ' + err.message;
		}
	}

	async function previewImport() {
		if (!importFile) return;
		try {
			importPreview = await api.config.import(importFile, 'preview', conflictStrategy);
		} catch (err: any) {
			importError = err.message;
		}
	}

	async function applyImport() {
		if (!importFile) return;
		importing = true;
		try {
			const result = await api.config.import(importFile, 'apply', conflictStrategy);
			if (result.applied) {
				importDone = true;
				importPreview = null;
			} else {
				importPreview = result;
			}
		} catch (err: any) {
			importError = err.message;
		} finally {
			importing = false;
		}
	}

	function actionClass(action: string): string {
		if (action === 'create') return 'online';
		if (action === 'overwrite') return 'degraded';
		return 'pending';
	}
</script>

<h1 class="mb-2">Settings</h1>

<div class="card mb-2" style="max-width:600px">
	<h3 class="mb-2">Dashboard Password</h3>
	<p class="text-sm text-muted mb-1">Set a password to protect the dashboard. Can also be set via <code>PI_BLADE_PASSWORD</code> env var.</p>
	<div class="flex gap-1">
		<input type="password" bind:value={newPassword} placeholder="New password" style="flex:1" />
		<button onclick={setPassword}>{passwordSaved ? 'Saved!' : 'Set Password'}</button>
	</div>
</div>

<div class="card mb-2" style="max-width:600px">
	<h3 class="mb-2">Discord Webhook</h3>
	<p class="text-sm text-muted mb-1">Alerts sent to this webhook when blades go down or deploys fail.</p>
	<div class="flex gap-1">
		<input bind:value={webhookUrl} placeholder="https://discord.com/api/webhooks/..." style="flex:1" />
		<button onclick={save}>{saved ? 'Saved!' : 'Save'}</button>
	</div>
</div>

<div class="card mb-2" style="max-width:800px">
	<h3 class="mb-2">Export Configuration</h3>
	<p class="text-sm text-muted mb-1">Download all repos, projects, branches, env vars, routes, and settings as JSON. SSH keys are excluded.</p>
	<button onclick={exportConfig}>Export Config</button>
</div>

<div class="card" style="max-width:800px">
	<h3 class="mb-2">Import Configuration</h3>
	<p class="text-sm text-muted mb-1">Upload a previously exported config file. Preview changes before applying.</p>

	<div class="flex gap-2 items-end mb-2">
		<div style="flex:1">
			<input type="file" accept=".json" onchange={handleFileSelect} />
		</div>
		<div>
			<label class="text-sm text-muted">Conflicts</label>
			<select bind:value={conflictStrategy} onchange={previewImport} style="width:auto">
				<option value="skip">Skip existing</option>
				<option value="overwrite">Overwrite</option>
			</select>
		</div>
	</div>

	{#if importError}
		<div style="color:var(--danger);margin-bottom:1rem" class="text-sm">{importError}</div>
	{/if}

	{#if importDone}
		<div class="badge online" style="padding:0.5rem 1rem;font-size:0.875rem">Import complete!</div>
	{/if}

	{#if importPreview}
		{#if importPreview.errors?.length > 0}
			<div class="mb-2">
				<strong class="text-sm" style="color:var(--danger)">Errors:</strong>
				{#each importPreview.errors as err}
					<div class="text-sm" style="color:var(--danger);margin-left:0.5rem">{err}</div>
				{/each}
			</div>
		{/if}

		{#if importPreview.warnings?.length > 0}
			<div class="mb-2">
				<strong class="text-sm" style="color:var(--warning)">Warnings:</strong>
				{#each importPreview.warnings as warn}
					<div class="text-sm" style="color:var(--warning);margin-left:0.5rem">{warn}</div>
				{/each}
			</div>
		{/if}

		{#if importPreview.plan}
			{@const p = importPreview.plan}
			{#if p.repos?.length > 0}
				<div class="mb-1">
					<strong class="text-sm">Repos ({p.repos.length})</strong>
					<table>
						<tbody>
							{#each p.repos as r}
								<tr>
									<td class="text-sm">{r.url}</td>
									<td><span class="badge {actionClass(r.action)}">{r.action}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if p.projects?.length > 0}
				<div class="mb-1">
					<strong class="text-sm">Projects ({p.projects.length})</strong>
					<table>
						<tbody>
							{#each p.projects as proj}
								<tr>
									<td class="text-sm">{proj.name}</td>
									<td><span class="badge {actionClass(proj.action)}">{proj.action}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if p.routes?.length > 0}
				<div class="mb-1">
					<strong class="text-sm">Routes ({p.routes.length})</strong>
					<table>
						<tbody>
							{#each p.routes as route}
								<tr>
									<td class="text-sm">{route.domain}</td>
									<td><span class="badge {actionClass(route.action)}">{route.action}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if p.settings?.length > 0}
				<div class="mb-1">
					<strong class="text-sm">Settings ({p.settings.length})</strong>
					<table>
						<tbody>
							{#each p.settings as s}
								<tr>
									<td class="text-sm">{s.key}</td>
									<td><span class="badge {actionClass(s.action)}">{s.action}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if importPreview.valid}
				<button onclick={applyImport} disabled={importing} style="margin-top:1rem">
					{importing ? 'Importing...' : 'Confirm Import'}
				</button>
			{/if}
		{/if}
	{/if}
</div>
