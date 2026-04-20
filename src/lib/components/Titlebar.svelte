<script>
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { Minus, Square, X, RefreshCw } from 'lucide-svelte';
	import { collectionStore } from '$lib/collection-store.svelte';

	const appWindow = getCurrentWindow();
    let loading = $derived(collectionStore.loading);
    let collectionPath = $derived(collectionStore.collectionPath);

	async function minimize() {
		await appWindow.minimize();
	}

	async function toggleMaximize() {
		if (await appWindow.isMaximized()) {
			await appWindow.unmaximize();
		} else {
			await appWindow.maximize();
		}
	}

	async function close() {
		await appWindow.close();
	}
</script>

<div data-tauri-drag-region class="titlebar">
	<div data-tauri-drag-region class="title-section">
		<span class="title">Sonixy</span>
	</div>
	<div class="controls">
        {#if collectionPath}
            <button class="control-btn" onclick={() => collectionStore.refresh()} aria-label="Refresh" disabled={loading}>
                <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
            </button>
        {/if}
		<button class="control-btn" onclick={minimize} aria-label="Minimize">
			<Minus size={14} />
		</button>
		<button class="control-btn" onclick={toggleMaximize} aria-label="Maximize">
			<Square size={12} />
		</button>
		<button class="control-btn close-btn" onclick={close} aria-label="Close">
			<X size={14} />
		</button>
	</div>
</div>

<style>
	.titlebar {
		height: 30px;
		width: 100%;
		flex-shrink: 0;
		background: var(--sidebar-bg);
		user-select: none;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		justify-content: flex-start;
		align-items: center;
		border-bottom: 1px solid var(--border-color);
		z-index: 1000;
		overflow: hidden;
		box-sizing: border-box;
	}

	.title-section {
		flex: 1;
		display: flex;
		align-items: center;
		height: 100%;
		min-width: 0;
		padding-left: 12px;
	}

	.title {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.controls {
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		height: 100%;
		flex-shrink: 0;
	}

	.control-btn {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 45px;
		height: 100%;
		border: none;
		background: transparent;
		color: var(--icon-color);
		cursor: default;
		transition: background-color 0.1s, color 0.1s;
		box-sizing: border-box;
	}

	.control-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--icon-hover);
	}

    .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

	:global(html.dark) .control-btn:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.close-btn:hover {
		background-color: #e81123 !important;
		color: white !important;
	}

    :global(.animate-spin) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
