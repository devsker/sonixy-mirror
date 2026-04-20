<script>
	import FileList from '$lib/components/FileList.svelte';
	import Waveform from '$lib/components/Waveform.svelte';

	let selectedIds = $state([]);

	function handleSelectionChange(ids) {
		selectedIds = ids;
	}
</script>

<div class="page-container">
	<div class="waveform-section">
		{#if selectedIds.length === 0}
			<div class="selection-message">No file selected</div>
		{:else if selectedIds.length === 1}
			<Waveform seed={selectedIds[0]} />
		{:else}
			<div class="selection-message">More than one file selected</div>
		{/if}
	</div>
	<FileList onSelectionChange={handleSelectionChange} />
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
</style>
