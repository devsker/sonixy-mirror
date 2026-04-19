<script>
	import { onMount } from 'svelte';

	let theme = $state('system');

	onMount(() => {
		const savedTheme = localStorage.getItem('theme') || 'system';
		theme = savedTheme;
	});

	$effect(() => {
		localStorage.setItem('theme', theme);
		applyTheme(theme);
	});

	function applyTheme(value) {
		const root = document.documentElement;
		root.classList.remove('light', 'dark');

		if (value === 'system') {
			const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			root.classList.add(systemDark ? 'dark' : 'light');
		} else {
			root.classList.add(value);
		}
	}

	// Listen for system theme changes if set to 'system'
	onMount(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (theme === 'system') applyTheme('system');
		};
		mediaQuery.addEventListener('change', handler);
		return () => mediaQuery.removeEventListener('change', handler);
	});
</script>

<h1>Settings</h1>

<div class="settings-container">
	<section class="settings-section">
		<h2>General</h2>
		<div class="setting-item">
			<label for="theme">Color Theme</label>
			<div class="select-wrapper">
				<select id="theme" bind:value={theme}>
					<option value="system">System Default</option>
					<option value="dark">Dark</option>
					<option value="light">Light</option>
				</select>
			</div>
			<p class="description">Select the theme that Sonixy will use for the interface.</p>
		</div>
	</section>

	<section class="settings-section">
		<h2>About</h2>
		<p>Sonixy v0.1.0</p>
	</section>
</div>

<style>
	.settings-container {
		display: flex;
		flex-direction: column;
		gap: 32px;
		max-width: 600px;
	}

	.settings-section h2 {
		border-bottom: 1px solid var(--border-color, #333);
		padding-bottom: 8px;
		margin-bottom: 16px;
		font-size: 1.2rem;
		font-weight: 600;
		color: var(--text-muted, #ccc);
	}

	.setting-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.description {
		font-size: 0.85rem;
		color: var(--text-muted, #888);
		margin-top: 4px;
	}

	.select-wrapper {
		position: relative;
		width: 100%;
		max-width: 300px;
	}

	select {
		appearance: none;
		width: 100%;
		background-color: #2d2d2d;
		color: #e1e1e1;
		border: 1px solid #454545;
		padding: 10px 14px;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		outline: none;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	select:hover {
		border-color: #666;
	}

	select:focus {
		border-color: #007acc;
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.3);
	}

	/* Custom arrow for the dropdown */
	.select-wrapper::after {
		content: '▼';
		font-size: 0.7rem;
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: #888;
	}

	option {
		background-color: #2d2d2d;
		color: #e1e1e1;
		padding: 8px;
	}
</style>
