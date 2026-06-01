<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { version } from '../../../package.json';
	import { isDev } from '$lib/dev';
	import { debugSettingsAccess } from '$lib/debug-settings-access.svelte';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { settingsStore } from '$lib/settings-store.svelte';
	import { audioPlayer } from '$lib/audio-player.svelte';

	const canAccess = $derived(debugSettingsAccess.visible);

	onMount(() => {
		if (!debugSettingsAccess.visible) {
			goto('/settings');
		}
	});

	function clearLocalSettings() {
		localStorage.removeItem('settings');
		localStorage.removeItem('lastCollectionPath');
		location.reload();
	}
</script>

{#if canAccess}
	<div class="settings-page">
		<h1>Debug</h1>

		<div class="settings-container">
			<section class="settings-section">
				<h2>Environment</h2>
				<dl class="debug-dl">
					<div>
						<dt>Mode</dt>
						<dd>{isDev ? 'Development' : 'Production'}</dd>
					</div>
					<div>
						<dt>Version</dt>
						<dd>{version}</dd>
					</div>
				</dl>
			</section>

			<section class="settings-section">
				<h2>Collection</h2>
				<dl class="debug-dl">
					<div>
						<dt>Path</dt>
						<dd class="mono">{collectionStore.collectionPath ?? '—'}</dd>
					</div>
					<div>
						<dt>Files</dt>
						<dd>{collectionStore.files.length}</dd>
					</div>
					<div>
						<dt>Switching</dt>
						<dd>{collectionStore.switchingCollection ? 'yes' : 'no'}</dd>
					</div>
					<div>
						<dt>Switch UI visible</dt>
						<dd>{collectionStore.showSwitchingUi ? 'yes' : 'no'}</dd>
					</div>
					<div>
						<dt>Loading</dt>
						<dd>{collectionStore.loading ? 'yes' : 'no'}</dd>
					</div>
				</dl>
				<button class="reset-btn" onclick={() => collectionStore.refresh()}>Rescan collection</button>
			</section>

			<section class="settings-section">
				<h2>Playback</h2>
				<dl class="debug-dl">
					<div>
						<dt>Current file</dt>
						<dd class="mono">{audioPlayer.currentFileId ?? '—'}</dd>
					</div>
					<div>
						<dt>Playing</dt>
						<dd>{audioPlayer.isPlaying ? 'yes' : 'no'}</dd>
					</div>
					<div>
						<dt>A–B loop</dt>
						<dd>{audioPlayer.abLoopEnabled ? 'yes' : 'no'}</dd>
					</div>
				</dl>
			</section>

			<section class="settings-section">
				<h2>Storage</h2>
				<button class="reset-btn danger" onclick={clearLocalSettings}>
					Clear localStorage &amp; reload
				</button>
				<p class="description">Removes saved settings and last collection path, then reloads the app.</p>
				<details class="settings-dump">
					<summary>Current settings JSON</summary>
					<pre>{JSON.stringify(
						{
							theme: settingsStore.theme,
							recentCollections: settingsStore.recentCollections,
							titlebarStyle: settingsStore.titlebarStyle,
							titlebarLayout: settingsStore.titlebarLayout
						},
						null,
						2
					)}</pre>
				</details>
			</section>
		</div>
	</div>
{/if}

<style>
	.settings-page {
		padding: 24px;
		height: 100%;
		overflow-y: auto;
		box-sizing: border-box;
	}

	.settings-container {
		display: flex;
		flex-direction: column;
		gap: 32px;
		width: 100%;
	}

	.settings-section h2 {
		border-bottom: 1px solid var(--border-color, #333);
		padding-bottom: 8px;
		margin-bottom: 16px;
		font-size: 1.2rem;
		font-weight: 600;
		color: var(--text-muted, #ccc);
	}

	.debug-dl {
		margin: 0 0 16px;
		display: grid;
		gap: 10px;
	}

	.debug-dl div {
		display: grid;
		grid-template-columns: 140px 1fr;
		gap: 12px;
		align-items: baseline;
		font-size: 0.9rem;
	}

	.debug-dl dt {
		color: var(--text-muted);
		margin: 0;
	}

	.debug-dl dd {
		margin: 0;
		color: var(--text-color);
	}

	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		word-break: break-all;
	}

	.reset-btn {
		background-color: var(--sidebar-bg);
		color: var(--text-color);
		border: 1px solid var(--border-color);
		padding: 8px 16px;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		width: fit-content;
	}

	.reset-btn:hover {
		border-color: var(--icon-color);
	}

	.reset-btn.danger {
		border-color: #ef4444;
		color: #ef4444;
	}

	.description {
		font-size: 0.85rem;
		color: var(--text-muted, #888);
		margin-top: 8px;
	}

	.settings-dump {
		margin-top: 16px;
		font-size: 0.85rem;
	}

	.settings-dump pre {
		margin-top: 8px;
		padding: 12px;
		background: var(--sidebar-bg);
		border: 1px solid var(--border-color);
		border-radius: 4px;
		overflow-x: auto;
		font-size: 0.75rem;
	}
</style>
