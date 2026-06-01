<script lang="ts">
	interface Props {
		/** When true, buttons are non-interactive (settings preview). */
		preview?: boolean;
		onClose?: () => void;
		onMinimize?: () => void;
		onZoom?: () => void;
	}

	let { preview = false, onClose, onMinimize, onZoom }: Props = $props();
</script>

<div class="linux-window-controls" class:preview>
	<button type="button" class="linux-control minimize" onclick={onMinimize} aria-label="Minimize">
		<svg class="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path class="stroke" d="M4 8.25h8" />
		</svg>
	</button>
	<button type="button" class="linux-control maximize" onclick={onZoom} aria-label="Maximize">
		<svg class="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
			<!-- GNOME window-maximize: single centered square -->
			<path class="stroke" d="M4.75 4.75h6.5v6.5H4.75z" />
		</svg>
	</button>
	<button type="button" class="linux-control close" onclick={onClose} aria-label="Close">
		<svg class="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path class="stroke" d="M5.25 5.25l5.5 5.5M10.75 5.25l-5.5 5.5" />
		</svg>
	</button>
</div>

<style>
	.linux-window-controls {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 100%;
		flex-shrink: 0;
		padding: 0 6px 0 2px;
	}

	.linux-control {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		padding: 0;
		margin: 0;
		border: none;
		border-radius: 50%;
		background: rgba(128, 128, 128, 0.22);
		color: var(--text-color);
		cursor: default;
		box-sizing: border-box;
		outline: none;
		-webkit-appearance: none;
		appearance: none;
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}

	:global(html.dark) .linux-control {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.92);
	}

	.linux-control:hover {
		background: rgba(128, 128, 128, 0.32);
	}

	:global(html.dark) .linux-control:hover {
		background: rgba(255, 255, 255, 0.16);
	}

	.linux-control:active {
		background: rgba(128, 128, 128, 0.4);
	}

	:global(html.dark) .linux-control:active {
		background: rgba(255, 255, 255, 0.22);
	}

	.linux-icon {
		width: 10px;
		height: 10px;
		display: block;
		pointer-events: none;
	}

	.linux-icon .stroke {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.2;
		stroke-linecap: round;
	}

	.preview .linux-control {
		pointer-events: none;
	}
</style>
