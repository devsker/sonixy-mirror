<script lang="ts">
	import { contextMenuState, hideContextMenu } from '$lib/context-menu.svelte';
	import { onMount, tick } from 'svelte';
	import { scale } from 'svelte/transition';

	let menuElement = $state<HTMLElement | undefined>();

	onMount(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuState.visible && menuElement && !menuElement.contains(event.target as Node)) {
				hideContextMenu();
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				hideContextMenu();
			}
		};

		window.addEventListener('mousedown', handleClickOutside, true);
		window.addEventListener('keydown', handleKeyDown, true);

		return () => {
			window.removeEventListener('mousedown', handleClickOutside, true);
			window.removeEventListener('keydown', handleKeyDown, true);
		};
	});

	let x = $derived.by(() => {
		if (!menuElement) return contextMenuState.x;
		const { innerWidth } = window;
		const { offsetWidth } = menuElement;
		return contextMenuState.x + offsetWidth > innerWidth 
			? innerWidth - offsetWidth - 10 
			: contextMenuState.x;
	});

	let y = $derived.by(() => {
		if (!menuElement) return contextMenuState.y;
		const { innerHeight } = window;
		const { offsetHeight } = menuElement;
		return contextMenuState.y + offsetHeight > innerHeight 
			? innerHeight - offsetHeight - 10 
			: contextMenuState.y;
	});

	async function handleAction(action?: () => void) {
		if (action) {
			action();
		}
		hideContextMenu();
	}
</script>

{#if contextMenuState.visible}
	<div
		bind:this={menuElement}
		class="context-menu"
		style:left="{x}px"
		style:top="{y}px"
		transition:scale={{ duration: 100, start: 0.95, opacity: 0 }}
	>
		{#each contextMenuState.items as item}
			{#if item.separator}
				<div class="separator"></div>
			{:else}
				<button
					class="menu-item"
					disabled={item.disabled}
					onclick={() => handleAction(item.action)}
				>
					{item.label}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.context-menu {
		position: fixed;
		z-index: 10000;
		background-color: var(--bg-color);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
		padding: 4px;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		user-select: none;
		backdrop-filter: blur(8px);
	}

	:global(html.dark) .context-menu {
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
		background-color: rgba(30, 30, 30, 0.95);
	}

	.menu-item {
		background: none;
		border: none;
		padding: 8px 12px;
		text-align: left;
		font-size: 13px;
		color: var(--text-color);
		border-radius: 5px;
		cursor: default;
		display: flex;
		align-items: center;
		width: 100%;
		transition: background-color 0.1s;
	}

	.menu-item:hover:not(:disabled) {
		background-color: rgba(0, 0, 0, 0.05);
	}

	:global(html.dark) .menu-item:hover:not(:disabled) {
		background-color: rgba(255, 255, 255, 0.1);
	}

	.menu-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.separator {
		height: 1px;
		background-color: var(--border-color);
		margin: 4px 6px;
	}
</style>
