<script lang="ts">
	import { Bug, Folder, Loader2, Plus, Settings } from 'lucide-svelte';
	import { debugSettingsAccess } from '$lib/debug-settings-access.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { collectionDisplayName, collectionPathsEqual, normalizeCollectionPath } from '$lib/collection-path';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { settingsStore } from '$lib/settings-store.svelte';

	const collections = $derived.by(() => {
		const paths = [...settingsStore.recentCollections];
		const current = collectionStore.collectionPath;
		if (current) {
			const normalized = normalizeCollectionPath(current);
			const exists = paths.some((p) => collectionPathsEqual(p, current));
			if (!exists) {
				paths.push(normalized);
			}
		}
		return paths;
	});

	const isLibraryView = $derived(page.url.pathname === '/');
	const isSettingsView = $derived(page.url.pathname === '/settings');
	const isDebugSettingsView = $derived(page.url.pathname === '/debug-settings');
	const showDebugSettings = $derived(debugSettingsAccess.visible);

	function onSettingsClick() {
		debugSettingsAccess.registerSettingsClick();
	}

	async function switchCollection(path: string) {
		if (collectionStore.switchingCollection) return;
		if (!isLibraryView) {
			await goto('/');
		}
		await collectionStore.openCollectionByPath(path);
	}

	async function addLibrary() {
		if (!isLibraryView) {
			await goto('/');
		}
		await collectionStore.openCollection();
	}
</script>

<aside class="sidebar">
	<header class="sidebar-header">
		<h2 class="sidebar-title">Library</h2>
		<button
			type="button"
			class="add-btn"
			onclick={addLibrary}
			title="Add library"
			aria-label="Add library"
		>
			<Plus size={14} strokeWidth={2.5} />
			<span>Add</span>
		</button>
	</header>

	<nav class="sidebar-nav" aria-label="Collections">
		{#if collections.length === 0}
			<div class="sidebar-empty">
				<p>No libraries yet. Use Add to open a folder.</p>
			</div>
		{:else}
			<ul class="collection-list">
				{#each collections as collectionPath (collectionPath)}
					{@const isActive =
						isLibraryView && collectionPathsEqual(collectionStore.collectionPath, collectionPath)}
					{@const isLoading =
						collectionStore.showSwitchingUi &&
						collectionPathsEqual(collectionStore.switchingToPath, collectionPath)}
					{@const fileCount =
						isActive && !collectionStore.showSwitchingUi
							? collectionStore.files.length
							: null}
					<li>
						<button
							type="button"
							class="collection-item"
							class:active={isActive}
							class:loading={isLoading}
							title={collectionPath}
							disabled={collectionStore.switchingCollection}
							onclick={() => switchCollection(collectionPath)}
						>
							<span class="collection-icon" aria-hidden="true">
								{#if isLoading}
									<Loader2 size={16} class="animate-spin" />
								{:else}
									<Folder size={16} />
								{/if}
							</span>
							<span class="collection-label">{collectionDisplayName(collectionPath)}</span>
							{#if fileCount !== null}
								<span class="collection-count">{fileCount}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</nav>

	<footer class="sidebar-footer">
		{#if showDebugSettings}
			<a
				href="/debug-settings"
				class="footer-link"
				class:active={isDebugSettingsView}
				title="Debug"
				draggable="false"
			>
				<Bug size={18} strokeWidth={2} />
				<span>Debug</span>
			</a>
		{/if}
		<a
			href="/settings"
			class="footer-link"
			class:active={isSettingsView}
			title="Settings"
			draggable="false"
			onclick={onSettingsClick}
		>
			<Settings size={18} strokeWidth={2} />
			<span>Settings</span>
		</a>
	</footer>
</aside>

<style>
	.sidebar {
		position: relative;
		z-index: 10;
		width: 200px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background-color: var(--sidebar-bg);
		border-right: 1px solid var(--border-color);
		min-height: 0;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 14px 12px 10px;
		flex-shrink: 0;
	}

	.sidebar-title {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.add-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-color);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		cursor: pointer;
		flex-shrink: 0;
	}

	.add-btn:hover:not(:disabled) {
		background: rgba(128, 128, 128, 0.15);
	}

	.sidebar-nav {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 8px;
	}

	.sidebar-empty {
		padding: 12px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sidebar-empty p {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.collection-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.collection-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}

	.collection-item:hover:not(:disabled) {
		background: rgba(128, 128, 128, 0.1);
		color: var(--text-color);
	}

	.collection-item.active {
		background: rgba(0, 122, 204, 0.1);
		color: var(--text-color);
	}

	:global(html.dark) .collection-item.active {
		background: rgba(0, 122, 204, 0.2);
	}

	.collection-item:disabled {
		cursor: wait;
		opacity: 0.75;
	}

	.collection-item.loading {
		color: var(--icon-active);
	}

	.collection-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--icon-color);
	}

	.collection-item.active .collection-icon,
	.collection-item.loading .collection-icon {
		color: var(--icon-active);
	}

	.collection-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.collection-count {
		flex-shrink: 0;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		padding: 2px 6px;
		border-radius: 10px;
		background: rgba(128, 128, 128, 0.15);
	}

	.collection-item.active .collection-count {
		color: var(--icon-active);
		background: rgba(0, 122, 204, 0.15);
	}

	.sidebar-footer {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		padding: 8px;
		border-top: 1px solid var(--border-color);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.footer-link {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 6px;
		color: var(--text-color);
		text-decoration: none;
		font-size: 13px;
	}

	.footer-link:hover {
		background: rgba(128, 128, 128, 0.1);
	}

	.footer-link.active {
		background: rgba(0, 122, 204, 0.1);
		color: var(--icon-active);
	}

	:global(html.dark) .footer-link.active {
		background: rgba(0, 122, 204, 0.2);
	}
</style>
