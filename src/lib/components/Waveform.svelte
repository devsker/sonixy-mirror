<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { audioPlayer } from '$lib/audio-player.svelte';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { startDrag } from '@crabnebula/tauri-plugin-drag';

	interface Props {
		height?: number | string;
		color?: string;
		id?: string;
	}

	let { height = '100%', color = 'var(--icon-active)', id = '' }: Props = $props();

	let waveformData = $state<number[] | null>(null);
	let isLoading = $state(true);
	let svgElement = $state<SVGSVGElement | null>(null);
	let progress = $derived(collectionStore.waveformProgress[id] || 0);
	let partialData = $derived(collectionStore.partialWaveforms[id] || null);

	// Selection state
	let selectionStart = $state<number | null>(null);
	let selectionEnd = $state<number | null>(null);
	let dragStartPos = $state<number | null>(null);
	let currentPos = $state<number | null>(null);
	let isDragging = $state(false);
	let dragClipPath = $state<string | null>(null);
	let isPreparingClip = $state(false);
	let isLocked = $derived(collectionStore.isLocked(id));

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
		const unlistenStarted = listen<string>('waveform-started', (event) => {
			if (event.payload === id) {
				waveformData = null;
				isLoading = true;
			}
		});

		const unlistenGenerated = listen<any>('waveform-generated', (event) => {
			const payloadId = typeof event.payload === 'string' ? event.payload : event.payload?.id;
			if (payloadId === id) {
				fetchWaveform();
			}
		});

		return () => {
			unlistenStarted.then((f) => f());
			unlistenGenerated.then((f) => f());
		};
	});

	const data = $derived(waveformData || (partialData ? partialData.map(v => v / 255) : Array(512).fill(0)));
	const barsCount = $derived(data.length);

	const waveformPath = $derived.by(() => {
		if (data.length === 0) return '';
		const spacing = 3;

		// During calculation, only show bars up to the current progress
		let lastIdx = data.length - 1;
		if (!waveformData && isLoading) {
			lastIdx = Math.min(data.length - 1, Math.floor(progress * data.length));
		}

		if (lastIdx < 0) return '';

		const topParts: string[] = [];
		const bottomParts: string[] = [];

		for (let i = 0; i <= lastIdx; i++) {
			const x = i * spacing;
			const h = getBarHeight(data[i]);
			topParts.push(`${i === 0 ? 'M' : 'L'} ${x},${50 - h / 2} `);
			bottomParts.push(`L ${x},${50 + h / 2} `);
		}

		return topParts.join('') + bottomParts.reverse().join('') + 'Z';
	});

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
		if (e.button !== 0 || isLocked) return;
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

	async function handleDragStart(e: DragEvent) {
		if (!dragClipPath) {
			e.preventDefault();
			return;
		}
		collectionStore.isDraggingFromApp = true;
		try {
			await startDrag({
				item: [dragClipPath],
				icon: 'tauri.svg'
			});
		} finally {
			collectionStore.isDraggingFromApp = false;
		}
	}

	function getBarHeight(val: number) {
		const minHeight = 2;
		if (!val || isNaN(val) || val <= 0) return minHeight;
		// Use a slight non-linear scaling to make low volumes more visible
		const boosted = Math.pow(val, 0.8);
		const scaledHeight = boosted * 92;
		return Math.max(minHeight, scaledHeight);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="waveform-container"
	style="height: {typeof height === 'number' ? height + 'px' : height}"
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	onmouseleave={onMouseUp}
>
	<svg
		bind:this={svgElement}
		viewBox="0 0 {barsCount * 3} 100"
		preserveAspectRatio="none"
		class="waveform-svg"
		class:hidden={!waveformData && !isLoading}
		class:locked={isLocked}
		onmousedown={onMouseDown}
		role="presentation"
	>
		<defs>
			<linearGradient id="waveformGradient-{id}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.15" />
				<stop offset="50%" stop-color={color} stop-opacity="0.3" />
				<stop offset="100%" stop-color={color} stop-opacity="0.15" />
			</linearGradient>
			<linearGradient id="waveformPlayedGradient-{id}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.7" />
				<stop offset="50%" stop-color={color} stop-opacity="1" />
				<stop offset="100%" stop-color={color} stop-opacity="0.7" />
			</linearGradient>
			<clipPath id="progressClip-{id}">
				<rect
					x="0"
					y="0"
					width={audioPlayer.currentFileId === id ? audioPlayer.progress * barsCount * 3 : 0}
					height="100"
				/>
			</clipPath>
		</defs>

		{#if currentSelection}
			<rect
				x={currentSelection.start * barsCount * 3}
				y="0"
				width={(currentSelection.end - currentSelection.start) * barsCount * 3}
				height="100"
				fill="var(--selection-color)"
				fill-opacity="0.1"
				pointer-events="none"
			/>
		{/if}

		<g class="waveform-base">
			<path
				d={waveformPath}
				fill="url(#waveformGradient-{id})"
				class="waveform-path"
				class:no-transition={!waveformData && isLoading}
			/>
		</g>

		<g class="waveform-played" clip-path="url(#progressClip-{id})">
			<path
				d={waveformPath}
				fill="url(#waveformPlayedGradient-{id})"
				class="waveform-path played"
				class:no-transition={!waveformData && isLoading}
			/>
		</g>

		{#if currentSelection}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<rect
				x={currentSelection.start * barsCount * 3}
				y="0"
				width={(currentSelection.end - currentSelection.start) * barsCount * 3}
				height="100"
				fill="transparent"
				stroke="var(--selection-color)"
				stroke-opacity="0.8"
				stroke-width="1"
				onmousedown={async (e) => {
					e.stopPropagation();
					e.preventDefault();
					if (dragClipPath) {
						collectionStore.isDraggingFromApp = true;
						try {
							await startDrag({
								item: [dragClipPath],
								icon: 'tauri.svg'
							});
						} finally {
							collectionStore.isDraggingFromApp = false;
						}
					}
				}}
				class="selection-rect"
				class:ready={!!dragClipPath}
				class:preparing={isPreparingClip}
			/>
		{/if}
	</svg>
</div>

<style>
	.waveform-container {
		width: 100%;
		height: 100%;
		padding: 4px 16px;
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
		overflow: visible;
	}

	.waveform-svg.hidden {
		opacity: 0;
	}

	.waveform-svg.locked {
		opacity: 0.5;
		filter: grayscale(0.5);
		cursor: wait;
	}

	.waveform-path {
		transition: d 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.waveform-path.no-transition {
		transition: none;
	}

	.waveform-path.played {
		filter: drop-shadow(0 0 4px rgba(0, 122, 204, 0.2));
	}

	:global(html.dark) .waveform-path.played {
		filter: drop-shadow(0 0 6px rgba(0, 122, 204, 0.4));
	}

	.selection-rect {
		cursor: grab;
	}

	.selection-rect.preparing {
		cursor: wait;
		stroke-width: 3;
		stroke-dasharray: 8 8;
		animation: dash 0.5s linear infinite;
	}

	.selection-rect.ready {
		cursor: grab;
		stroke-dasharray: none;
		stroke-width: 1;
	}

	@keyframes dash {
		to {
			stroke-dashoffset: -16;
		}
	}
</style>
