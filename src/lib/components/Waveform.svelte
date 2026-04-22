<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { audioPlayer } from '$lib/audio-player.svelte';
	import { startDrag } from '@crabnebula/tauri-plugin-drag';

	interface Props {
		height?: number;
		color?: string;
		id?: string;
	}

	let { height = 60, color = 'var(--icon-active)', id = '' }: Props = $props();

	let waveformData = $state<number[] | null>(null);
	let isLoading = $state(true);
	let svgElement = $state<SVGSVGElement | null>(null);

	// Selection state
	let selectionStart = $state<number | null>(null);
	let selectionEnd = $state<number | null>(null);
	let dragStartPos = $state<number | null>(null);
	let currentPos = $state<number | null>(null);
	let isDragging = $state(false);
	let dragClipPath = $state<string | null>(null);
	let isPreparingClip = $state(false);

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
				waveformData = null;
				isLoading = true;
			}
		} catch (e) {
			console.error('Failed to fetch waveform:', e);
			waveformData = null;
			isLoading = false;
		}
	}

	$effect(() => {
		isLoading = true;
		// Reset selection when ID changes
		selectionStart = null;
		selectionEnd = null;
		dragClipPath = null;
		fetchWaveform();
	});

	onMount(() => {
		const unlisten = listen<any>('waveform-generated', (event) => {
			const payloadId = typeof event.payload === 'string' ? event.payload : event.payload?.id;
			if (payloadId === id) {
				fetchWaveform();
			}
		});
		return () => {
			unlisten.then((f) => f());
		};
	});

	const data = $derived(waveformData || Array(256).fill(0));
	const barsCount = $derived(data.length);

	const currentSelection = $derived.by(() => {
		if (isDragging && dragStartPos !== null && currentPos !== null && svgElement) {
			const rect = svgElement.getBoundingClientRect();
			const getPct = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
			const p1 = getPct(dragStartPos);
			const p2 = getPct(currentPos);
			return { start: Math.min(p1, p2), end: Math.max(p1, p2) };
		}
		if (selectionStart !== null && selectionEnd !== null) {
			return { start: selectionStart, end: selectionEnd };
		}
		return null;
	});

	function onMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		// Don't start a new selection if clicking on the existing one to drag it
		if ((e.target as Element).closest('.selection-rect')) return;

		dragStartPos = e.clientX;
		currentPos = e.clientX;
		isDragging = true;
		selectionStart = null;
		selectionEnd = null;
		dragClipPath = null;
	}

	function onMouseMove(e: MouseEvent) {
		if (isDragging) {
			currentPos = e.clientX;
		}
	}

	async function onMouseUp(e: MouseEvent) {
		if (!isDragging) return;
		isDragging = false;

		const diff = Math.abs(e.clientX - (dragStartPos || 0));
		const rect = svgElement?.getBoundingClientRect();
		if (!rect) return;

		const getPct = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));

		if (diff < 5) {
			// Small movement is a seek
			if (audioPlayer.currentFileId === id) {
				audioPlayer.seek(getPct(e.clientX));
			}
		} else {
			// Selection finalized
			const p1 = getPct(dragStartPos!);
			const p2 = getPct(e.clientX);
			selectionStart = Math.min(p1, p2);
			selectionEnd = Math.max(p1, p2);

			if (selectionEnd - selectionStart > 0.001) {
				isPreparingClip = true;
				try {
					dragClipPath = await invoke<string>('prepare_drag_clip', {
						id,
						startPct: selectionStart,
						endPct: selectionEnd
					});
				} catch (err) {
					console.error('Failed to prepare drag clip:', err);
				} finally {
					isPreparingClip = false;
				}
			}
		}
		dragStartPos = null;
		currentPos = null;
	}

	function handleDragStart(e: DragEvent) {
		if (!dragClipPath) {
			e.preventDefault();
			return;
		}
		startDrag({
			item: [dragClipPath],
			icon: 'tauri.svg'
		});
	}

	function getBarHeight(val: number) {
		const minHeight = 2;
		const scaledHeight = val * 100;
		return Math.max(minHeight, scaledHeight);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="waveform-container"
	style="height: {height}px"
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	onmouseleave={onMouseUp}
>
	<svg
		bind:this={svgElement}
		viewBox="0 0 {barsCount * 4} 100"
		preserveAspectRatio="none"
		class="waveform-svg"
		class:hidden={!waveformData && !isLoading}
		onmousedown={onMouseDown}
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
				<rect
					x="0"
					y="0"
					width={audioPlayer.currentFileId === id ? audioPlayer.progress * barsCount * 4 : 0}
					height="100"
				/>
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

		{#if currentSelection}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<rect
				x={currentSelection.start * barsCount * 4}
				y="0"
				width={(currentSelection.end - currentSelection.start) * barsCount * 4}
				height="100"
				fill={color}
				fill-opacity="0.2"
				stroke={color}
				stroke-width="1"
				onmousedown={(e) => {
					e.stopPropagation();
					e.preventDefault();
					if (dragClipPath) {
						startDrag({
							item: [dragClipPath],
							icon: 'tauri.svg'
						});
					}
				}}
				class="selection-rect"
				class:ready={!!dragClipPath}
				class:preparing={isPreparingClip}
			/>
		{/if}
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
		cursor: crosshair;
	}

	.waveform-svg.hidden {
		opacity: 0;
	}

	.bar {
		transition:
			height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
			y 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
	}

	.selection-rect {
		cursor: grab;
	}

	.selection-rect.preparing {
		cursor: wait;
		stroke-dasharray: 4;
		animation: dash 1s linear infinite;
	}

	.selection-rect.ready {
		cursor: grab;
	}

	@keyframes dash {
		to {
			stroke-dashoffset: -8;
		}
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
