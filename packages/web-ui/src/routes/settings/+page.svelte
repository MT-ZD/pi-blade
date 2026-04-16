<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let webhookUrl = $state('');
	let saved = $state(false);
	let newPassword = $state('');
	let passwordSaved = $state(false);

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
</script>

<h1 class="mb-2">Settings</h1>

<div class="card mb-2" style="max-width:600px">
	<h3 class="mb-2">Dashboard Password</h3>
	<p class="text-sm text-muted mb-1">Set a password to protect the dashboard. Leave empty and save to disable authentication. Can also be set via <code>PI_BLADE_PASSWORD</code> env var.</p>
	<div class="flex gap-1">
		<input type="password" bind:value={newPassword} placeholder="New password" style="flex:1" />
		<button onclick={setPassword}>{passwordSaved ? 'Saved!' : 'Set Password'}</button>
	</div>
</div>

<div class="card" style="max-width:600px">
	<h3 class="mb-2">Discord Webhook</h3>
	<p class="text-sm text-muted mb-1">Alerts will be sent to this Discord webhook URL when blades go down or deploys fail.</p>
	<div class="flex gap-1">
		<input bind:value={webhookUrl} placeholder="https://discord.com/api/webhooks/..." style="flex:1" />
		<button onclick={save}>{saved ? 'Saved!' : 'Save'}</button>
	</div>
</div>
