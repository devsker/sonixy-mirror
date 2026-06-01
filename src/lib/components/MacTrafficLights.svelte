<script lang="ts">
	interface Props {
		/** When true, symbols stay visible (settings preview). */
		preview?: boolean;
		onClose?: () => void;
		onMinimize?: () => void;
		onZoom?: () => void;
	}

	let { preview = false, onClose, onMinimize, onZoom }: Props = $props();
</script>

<div class="mac-traffic-lights" class:preview>
	<button type="button" class="traffic-light close" onclick={onClose} aria-label="Close">
		<svg class="traffic-icon" viewBox="0 0 8 8" aria-hidden="true">
			<path class="stroke" d="M2.35 2.35 5.65 5.65M5.65 2.35 2.35 5.65" />
		</svg>
	</button>
	<button type="button" class="traffic-light minimize" onclick={onMinimize} aria-label="Minimize">
		<svg class="traffic-icon" viewBox="0 0 8 8" aria-hidden="true">
			<path class="stroke" d="M2.15 4h3.7" />
		</svg>
	</button>
	<button type="button" class="traffic-light maximize" onclick={onZoom} aria-label="Zoom">
		<svg class="traffic-icon zoom" viewBox="0 0 8 8" aria-hidden="true">
			<!-- bottom-left corner -->
			<path class="stroke" d="M2.35 5.65V3.6" />
			<path class="stroke" d="M2.35 5.65H4.4" />
			<!-- top-right corner -->
			<path class="stroke" d="M5.65 2.35H3.6" />
			<path class="stroke" d="M5.65 2.35V4.4" />
		</svg>
	</button>
</div>

<style>
	.mac-traffic-lights {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		flex-shrink: 0;
		height: 100%;
	}

	.traffic-light {
		--traffic-stroke: rgba(0, 0, 0, 0.45);
		width: 12px;
		height: 12px;
		min-width: 12px;
		min-height: 12px;
		border: none;
		border-radius: 50%;
		padding: 0;
		margin: 0;
		display: grid;
		place-items: center;
		cursor: default;
		flex-shrink: 0;
		box-sizing: border-box;
		outline: none;
		-webkit-appearance: none;
		appearance: none;
		-webkit-tap-highlight-color: transparent;
		transform: none;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.22),
			inset 0 -1px 0 rgba(0, 0, 0, 0.12),
			0 0 0 0.5px rgba(0, 0, 0, 0.14);
		transition: background-color 0.08s ease, box-shadow 0.08s ease;
	}

	.traffic-light.close {
		background-color: #ff5f57;
		--traffic-stroke: rgba(77, 0, 0, 0.72);
	}

	.traffic-light.minimize {
		background-color: #febc2e;
		--traffic-stroke: rgba(154, 95, 0, 0.78);
	}

	.traffic-light.maximize {
		background-color: #28c840;
		--traffic-stroke: rgba(0, 101, 0, 0.72);
	}

	.traffic-light.close:active {
		background-color: #d84a44;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.28),
			0 0 0 0.5px rgba(0, 0, 0, 0.2);
	}

	.traffic-light.minimize:active {
		background-color: #d9a326;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.22),
			0 0 0 0.5px rgba(0, 0, 0, 0.2);
	}

	.traffic-light.maximize:active {
		background-color: #22a83a;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.22),
			0 0 0 0.5px rgba(0, 0, 0, 0.2);
	}

	.traffic-icon {
		width: 8px;
		height: 8px;
		display: block;
		opacity: 0;
		pointer-events: none;
		flex-shrink: 0;
		transition: opacity 0.1s ease;
	}

	.traffic-icon .stroke {
		fill: none;
		stroke: var(--traffic-stroke);
		stroke-width: 1.3;
		stroke-linecap: round;
	}

	.traffic-icon.zoom .stroke {
		stroke-width: 1.2;
	}

	.mac-traffic-lights:hover .traffic-icon,
	.traffic-light:active .traffic-icon,
	.mac-traffic-lights.preview .traffic-icon {
		opacity: 1;
	}

	.preview .traffic-light {
		pointer-events: none;
	}
</style>
