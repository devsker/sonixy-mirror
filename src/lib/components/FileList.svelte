<script lang="ts">
	import { getContext } from 'svelte';
	import { ChevronUp, ChevronDown, Filter } from 'lucide-svelte';

	const settings = getContext<any>('settings-context');
	let showCheckboxes = $derived(settings?.showCheckboxes ?? false);

	interface FileItem {
		id: string;
		filename: string;
		format: string;
		length: string;
		size: string;
		tags: string[];
		selected: boolean;
	}

	let files = $state<FileItem[]>([
		{
			id: '1',
			filename: 'Explosion_Large_Distal.wav',
			format: 'WAV',
			length: '0:04',
			size: '1.2 MB',
			tags: ['Impact', 'Cinematic'],
			selected: false
		},
		{
			id: '2',
			filename: 'UI_Click_Modern_03.mp3',
			format: 'MP3',
			length: '0:01',
			size: '45 KB',
			tags: ['UI', 'Interface'],
			selected: false
		},
		{
			id: '3',
			filename: 'Footsteps_Concrete_Run_Loop.wav',
			format: 'WAV',
			length: '0:12',
			size: '4.8 MB',
			tags: ['Foley', 'Movement'],
			selected: false
		},
		{
			id: '4',
			filename: 'Laser_Gun_Shot_01.wav',
			format: 'WAV',
			length: '0:02',
			size: '850 KB',
			tags: ['Sci-Fi', 'Weapon'],
			selected: false
		},
		{
			id: '5',
			filename: 'Ambient_Wind_Howling_Loop.flac',
			format: 'FLAC',
			length: '2:30',
			size: '32.4 MB',
			tags: ['Ambient', 'Nature'],
			selected: false
		}
	]);

	// Filter & Sort State
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc'>('asc');
	let selectedFormats = $state<string[]>([]);
	let selectedTags = $state<string[]>([]);
	let activePopover = $state<'format' | 'tags' | null>(null);

	// Derived lists for filters
	const allFormats = $derived([...new Set(files.map((f) => f.format))].sort());
	const allTags = $derived([...new Set(files.flatMap((f) => f.tags))].sort());

	function parseDuration(d: string) {
		const parts = d.split(':').map(Number);
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		return parts[0];
	}

	function parseSize(s: string) {
		const [val, unit] = s.split(' ');
		const num = parseFloat(val);
		if (unit === 'KB') return num * 1024;
		if (unit === 'MB') return num * 1024 * 1024;
		if (unit === 'GB') return num * 1024 * 1024 * 1024;
		return num;
	}

	let filteredAndSortedFiles = $derived(() => {
		let result = [...files];

		// Apply Filters
		if (selectedFormats.length > 0) {
			result = result.filter((f) => selectedFormats.includes(f.format));
		}
		if (selectedTags.length > 0) {
			result = result.filter((f) => f.tags.some((t) => selectedTags.includes(t)));
		}

		// Apply Sorting
		if (sortColumn) {
			result.sort((a: any, b: any) => {
				let valA = a[sortColumn!];
				let valB = b[sortColumn!];

				if (sortColumn === 'length') {
					valA = parseDuration(valA);
					valB = parseDuration(valB);
				} else if (sortColumn === 'size') {
					valA = parseSize(valA);
					valB = parseSize(valB);
				} else if (typeof valA === 'string') {
					valA = valA.toLowerCase();
					valB = valB.toLowerCase();
				}

				if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
				if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
				return 0;
			});
		}

		return result;
	});

	let displayedFiles = $derived(filteredAndSortedFiles());

	let allSelected = $derived(displayedFiles.length > 0 && displayedFiles.every((f) => f.selected));
	let someSelected = $derived(displayedFiles.some((f) => f.selected) && !allSelected);

	let lastSelectedIndex = $state(-1);

	function toggleAll() {
		const newState = !allSelected;
		displayedFiles.forEach((f) => (f.selected = newState));
	}

	function handleSelection(event: MouseEvent, index: number) {
		const isShift = event.shiftKey;
		const isCtrl = event.ctrlKey || event.metaKey;

		if (isShift && lastSelectedIndex !== -1) {
			const start = Math.min(lastSelectedIndex, index);
			const end = Math.max(lastSelectedIndex, index);
			for (let i = start; i <= end; i++) {
				displayedFiles[i].selected = true;
			}
		} else if (isCtrl) {
			displayedFiles[index].selected = !displayedFiles[index].selected;
			lastSelectedIndex = index;
		} else {
			files.forEach((f) => (f.selected = false));
			displayedFiles[index].selected = true;
			lastSelectedIndex = index;
		}
	}

	function toggleSort(col: string) {
		if (sortColumn === col) {
			if (sortDirection === 'asc') sortDirection = 'desc';
			else {
				sortColumn = null;
				sortDirection = 'asc';
			}
		} else {
			sortColumn = col;
			sortDirection = 'asc';
		}
	}

	function toggleFilterPopover(type: 'format' | 'tags', event: MouseEvent) {
		event.stopPropagation();
		if (activePopover === type) activePopover = null;
		else activePopover = type;
	}

	function toggleFormatFilter(format: string) {
		if (selectedFormats.includes(format)) {
			selectedFormats = selectedFormats.filter((f) => f !== format);
		} else {
			selectedFormats = [...selectedFormats, format];
		}
	}

	function toggleTagFilter(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter((t) => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
	}

	function closePopovers() {
		activePopover = null;
	}
</script>

<svelte:window onclick={closePopovers} />

<div class="file-list-container">
	<table class="file-table" class:no-checkboxes={!showCheckboxes}>
		<thead>
			<tr>
				{#if showCheckboxes}
					<th class="checkbox-col">
						<label class="custom-checkbox">
							<input
								type="checkbox"
								checked={allSelected}
								indeterminate={someSelected}
								onchange={toggleAll}
							/>
							<span class="checkmark"></span>
						</label>
					</th>
				{/if}
				<th class="filename-col sortable" onclick={() => toggleSort('filename')}>
					<div class="header-content">
						<span>Filename</span>
						{#if sortColumn === 'filename'}
							<span class="status-icon">
								{#if sortDirection === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
							</span>
						{/if}
					</div>
				</th>
				<th class="format-col filterable" onclick={(e) => toggleFilterPopover('format', e)}>
					<div class="header-content">
						<span>Format</span>
						{#if selectedFormats.length > 0}
							<span class="status-icon active"><Filter size={12} /></span>
						{/if}
						{#if activePopover === 'format'}
							<div class="popover" onclick={(e) => e.stopPropagation()}>
								<div class="popover-header">Filter Formats</div>
								<div class="popover-list">
									{#each allFormats as format}
										<label class="popover-item">
											<div class="custom-checkbox">
												<input type="checkbox" checked={selectedFormats.includes(format)} onchange={() => toggleFormatFilter(format)} />
												<span class="checkmark"></span>
											</div>
											<span class="item-label">{format}</span>
										</label>
									{/each}
								</div>
								{#if selectedFormats.length > 0}
									<button class="clear-btn" onclick={() => selectedFormats = []}>Clear All</button>
								{/if}
							</div>
						{/if}
					</div>
				</th>
				<th class="length-col sortable" onclick={() => toggleSort('length')}>
					<div class="header-content">
						<span>Length</span>
						{#if sortColumn === 'length'}
							<span class="status-icon">
								{#if sortDirection === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
							</span>
						{/if}
					</div>
				</th>
				<th class="size-col sortable" onclick={() => toggleSort('size')}>
					<div class="header-content">
						<span>Size</span>
						{#if sortColumn === 'size'}
							<span class="status-icon">
								{#if sortDirection === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
							</span>
						{/if}
					</div>
				</th>
				<th class="tags-col filterable" onclick={(e) => toggleFilterPopover('tags', e)}>
					<div class="header-content">
						<span>Tags</span>
						{#if selectedTags.length > 0}
							<span class="status-icon active"><Filter size={12} /></span>
						{/if}
						{#if activePopover === 'tags'}
							<div class="popover" onclick={(e) => e.stopPropagation()}>
								<div class="popover-header">Filter Tags</div>
								<div class="popover-list">
									{#each allTags as tag}
										<label class="popover-item">
											<div class="custom-checkbox">
												<input type="checkbox" checked={selectedTags.includes(tag)} onchange={() => toggleTagFilter(tag)} />
												<span class="checkmark"></span>
											</div>
											<span class="item-label">{tag}</span>
										</label>
									{/each}
								</div>
								{#if selectedTags.length > 0}
									<button class="clear-btn" onclick={() => selectedTags = []}>Clear All</button>
								{/if}
							</div>
						{/if}
					</div>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each displayedFiles as file, i (file.id)}
				<tr 
					class:selected={file.selected} 
					onclick={(e) => handleSelection(e, i)}
					onkeydown={(e) => e.key === 'Enter' && handleSelection(e as any, i)}
					tabindex="0"
				>
					{#if showCheckboxes}
						<td class="checkbox-col">
							<label class="custom-checkbox" onclick={(e) => e.stopPropagation()}>
								<input 
									type="checkbox" 
									checked={file.selected} 
									onchange={(e) => handleSelection(e as any, i)}
								/>
								<span class="checkmark"></span>
							</label>
						</td>
					{/if}
					<td class="filename-col" title={file.filename}>{file.filename}</td>
					<td class="format-col">{file.format}</td>
					<td class="length-col">{file.length}</td>
					<td class="size-col">{file.size}</td>
					<td class="tags-col">
						<div class="tags-wrapper">
							{#each file.tags as tag}
								<span class="tag">{tag}</span>
							{/each}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.file-list-container {
		width: 100%;
		height: 100%;
		overflow-y: scroll;
		scrollbar-gutter: stable;
	}

	.file-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 14px;
		color: var(--text-color);
		table-layout: fixed;
	}

	thead {
		position: sticky;
		top: 0;
		background-color: var(--bg-color);
		z-index: 100;
	}

	thead::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
		border-bottom: 1px solid var(--border-color);
	}

	th {
		padding: 0;
		font-weight: 600;
		color: var(--text-muted);
		white-space: nowrap;
		height: 48px;
	}

	.header-content {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		height: 100%;
		width: 100%;
		box-sizing: border-box;
		position: relative;
		transition: background-color 0.1s;
	}

	.header-content span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	th.sortable .header-content,
	th.filterable .header-content {
		cursor: pointer;
	}

	th.sortable:hover .header-content,
	th.filterable:hover .header-content {
		background-color: rgba(0, 0, 0, 0.03);
		color: var(--text-color);
	}

	:global(html.dark) th.sortable:hover .header-content,
	:global(html.dark) th.filterable:hover .header-content {
		background-color: rgba(255, 255, 255, 0.03);
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		color: var(--icon-active);
		flex-shrink: 0;
	}

	.status-icon.active {
		color: var(--icon-active);
	}

	td {
		padding: 14px 12px;
		border-bottom: 1px solid var(--border-color);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	tr {
		cursor: default;
		user-select: none;
		outline: none;
	}

	tr:hover {
		background-color: rgba(0, 0, 0, 0.02);
	}

	:global(html.dark) tr:hover {
		background-color: rgba(255, 255, 255, 0.03);
	}

	tr.selected {
		background-color: rgba(0, 122, 204, 0.1);
	}

	:global(html.dark) tr.selected {
		background-color: rgba(0, 122, 204, 0.2);
	}

	tr:focus-visible {
		box-shadow: inset 0 0 0 1px var(--icon-active);
	}

	.checkbox-col {
		width: 56px;
	}

	.filename-col {
		width: auto;
	}

	.file-table.no-checkboxes .filename-col .header-content {
		padding-left: 16px;
	}

	.format-col { width: 100px; }
	.length-col { width: 100px; }
	.size-col { width: 100px; }
	.tags-col { width: 200px; }

	.tags-wrapper {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.tag {
		background-color: var(--border-color);
		color: var(--text-muted);
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 11px;
	}

	/* Popover Styles */
	.popover {
		position: absolute;
		top: calc(100% - 4px);
		left: 8px;
		background-color: var(--bg-color);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		z-index: 1000;
		min-width: 200px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		cursor: default;
	}

	.popover.popover-right {
		left: auto;
		right: 8px;
	}

	.popover-header {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-muted);
		padding: 8px 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.popover-list {
		max-height: 240px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: 2px 0;
	}

	.popover-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		cursor: pointer;
		border-radius: 6px;
		transition: background-color 0.1s;
	}

	.popover-item:hover {
		background-color: rgba(0, 0, 0, 0.04);
	}

	:global(html.dark) .popover-item:hover {
		background-color: rgba(255, 255, 255, 0.06);
	}

	.item-label {
		font-size: 13px;
		color: var(--text-color);
		flex: 1;
	}

	.clear-btn {
		background: none;
		border: none;
		color: var(--icon-active);
		font-size: 12px;
		font-weight: 600;
		padding: 10px;
		cursor: pointer;
		text-align: center;
		border-top: 1px solid var(--border-color);
		margin-top: 4px;
		border-radius: 0 0 6px 6px;
	}

	.clear-btn:hover {
		background-color: rgba(0, 122, 204, 0.05);
	}

	/* Custom Checkbox Styles (re-usable) */
	.custom-checkbox {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		cursor: pointer;
		user-select: none;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
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
		height: 16px;
		width: 16px;
		background-color: transparent;
		border: 1.5px solid var(--icon-color);
		border-radius: 3px;
		transition: all 0.1s;
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
		left: 5px;
		top: 2px;
		width: 3px;
		height: 7px;
		border: solid white;
		border-width: 0 1.5px 1.5px 0;
		transform: rotate(45deg);
	}

	:global(html.dark) .custom-checkbox input:checked ~ .checkmark:after {
		border-color: #1e1e1e;
	}
</style>
