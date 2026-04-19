<script>
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { Minus, Square, X } from 'lucide-svelte';

	const appWindow = getCurrentWindow();

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
	<div data-tauri-drag-region class="title">Sonixy</div>
	<div class="controls">
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
		background: var(--sidebar-bg);
		user-select: none;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--border-color);
		z-index: 1000;
		transition: background-color 0.2s, border-color 0.2s;
	}

	.title {
		padding-left: 12px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: default;
	}

	.controls {
		display: flex;
		height: 100%;
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
	}

	.control-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--icon-hover);
	}

	:global(html.dark) .control-btn:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.close-btn:hover {
		background-color: #e81123 !important;
		color: white !important;
	}
</style>
