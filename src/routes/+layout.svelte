<script>
	import { Library, Settings } from 'lucide-svelte';
	import { page } from '$app/state';
	import Titlebar from '$lib/components/Titlebar.svelte';
	let { children } = $props();
</script>

<div class="app-container">
	<Titlebar />
	<div class="app-layout">
		<aside class="sidebar">
			<div class="top-icons">
				<a 
					href="/"
					class="icon-btn" 
					class:active={page.url.pathname === '/'} 
					title="Collections"
				>
					<Library size={24} strokeWidth={2} />
				</a>
			</div>

			<div class="bottom-icons">
				<a 
					href="/settings"
					class="icon-btn" 
					class:active={page.url.pathname === '/settings'} 
					title="Settings"
				>
					<Settings size={24} strokeWidth={2} />
				</a>
			</div>
		</aside>

		<main class="content">
			{@render children()}
		</main>
	</div>
</div>

<style>
	:root {
		--bg-color: #ffffff;
		--sidebar-bg: #f3f3f3;
		--border-color: #e5e5e5;
		--text-color: #333333;
		--text-muted: #666666;
		--icon-color: #616161;
		--icon-active: #007acc;
		--icon-hover: #333333;
	}

	:global(html.dark) {
		--bg-color: #1e1e1e;
		--sidebar-bg: #333333;
		--border-color: #252525;
		--text-color: #ffffff;
		--text-muted: #cccccc;
		--icon-color: #858585;
		--icon-active: #ffffff;
		--icon-hover: #ffffff;
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
		transition: background-color 0.2s, color 0.2s;
	}

	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.app-layout {
		display: flex;
		flex: 1;
		min-height: 0; /* Important for flex child with overflow */
	}

	.sidebar {
		width: 48px;
		background-color: var(--sidebar-bg);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-right: 1px solid var(--border-color);
		transition: background-color 0.2s, border-color 0.2s;
	}

	.top-icons,
	.bottom-icons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		align-items: center;
	}

	.icon-btn {
		background: none;
		border: none;
		color: var(--icon-color);
		cursor: pointer;
		padding: 12px 0;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
		position: relative;
		text-decoration: none;
	}

	.icon-btn:hover {
		color: var(--icon-hover);
	}

	.icon-btn.active {
		color: var(--icon-active);
	}

	.icon-btn.active::before {
		content: '';
		position: absolute;
		left: 0;
		top: 10%;
		height: 80%;
		width: 2px;
		background-color: var(--icon-active);
	}

	.content {
		flex: 1;
		background-color: var(--bg-color);
		overflow: auto;
		padding: 24px;
		transition: background-color 0.2s;
	}
</style>


