<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { audioPlayer } from '$lib/audio-player.svelte';

	interface Props {
		height?: number;
		color?: string;
		id?: string;
	}

	let { height = 60, color = 'var(--icon-active)', id = '' }: Props = $props();

	let waveformData = $state<number[] | null>(null);
	let isLoading = $state(true);

	async function fetchWaveform() {
		if (!id) {
			waveformData = null;
			isLoading = false;
			return;
		}
		try {
			const result = await invoke<number[] | null>('get_waveform', { id });
			if (result) {
				waveformData = result.map((v) => v / 255);
				isLoading = false;
			} else {
				// Waveform missing, background thread prioritized it
				waveformData = null;
				isLoading = true;
			}
		} catch (e) {
			console.error('Failed to fetch waveform:', e);
			waveformData = null;
			isLoading = false;
		}
	}

	// Refetch when id changes
	$effect(() => {
		isLoading = true;
		fetchWaveform();
	});

	onMount(() => {
		const unlisten = listen<any>('waveform-generated', (event) => {
			// Payload is now { id, gain }
			const payloadId = typeof event.payload === 'string' ? event.payload : event.payload?.id;
			if (payloadId === id) {
				fetchWaveform();
			}
		});
		return () => {
			unlisten.then((f) => f());
		};
	});

	// Use an array of 256 zeros as a fallback to allow smooth transitions from/to "empty"
	const data = $derived(waveformData || Array(256).fill(0));
	const barsCount = $derived(data.length);

	function handleSeek(e: MouseEvent) {
		if (audioPlayer.currentFileId !== id) return;
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const percent = (e.clientX - rect.left) / rect.width;
		audioPlayer.seek(percent);
	}

	// Calculate bar height with a minimum line for silent parts
	function getBarHeight(val: number) {
		const minHeight = 2; // px
		const scaledHeight = val * 100;
		return Math.max(minHeight, scaledHeight);
	}
</script>

<div class="waveform-container" style="height: {height}px">
	<svg
		viewBox="0 0 {barsCount * 4} 100"
		preserveAspectRatio="none"
		class="waveform-svg"
		class:hidden={!waveformData && !isLoading}
		onclick={handleSeek}
		role="presentation"
	>
		<defs>
			<linearGradient id="waveformGradient" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.4" />
				<stop offset="50%" stop-color={color} stop-opacity="0.6" />
				<stop offset="100%" stop-color={color} stop-opacity="0.4" />
			</linearGradient>
			<linearGradient id="waveformPlayedGradient" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.8" />
				<stop offset="50%" stop-color={color} stop-opacity="1" />
				<stop offset="100%" stop-color={color} stop-opacity="0.8" />
			</linearGradient>
            <clipPath id="progressClip-{id}">
                <rect x="0" y="0" width="{audioPlayer.currentFileId === id ? audioPlayer.progress * barsCount * 4 : 0}" height="100" />
            </clipPath>
		</defs>
        
        <g class="waveform-base">
            {#each data as val, i (i)}
                {@const h = getBarHeight(val)}
                <rect
                    class="bar"
                    x={i * 4}
                    y={50 - h / 2}
                    width="2.5"
                    height={h}
                    fill="url(#waveformGradient)"
                    rx="1.25"
                />
            {/each}
        </g>

        <g class="waveform-played" clip-path="url(#progressClip-{id})">
            {#each data as val, i (i)}
                {@const h = getBarHeight(val)}
                <rect
                    class="bar"
                    x={i * 4}
                    y={50 - h / 2}
                    width="2.5"
                    height={h}
                    fill="url(#waveformPlayedGradient)"
                    rx="1.25"
                />
            {/each}
        </g>
	</svg>

	{#if isLoading && !waveformData}
		<div class="loading-overlay" transition:fade={{ duration: 200 }}>
			<div class="loading-placeholder">
				<div class="loading-bar"></div>
			</div>
		</div>
	{/if}
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
		position: relative;
	}

	.waveform-svg {
		width: 100%;
		height: 100%;
		opacity: 0.9;
		transition: opacity 0.3s ease;
		cursor: pointer;
	}

	.waveform-svg.hidden {
		opacity: 0;
	}

	.bar {
		/* Use transition for smooth height and position changes */
		transition:
			height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
			y 0.4s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.loading-overlay {
		position: absolute;
		left: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		pointer-events: none;
	}

	.loading-placeholder {
		width: 100%;
		height: 2px;
		background-color: var(--border-color);
		opacity: 0.3;
		border-radius: 1px;
		overflow: hidden;
		position: relative;
	}

	.loading-bar {
		position: absolute;
		width: 30%;
		height: 100%;
		background-color: var(--icon-active);
		animation: loading 1.5s infinite ease-in-out;
	}

	@keyframes loading {
		0% {
			left: -30%;
		}
		100% {
			left: 100%;
		}
	}
</style>
