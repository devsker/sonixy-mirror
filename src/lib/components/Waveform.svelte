<script lang="ts">
	interface Props {
		height?: number;
		color?: string;
		bars?: number;
		seed?: string;
	}

	let { height = 60, color = 'var(--icon-active)', bars = 100, seed = '' }: Props = $props();

	// Simple deterministic pseudo-random generator based on a string seed
	function mulberry32(a: number) {
		return function () {
			let t = (a += 0x6d2b79f5);
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function hashString(str: string) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash |= 0;
		}
		return hash;
	}

	const data = $derived.by(() => {
		const hash = hashString(seed || 'default');
		const rand = mulberry32(hash);
		return Array.from({ length: bars }, () => rand() * 0.7 + 0.15);
	});
</script>

<div class="waveform-container" style="height: {height}px">
	<svg
		viewBox="0 0 {bars * 4} 100"
		preserveAspectRatio="none"
		class="waveform-svg"
	>
		<defs>
			<linearGradient id="waveformGradient" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.8" />
				<stop offset="50%" stop-color={color} stop-opacity="1" />
				<stop offset="100%" stop-color={color} stop-opacity="0.8" />
			</linearGradient>
		</defs>
		{#each data as barHeight, i}
			<rect
				x={i * 4}
				y={50 - (barHeight * 100) / 2}
				width="2.5"
				height={barHeight * 100}
				fill="url(#waveformGradient)"
				rx="1.25"
			/>
		{/each}
	</svg>
</div>

<style>
	.waveform-container {
		width: 100%;
		height: 100%;
		padding: 12px 16px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		background-color: var(--bg-color);
		flex-shrink: 0;
	}

	.waveform-svg {
		width: 100%;
		height: 100%;
		opacity: 0.9;
	}
</style>
