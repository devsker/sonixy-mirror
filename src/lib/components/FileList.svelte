<script lang="ts">
	import { getContext } from 'svelte';
	import { ChevronUp, ChevronDown, Filter, FolderOpen, Loader2, AlertTriangle, Trash2, Search, Circle } from 'lucide-svelte';
	import { collectionStore, type FileItem } from '$lib/collection-store.svelte';

	interface SettingsState {
		theme: string;
		showCheckboxes: boolean;
		columnOrder: string[];
	}

	const settings = getContext<SettingsState>('settings-context');
	let showCheckboxes = $derived(settings?.showCheckboxes ?? false);

	let { onSelectionChange }: { onSelectionChange?: (ids: string[]) => void } = $props();

	let files = $derived(collectionStore.files);
	let loading = $derived(collectionStore.loading);
	let collectionPath = $derived(collectionStore.collectionPath);
	let processingFiles = $derived(collectionStore.processingFiles);
	let currentlyProcessingId = $derived(collectionStore.currentlyProcessingId);

	let selectedIds = $derived(files.filter((f) => f.selected).map((f) => f.id));

	$effect(() => {
		onSelectionChange?.(selectedIds);
	});

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
			result.sort((a, b) => {
				const valA = a[sortColumn as keyof FileItem];
				const valB = b[sortColumn as keyof FileItem];

				let compareA: string | number;
				let compareB: string | number;

				if (sortColumn === 'length' && typeof valA === 'string' && typeof valB === 'string') {
					compareA = parseDuration(valA);
					compareB = parseDuration(valB);
				} else if (sortColumn === 'size' && typeof valA === 'string' && typeof valB === 'string') {
					compareA = parseSize(valA);
					compareB = parseSize(valB);
				} else if (typeof valA === 'string' && typeof valB === 'string') {
					compareA = valA.toLowerCase();
					compareB = valB.toLowerCase();
				} else {
					compareA = String(valA);
					compareB = String(valB);
				}

				if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
				if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
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

	// Column definitions
	const columnConfigs: Record<string, { label: string; sortable?: boolean; filterable?: 'format' | 'tags' }> = {
		filename: { label: 'Filename', sortable: true },
		format: { label: 'Format', filterable: 'format' },
		length: { label: 'Length', sortable: true },
		size: { label: 'Size', sortable: true },
		tags: { label: 'Tags', filterable: 'tags' }
	};

	let draggingColumn = $state<string | null>(null);

	function handleDragStart(event: DragEvent, id: string) {
		draggingColumn = id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}

	function handleDragOver(event: DragEvent, targetId: string) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		
		if (draggingColumn && draggingColumn !== targetId) {
			const fromIndex = settings.columnOrder.indexOf(draggingColumn);
			const toIndex = settings.columnOrder.indexOf(targetId);
			
			if (fromIndex !== -1 && toIndex !== -1) {
				const newOrder = [...settings.columnOrder];
				newOrder.splice(fromIndex, 1);
				newOrder.splice(toIndex, 0, draggingColumn);
				settings.columnOrder = newOrder;
			}
		}
	}

	function handleDragEnd() {
		draggingColumn = null;
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
	{#if !collectionPath}
		<div class="empty-state">
			<FolderOpen size={48} />
			<h2>No collection open</h2>
			<p>Select a folder to start managing your audio files</p>
			<button class="open-btn" onclick={() => collectionStore.openCollection()}>
				Open Collection
			</button>
		</div>
	{:else if loading && files.length === 0}
		<div class="empty-state">
			<Loader2 size={48} class="animate-spin" />
			<p>Scanning files...</p>
		</div>
	{:else if files.length === 0}
		<div class="empty-state">
			<Filter size={48} />
			<h2>No audio files found</h2>
			<p>Try adding some audio files to the folder or drag them here</p>
		</div>
	{:else}
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
				{#each settings.columnOrder as columnId (columnId)}
					{@const config = columnConfigs[columnId]}
					<th 
						class="{columnId}-col" 
						class:sortable={config.sortable}
						class:filterable={!!config.filterable}
						class:dragging={draggingColumn === columnId}
						onclick={(e) => {
							if (config.sortable) toggleSort(columnId);
							else if (config.filterable) toggleFilterPopover(config.filterable, e);
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								if (config.sortable) toggleSort(columnId);
								else if (config.filterable) toggleFilterPopover(config.filterable, e as unknown as MouseEvent);
							}
						}}
						draggable="true"
						ondragstart={(e) => handleDragStart(e, columnId)}
						ondragover={(e) => handleDragOver(e, columnId)}
						ondragenter={(e) => e.preventDefault()}
						ondragend={handleDragEnd}
						role="button"
						tabindex="0"
					>
						<div class="header-content">
							<span>{config.label}</span>
							{#if config.sortable && sortColumn === columnId}
								<span class="status-icon">
									{#if sortDirection === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
								</span>
							{/if}
							{#if config.filterable === 'format' && selectedFormats.length > 0}
								<span class="status-icon active"><Filter size={12} /></span>
							{/if}
							{#if config.filterable === 'tags' && selectedTags.length > 0}
								<span class="status-icon active"><Filter size={12} /></span>
							{/if}

							{#if config.filterable === 'format' && activePopover === 'format'}
								<div 
									class="popover" 
									onclick={(e) => e.stopPropagation()}
									onkeydown={(e) => e.stopPropagation()}
									role="presentation"
								>
									<div class="popover-header">Filter Formats</div>
									<div class="popover-list">
										{#each allFormats as format (format)}
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
							{#if config.filterable === 'tags' && activePopover === 'tags'}
								<div 
									class="popover" 
									onclick={(e) => e.stopPropagation()}
									onkeydown={(e) => e.stopPropagation()}
									role="presentation"
								>
									<div class="popover-header">Filter Tags</div>
									<div class="popover-list">
										{#each allTags as tag (tag)}
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
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each displayedFiles as file, i (file.id)}
				<tr 
					class:selected={file.selected} 
					class:missing={file.missing}
					onclick={(e) => handleSelection(e, i)}
					onkeydown={(e) => e.key === 'Enter' && handleSelection(e as unknown as MouseEvent, i)}
					tabindex="0"
				>
					{#if showCheckboxes}
						<td class="checkbox-col">
							<label class="custom-checkbox">
								<input 
									type="checkbox" 
									checked={file.selected} 
									onchange={(e) => handleSelection(e as unknown as MouseEvent, i)}
								/>
								<span class="checkmark"></span>
							</label>
						</td>
					{/if}
					{#each settings.columnOrder as columnId (columnId)}
						{#if columnId === 'filename'}
							<td class="filename-col" title={file.filename}>
								<div class="name-wrapper">
									{#if processingFiles.has(file.id)}
										<span class="processing-icon" class:queued={currentlyProcessingId !== file.id} title={currentlyProcessingId === file.id ? "Processing..." : "Queued"}>
											{#if currentlyProcessingId === file.id}
												<Loader2 size={14} class="animate-spin" />
											{:else}
												<Circle size={10} strokeWidth={3} />
											{/if}
										</span>
									{/if}
									{#if file.missing}
										<span class="warning-icon" title="File not found">
											<AlertTriangle size={14} />
										</span>
									{/if}
									<span>{file.filename}</span>
								</div>
							</td>
						{:else if columnId === 'format'}
							<td class="format-col">
								{#if file.missing}
									<div class="missing-actions">
										<button 
											class="action-icon" 
											onclick={(e) => { e.stopPropagation(); collectionStore.relocateFile(file.id); }}
											title="Locate file"
										>
											<Search size={14} />
										</button>
										<button 
											class="action-icon danger" 
											onclick={(e) => { e.stopPropagation(); collectionStore.removeFile(file.id); }}
											title="Remove from collection"
										>
											<Trash2 size={14} />
										</button>
									</div>
								{:else}
									{file.format}
								{/if}
							</td>
						{:else if columnId === 'length'}
							<td class="length-col">{file.missing ? '-' : file.length}</td>
						{:else if columnId === 'size'}
							<td class="size-col">{file.missing ? '-' : file.size}</td>
						{:else if columnId === 'tags'}
							<td class="tags-col">
								{#if !file.missing}
									<div class="tags-wrapper">
										{#each file.tags as tag (tag)}
											<span class="tag">{tag}</span>
										{/each}
									</div>
								{/if}
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
	{/if}
</div>

<style>
	.file-list-container {
		width: 100%;
		flex: 1;
		overflow-y: scroll;
		scrollbar-gutter: stable;
		min-height: 0;
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
		cursor: grab;
	}

	th.dragging .header-content {
		cursor: grabbing;
	}

	th.sortable:hover .header-content,
	th.filterable:hover .header-content {
		background-color: rgba(0, 0, 0, 0.03);
		color: var(--text-color);
	}

	th.dragging {
		opacity: 0.5;
		background-color: var(--border-color);
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

	tr.missing {
		background-color: rgba(255, 166, 0, 0.05);
	}

	:global(html.dark) tr.missing {
		background-color: rgba(255, 166, 0, 0.1);
	}

	tr.missing td {
		color: var(--text-muted);
	}

	tr:focus-visible {
		box-shadow: inset 0 0 0 1px var(--icon-active);
	}

	.name-wrapper {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.warning-icon {
		color: #ffa600;
		display: flex;
		align-items: center;
	}

	.processing-icon {
		color: var(--accent-color, #3b82f6);
		display: flex;
		align-items: center;
		min-width: 14px;
		justify-content: center;
	}

	.processing-icon.queued {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.missing-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.action-icon {
		background: none;
		border: none;
		padding: 4px;
		border-radius: 4px;
		color: var(--icon-color);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.1s, color 0.1s;
	}

	.action-icon:hover {
		background-color: rgba(0, 0, 0, 0.05);
		color: var(--icon-active);
	}

	:global(html.dark) .action-icon:hover {
		background-color: rgba(255, 255, 255, 0.05);
		color: white;
	}

	.action-icon.danger:hover {
		background-color: #e81123;
		color: white;
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

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 40px;
		color: var(--text-muted);
		text-align: center;
		overflow: hidden;
	}

	.empty-state h2 {
		margin: 16px 0 8px;
		font-size: 18px;
		color: var(--text-color);
	}

	.empty-state p {
		margin-bottom: 24px;
		font-size: 14px;
	}

	.open-btn {
		background-color: #007acc;
		color: #ffffff;
		border: none;
		padding: 10px 20px;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.1s;
	}

	.open-btn:hover {
		opacity: 0.9;
	}

	:global(.animate-spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
