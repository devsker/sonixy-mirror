<script lang="ts">
	import Titlebar from '$lib/components/Titlebar.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { onMount, setContext } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import DropPrompt from '$lib/components/DropPrompt.svelte';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { audioPlayer } from '$lib/audio-player.svelte';
	import { preloadDragIcon } from '$lib/file-drag';
	
	import { settingsStore } from '$lib/settings-store.svelte';
	
	let { children } = $props();

	function isTypingTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;

		switch (e.code) {
			case 'Space':
				e.preventDefault();
				audioPlayer.toggle();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				audioPlayer.previous();
				break;
			case 'ArrowRight':
				e.preventDefault();
				audioPlayer.next();
				break;
			case 'KeyM':
				e.preventDefault();
				audioPlayer.toggleMute();
				break;
			case 'Escape':
				if (showDropPrompt || collectionStore.pendingRelocate) return;
				audioPlayer.stop();
				break;
		}
	}

	let dropPaths = $state<string[]>([]);
	let showDropPrompt = $state(false);
	let ffmpegDownloadMessage = $state<string | null>(null);
	let ffmpegDownloadProgress = $state(0);

	const appWindow = getCurrentWindow();
	
	onMount(() => {
		preloadDragIcon();

		const unlistenFfmpeg = listen<{ progress: number; message: string }>(
			'ffmpeg-download-progress',
			(event) => {
				ffmpegDownloadProgress = event.payload.progress;
				ffmpegDownloadMessage = event.payload.message;
				if (event.payload.progress >= 1) {
					setTimeout(() => {
						ffmpegDownloadMessage = null;
						ffmpegDownloadProgress = 0;
					}, 1500);
				}
			}
		);

		const unlistenPromise = appWindow.onDragDropEvent((event) => {
			if (collectionStore.isDraggingFromApp) return;

			if (event.payload.type === 'drop' && collectionStore.collectionPath) {
				const collectionPath = collectionStore.collectionPath.replace(/[\\\/]+/g, '/');
				const filteredPaths = event.payload.paths.filter(path => {
					const normalizedPath = path.replace(/[\\\/]+/g, '/');
					// If it's the exact collection folder or inside it, ignore
					if (normalizedPath === collectionPath) return false;
					if (normalizedPath.startsWith(collectionPath.endsWith('/') ? collectionPath : collectionPath + '/')) return false;
					return true;
				});

				if (filteredPaths.length > 0) {
					dropPaths = filteredPaths;
					showDropPrompt = true;
				}
			}
		});

		return () => {
			unlistenFfmpeg.then((f) => f());
			unlistenPromise.then((f) => f());
		};
	});

	async function handleDropSelect(action: 'copy' | 'move') {
		if (collectionStore.pendingRelocate) {
			await collectionStore.confirmRelocate(action);
		} else if (dropPaths.length > 0) {
			showDropPrompt = false;
			await collectionStore.addFiles(dropPaths, action, settingsStore.normalizeOnImport);
			dropPaths = [];
		}
	}

	function handleDropCancel() {
		showDropPrompt = false;
		collectionStore.pendingRelocate = null;
		dropPaths = [];
	}

	function closeDropPrompt() {
		if (showDropPrompt) handleDropCancel();
	}

	function applyTheme(value: string) {
		const root = document.documentElement;
		root.classList.remove('light', 'dark');

		if (value === 'system') {
			const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			root.classList.add(systemDark ? 'dark' : 'light');
		} else {
			root.classList.add(value);
		}
	}

	onMount(() => {
		applyTheme(settingsStore.theme);
		
		// Remove no-transitions class after initial theme application
		setTimeout(() => {
			document.documentElement.classList.remove('no-transitions');
		}, 0);

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (settingsStore.theme === 'system') applyTheme('system');
		};
		mediaQuery.addEventListener('change', handler);
		return () => mediaQuery.removeEventListener('change', handler);
	});

	$effect(() => {
		applyTheme(settingsStore.theme);
	});

	// Provide the reactive state object directly
	setContext('settings-context', settingsStore);
</script>

<svelte:window 
	onkeydown={handleKeydown} 
	onclick={closeDropPrompt} 
	oncontextmenu={(e) => e.preventDefault()}
/>

<div class="app-container">
	<Titlebar />
	<div class="app-layout">
		<Sidebar />

		<main class="content">
			{@render children()}
		</main>
	</div>

	{#if showDropPrompt || collectionStore.pendingRelocate}
		<DropPrompt 
			onSelect={handleDropSelect} 
			onCancel={handleDropCancel} 
		/>
	{/if}

	<ContextMenu />

	{#if ffmpegDownloadMessage}
		<div class="ffmpeg-download-banner" role="status">
			<p>{ffmpegDownloadMessage}</p>
			<progress max="1" value={ffmpegDownloadProgress}></progress>
		</div>
	{/if}
</div>

<style>
	:root {
		--bg-color: #ffffff;
		--sidebar-bg: #f3f3f3;
		--border-color: #e5e5e5;
		--text-color: #333333;
		--text-main: #333333;
		--text-muted: #666666;
		--icon-color: #616161;
		--icon-active: #007acc;
		--icon-hover: #333333;
		--scrollbar-track: transparent;
		--scrollbar-thumb: #cccccc;
		--scrollbar-thumb-hover: #b0b0b0;
		--selection-color: #000000;
	}

	:global(html.dark) {
		--bg-color: #1e1e1e;
		--sidebar-bg: #333333;
		--border-color: #252525;
		--text-color: #ffffff;
		--text-main: #ffffff;
		--text-muted: #cccccc;
		--icon-color: #858585;
		--icon-active: #ffffff;
		--icon-hover: #ffffff;
		--scrollbar-thumb: #444444;
		--scrollbar-thumb-hover: #555555;
		--selection-color: #007acc;
	}

	.ffmpeg-download-banner {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 10000;
		min-width: 280px;
		max-width: 90vw;
		padding: 12px 16px;
		border-radius: 8px;
		background: var(--sidebar-bg);
		border: 1px solid var(--border-color);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.ffmpeg-download-banner p {
		margin: 0 0 8px;
		font-size: 13px;
		color: var(--text-main);
	}

	.ffmpeg-download-banner progress {
		width: 100%;
		height: 6px;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			Oxygen,
			Ubuntu,
			Cantarell,
			'Open Sans',
			'Helvetica Neue',
			sans-serif;
		background-color: var(--bg-color);
		color: var(--text-color);
		overflow: hidden;
	}

	/* Custom Scrollbar Styles */
	:global(::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(::-webkit-scrollbar-track) {
		background: var(--scrollbar-track);
	}

	:global(::-webkit-scrollbar-thumb) {
		background: var(--scrollbar-thumb);
		border-radius: 10px;
		border: 2px solid var(--bg-color);
		background-clip: padding-box;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background-color: var(--scrollbar-thumb-hover);
	}

	:global(a), :global(img) {
		-webkit-user-drag: none;
	}

	:global(input), :global(textarea), :global(select) {
		user-select: text;
		-webkit-user-select: text;
	}

	/* Transition management */
	:global(html:not(.no-transitions) body),
	:global(html:not(.no-transitions) .sidebar),
	:global(html:not(.no-transitions) .content),
	:global(html:not(.no-transitions) .titlebar) {
		transition: background-color 0.2s, color 0.2s, border-color 0.2s;
	}

	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		user-select: none;
		-webkit-user-select: none;
	}

	.app-layout {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.content {
		flex: 1;
		background-color: var(--bg-color);
		overflow: hidden;
		padding: 0;
	}
</style>


