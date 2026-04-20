<script>
	import { getContext } from 'svelte';

	const settings = getContext('settings-context');

	let theme = $derived(settings.theme);
	let showCheckboxes = $derived(settings.showCheckboxes);
	
	function handleThemeChange(e) {
		settings.theme = e.target.value;
	}

	function handleCheckboxToggle(e) {
		settings.showCheckboxes = e.target.checked;
	}
</script>

<div class="settings-page">
	<h1>Settings</h1>

	<div class="settings-container">
		<section class="settings-section">
			<h2>Interface</h2>
			
			<div class="setting-item">
				<label for="theme">Color Theme</label>
				<div class="select-wrapper">
					<select id="theme" value={theme} onchange={handleThemeChange}>
						<option value="system">System Default</option>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
					</select>
				</div>
				<p class="description">Select the theme that Sonixy will use for the interface.</p>
			</div>

			<div class="setting-item">
				<div class="checkbox-setting">
					<label class="custom-checkbox">
						<input 
							type="checkbox" 
							id="showCheckboxes" 
							checked={showCheckboxes} 
							onchange={handleCheckboxToggle} 
						/>
						<span class="checkmark"></span>
					</label>
					<label for="showCheckboxes" class="checkbox-label">Show Selection Checkboxes</label>
				</div>
				<p class="description">Show or hide the selection checkboxes in the file list.</p>
			</div>

			<div class="setting-item">
				<label>Column Order</label>
				<button class="reset-btn" onclick={() => settings.columnOrder = ['filename', 'format', 'length', 'size', 'tags']}>
					Reset Column Order
				</button>
				<p class="description">Reset the file list columns to their default order.</p>
			</div>
		</section>

		<section class="settings-section">
			<h2>About</h2>
			<p>Sonixy v0.1.0</p>
		</section>
	</div>
</div>

<style>
	.settings-page {
		padding: 24px;
	}

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
		margin-bottom: 24px;
	}

	.checkbox-setting {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.checkbox-label {
		font-size: 0.95rem;
		cursor: pointer;
	}

	.reset-btn {
		background-color: var(--sidebar-bg);
		color: var(--text-color);
		border: 1px solid var(--border-color);
		padding: 8px 16px;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		width: fit-content;
		transition: background-color 0.2s, border-color 0.2s;
	}

	.reset-btn:hover {
		background-color: var(--border-color);
		border-color: var(--icon-color);
	}

	.reset-btn:active {
		background-color: rgba(0, 0, 0, 0.05);
	}

	:global(html.dark) .reset-btn:active {
		background-color: rgba(255, 255, 255, 0.05);
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
		background-color: var(--sidebar-bg);
		color: var(--text-color);
		border: 1px solid var(--border-color);
		padding: 10px 14px;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		outline: none;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	select:hover {
		border-color: var(--icon-color);
	}

	select:focus {
		border-color: var(--icon-active);
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.3);
	}

	.select-wrapper::after {
		content: '▼';
		font-size: 0.7rem;
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: var(--text-muted);
	}

	/* Custom Checkbox */
	.custom-checkbox {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		cursor: pointer;
		user-select: none;
		width: 18px;
		height: 18px;
	}

	.custom-checkbox input {
		position: absolute;
		opacity: 0;
		cursor: pointer;
		height: 0;
		width: 0;
	}

	.checkmark {
		position: absolute;
		top: 0;
		left: 0;
		height: 18px;
		width: 18px;
		background-color: transparent;
		border: 1.5px solid var(--icon-color);
		border-radius: 3px;
		transition: all 0.2s;
	}

	.custom-checkbox:hover input ~ .checkmark {
		border-color: var(--icon-active);
	}

	.custom-checkbox input:checked ~ .checkmark {
		background-color: var(--icon-active);
		border-color: var(--icon-active);
	}

	.checkmark:after {
		content: '';
		position: absolute;
		display: none;
	}

	.custom-checkbox input:checked ~ .checkmark:after {
		display: block;
		left: 6px;
		top: 2px;
		width: 4px;
		height: 9px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	:global(html.dark) .custom-checkbox input:checked ~ .checkmark:after {
		border-color: #1e1e1e;
	}
</style>
