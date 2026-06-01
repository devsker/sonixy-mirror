<script lang="ts">
	import FileList from '$lib/components/FileList.svelte';
	import Waveform from '$lib/components/Waveform.svelte';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { audioPlayer } from '$lib/audio-player.svelte';
	import { collectionDisplayName } from '$lib/collection-path';

	let selectedIds = $state<string[]>([]);

	function handleSelectionChange(ids: string[]) {
		selectedIds = ids;
	}

    let displayId = $derived(
        audioPlayer.currentFileId || (selectedIds.length === 1 ? selectedIds[0] : null)
    );
</script>

<div class="page-container">
	{#key collectionStore.collectionPath}
		{#if collectionStore.collectionPath}
			<div class="waveform-section">
				{#if collectionStore.showSwitchingUi}
					<div class="selection-message switching">
						Opening {collectionDisplayName(collectionStore.switchingToPath ?? collectionStore.collectionPath)}…
					</div>
				{:else if displayId}
					<Waveform id={displayId} />
				{:else if selectedIds.length > 1}
					<div class="selection-message">More than one file selected</div>
				{:else}
					<div class="selection-message">No file selected</div>
				{/if}
			</div>
		{/if}
		<FileList onSelectionChange={handleSelectionChange} />
	{/key}
</div>

<style>
	.page-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
	}

	.waveform-section {
		height: 85px; /* 60px height + 12px*2 padding + 1px border */
		flex-shrink: 0;
		background-color: var(--bg-color);
		border-bottom: 1px solid var(--border-color);
	}

	.selection-message {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: 13px;
		font-style: italic;
	}

	.selection-message.switching {
		font-style: normal;
		color: var(--icon-active);
	}
</style>
