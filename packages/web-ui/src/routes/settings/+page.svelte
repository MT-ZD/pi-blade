<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';

	let webhookUrl = $state('');
	let saved = $state(false);

	onMount(async () => {
		const data = await api.discord.get();
		webhookUrl = data.url;
	});

	async function save() {
		await api.discord.set(webhookUrl);
		saved = true;
		setTimeout(() => saved = false, 2000);
	}
</script>

<h1 class="mb-2">Settings</h1>

<div class="card" style="max-width:600px">
	<h3 class="mb-2">Discord Webhook</h3>
	<p class="text-sm text-muted mb-1">Alerts will be sent to this Discord webhook URL when blades go down or deploys fail.</p>
	<div class="flex gap-1">
		<input bind:value={webhookUrl} placeholder="https://discord.com/api/webhooks/..." style="flex:1" />
		<button onclick={save}>{saved ? 'Saved!' : 'Save'}</button>
	</div>
</div>
