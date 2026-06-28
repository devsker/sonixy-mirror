import { invoke } from '@tauri-apps/api/core';
import { confirm as confirmDialog, open, save } from '@tauri-apps/plugin-dialog';
import { promptCopyOrMove } from './native-dialog';
import { listen } from '@tauri-apps/api/event';
import { remove } from '@tauri-apps/plugin-fs';
import { audioPlayer } from './audio-player';
import { settingsStore } from './settings-store';
import { useCollectionVersion, useWaveformProgressVersion } from './store-sync';
import { collectionDisplayName, collectionPathsEqual } from './collection-path';
import { timeComputeDisplayed } from './perf';

export interface FileItem {
	id: string;
	filename: string;
	filepath: string;
	format: string;
	length: string;
	duration: number;
	size: string;
	tags: string[];
	gain: number;
	selected: boolean;
	missing: boolean;
}

export interface CollectionSnapshot {
	version: number;
	files: Omit<FileItem, 'selected'>[];
}

export interface CollectionPatch {
	version: number;
	added?: Omit<FileItem, 'selected'>[];
	updated?: Omit<FileItem, 'selected'>[];
	removed?: string[];
}

export interface Task {
	id: string;
	name: string;
	progress: number; // 0 to 100
	status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
	message?: string;
	total?: number;
	completed?: number;
	startTime?: number;
	eta?: string;
	progressHistory?: { time: number; completed: number }[];
	pausedDuration?: number;
	pauseStartTime?: number;
}

const SWITCH_UI_DELAY_MS = 300;

class CollectionStore {
	files: FileItem[] = [];
	collectionPath: string | null = null;
	loading = false;
	/** True while a collection switch is in progress (blocks duplicate switches). */
	switchingCollection = false;
	/** True only after switch exceeds SWITCH_UI_DELAY_MS (drives loading overlays). */
	showSwitchingUi = false;
	switchingToPath: string | null = null;
	private switchingUiTimer: ReturnType<typeof setTimeout> | null = null;
	tasks: Task[] = [];
	processingPaused = false;
	processingFiles: Set<string> = new Set();
	currentlyProcessingIds: Set<string> = new Set();
	waveformProgress: Record<string, number> = {};
	partialWaveforms: Record<string, number[]> = {};
	isDraggingFromApp = false;
	private libraryTransferUnlisten: (() => void) | null = null;
	private activeLibraryTransferTaskId: string | null = null;
	private pendingImportOpen = false;
	private libraryProgressRaf: number | null = null;
	private waveformProgressNotifyRaf: number | null = null;
	private pendingLibraryProgress: { progress: number; message?: string } | null = null;
	tasksPanelRequest = 0;
	/**
	 * Version of the last known backend file list. When this drifts from the
	 * version returned by a Rust command, the frontend should re-fetch the
	 * full list. Reset to 0 whenever a new collection is opened.
	 */
	knownVersion: number = 0;
	get displayedFiles() {
		return this.computeDisplayedFiles(this.files);
	}

	private displayedCacheKey: string | null = null;
	private displayedCacheResult: FileItem[] | null = null;
	private sizeSortCache: WeakMap<FileItem[], Map<string, number>> = new WeakMap();

	private buildSizeMap(files: readonly FileItem[]): Map<string, number> {
		const cached = this.sizeSortCache.get(files as FileItem[]);
		if (cached) return cached;
		const map = new Map<string, number>();
		for (const f of files) {
			map.set(f.id, this.parseSize(f.size));
		}
		this.sizeSortCache.set(files as FileItem[], map);
		return map;
	}

	computeDisplayedFiles(source: readonly FileItem[] = this.files) {
		const query = settingsStore.filenameQuery.trim().toLowerCase();
		const sortCol = settingsStore.sortColumn;
		const sortDir = settingsStore.sortDirection;
		const formats = settingsStore.selectedFormats;
		const tags = settingsStore.selectedTags;

		// Cache key includes the source identity and the active filter/sort settings.
		// Bumping useCollectionVersion / useSettingsVersion forces React to re-run us,
		// so we don't need to include version numbers — we just need to make sure the
		// cache invalidates when the user mutates any of these inputs.
		const formatsKey = formats.length === 0 ? '' : formats.join(',');
		const tagsKey = tags.length === 0 ? '' : tags.join(',');
		const key = `${(source as FileItem[]).length}|${query}|${formatsKey}|${tagsKey}|${sortCol ?? ''}|${sortDir}`;

		if (this.displayedCacheKey === key && this.displayedCacheResult) {
			return this.displayedCacheResult;
		}

		const result = timeComputeDisplayed(() => {
			let out: FileItem[] = [...(source as FileItem[])];

			if (query) {
				out = out.filter((f) => f.filename.toLowerCase().includes(query));
			}

			if (formats.length > 0) {
				const fmtSet = new Set(formats);
				out = out.filter((f) => fmtSet.has(f.format));
			}
			if (tags.length > 0) {
				const tagSet = new Set(tags);
				out = out.filter((f) => f.tags.some((t) => tagSet.has(t)));
			}

			if (sortCol) {
				const col = sortCol;
				const dir = sortDir;
				const sizeMap = col === 'size' ? this.buildSizeMap(source) : null;

				out.sort((a, b) => {
					let compareA: string | number;
					let compareB: string | number;

					if (col === 'length') {
						compareA = a.duration;
						compareB = b.duration;
					} else if (col === 'size') {
						compareA = sizeMap!.get(a.id) ?? 0;
						compareB = sizeMap!.get(b.id) ?? 0;
					} else {
						const valA = a[col as keyof FileItem];
						const valB = b[col as keyof FileItem];
						if (typeof valA === 'string' && typeof valB === 'string') {
							compareA = valA.toLowerCase();
							compareB = valB.toLowerCase();
						} else {
							compareA = String(valA);
							compareB = String(valB);
						}
					}

					if (compareA < compareB) return dir === 'asc' ? -1 : 1;
					if (compareA > compareB) return dir === 'asc' ? 1 : -1;
					return 0;
				});
			}

			return out;
		});

		this.displayedCacheKey = key;
		this.displayedCacheResult = result;
		return result;
	}

	invalidateDisplayedCache() {
		this.displayedCacheKey = null;
		this.displayedCacheResult = null;
	}

	/**
	 * Apply a `CollectionPatch` from the backend in place. Mutates `this.files`
	 * by inserting new rows, replacing updated rows, and splicing out removed
	 * rows. Preserves the `selected` flag on replaced rows.
	 */
	applyPatch(patch: CollectionPatch) {
		this.knownVersion = patch.version;
		this.invalidateDisplayedCache();

		if (patch.removed && patch.removed.length > 0) {
			const removedSet = new Set(patch.removed);
			this.files = this.files.filter((f) => !removedSet.has(f.id));
		}

		if (patch.updated && patch.updated.length > 0) {
			const indexById = new Map<string, number>();
			for (let i = 0; i < this.files.length; i++) {
				indexById.set(this.files[i].id, i);
			}
			for (const u of patch.updated) {
				const idx = indexById.get(u.id);
				if (idx !== undefined) {
					const selected = this.files[idx].selected;
					this.files[idx] = { ...u, selected };
				}
			}
		}

		if (patch.added && patch.added.length > 0) {
			const existingPaths = new Set(this.files.map((f) => f.filepath));
			for (const f of patch.added) {
				if (existingPaths.has(f.filepath)) continue;
				this.files.push({ ...f, selected: false });
			}
		}
	}

	private parseSize(s: string) {
		const [val, unit] = s.split(' ');
		const num = parseFloat(val);
		if (unit === 'KB') return num * 1024;
		if (unit === 'MB') return num * 1024 * 1024;
		if (unit === 'GB') return num * 1024 * 1024 * 1024;
		return num;
	}

	constructor() {
		// Automatically open last collection if it exists
		if (typeof window !== 'undefined') {
			const lastPath = localStorage.getItem('lastCollectionPath');
			if (lastPath) {
				this.openCollectionByPath(lastPath);
			}

			// Listen for waveform started
			listen('waveform-started', (event) => {
				const id = event.payload as string;
				// Normalization uses a synthetic id; only track real work units.
				if (!id.endsWith('-normalizing')) {
					this.currentlyProcessingIds.add(id);
					this.currentlyProcessingIds = new Set(this.currentlyProcessingIds);
				}

				delete this.waveformProgress[id];
				delete this.partialWaveforms[id];
				this.notify();
			});

			listen('waveform-progress', (event) => {
				const payload = event.payload as { id: string; progress: number; data?: number[] };
				this.waveformProgress[payload.id] = payload.progress;
				if (payload.data) {
					this.partialWaveforms[payload.id] = payload.data;
				}
				this.notifyWaveformProgress();
			});

			// Listen for waveform generation
			this.setupLibraryTransferListeners();

			listen('waveform-generated', (event) => {
				const payload = event.payload as { id: string; gain: number };
				const id = payload.id;
				const gain = payload.gain;

				if (id.endsWith('-converting')) {
					const task = this.tasks.find((t) => t.id === 'conversions');
					if (task && task.completed !== undefined) {
						task.completed++;
						this.currentlyProcessingIds.delete(id);
						this.currentlyProcessingIds = new Set(this.currentlyProcessingIds);
						delete this.waveformProgress[id];
						if (task.completed >= (task.total || 0)) {
							this.updateTask(task.id, { status: 'completed', progress: 100 });
						} else {
							this.syncBatchTask('conversions');
						}
					}

					this.reloadFiles();
				} else {
					// Update file gain in store
					const file = this.files.find((f) => f.id === id);
					if (file) {
						file.gain = gain;
					}

					this.processingFiles.delete(id);
					this.processingFiles = new Set(this.processingFiles); // Trigger reactivity

					this.currentlyProcessingIds.delete(id);
					this.currentlyProcessingIds = new Set(this.currentlyProcessingIds);

					const task = this.tasks.find((t) => t.id === 'waveforms');
					if (task && task.total !== undefined && task.completed !== undefined) {
						task.completed++;
						delete this.waveformProgress[id];
						if (task.completed >= task.total) {
							this.updateTask(task.id, { status: 'completed', progress: 100, eta: undefined });
						} else {
							this.syncBatchTask('waveforms');
						}
					}
				}
				this.notify();
			});
		}
	}

	notify() {
		useCollectionVersion.getState().bump();
	}

	notifyWaveformProgress() {
		if (this.waveformProgressNotifyRaf !== null) return;
		this.waveformProgressNotifyRaf = requestAnimationFrame(() => {
			this.waveformProgressNotifyRaf = null;
			useWaveformProgressVersion.getState().bump();
		});
	}

	private setupLibraryTransferListeners() {
		if (this.libraryTransferUnlisten) return;

		const progressUnlisten = listen('library-transfer-progress', (event) => {
			const payload = event.payload as {
				phase: string;
				progress: number;
				message?: string;
			};
			const taskId = this.activeLibraryTransferTaskId;
			if (!taskId) return;

			this.pendingLibraryProgress = {
				progress: Math.round(payload.progress * 100),
				message: payload.message
			};
			if (this.libraryProgressRaf !== null) return;

			this.libraryProgressRaf = requestAnimationFrame(() => {
				this.libraryProgressRaf = null;
				const pending = this.pendingLibraryProgress;
				const activeId = this.activeLibraryTransferTaskId;
				if (!pending || !activeId) return;
				this.pendingLibraryProgress = null;
				this.updateTask(activeId, {
					progress: pending.progress,
					message: pending.message
				});
			});
		});

		const doneUnlisten = listen('library-transfer-done', (event) => {
			const payload = event.payload as { phase: string; result_path?: string };
			const taskId = this.activeLibraryTransferTaskId;
			if (!taskId) return;
			this.updateTask(taskId, { progress: 100, status: 'completed' });
			this.activeLibraryTransferTaskId = null;

			if (payload.phase === 'import' && payload.result_path && this.pendingImportOpen) {
				this.pendingImportOpen = false;
				settingsStore.addRecentCollection(payload.result_path);
				void this.openCollectionByPath(payload.result_path, { force: true });
			}
		});

		const errorUnlisten = listen('library-transfer-error', (event) => {
			const taskId = this.activeLibraryTransferTaskId;
			if (!taskId) return;
			this.pendingImportOpen = false;
			this.updateTask(taskId, {
				status: 'failed',
				message: String(event.payload)
			});
			this.activeLibraryTransferTaskId = null;
		});

		this.libraryTransferUnlisten = () => {
			void progressUnlisten.then((u) => u());
			void doneUnlisten.then((u) => u());
			void errorUnlisten.then((u) => u());
		};
	}

	private beginLibraryTransferTask(name: string): string {
		const taskId = `library-transfer-${Math.random().toString(36).slice(2, 9)}`;
		this.activeLibraryTransferTaskId = taskId;
		this.tasksPanelRequest += 1;
		this.addTask({
			id: taskId,
			name,
			progress: 0,
			status: 'running',
			message: 'Starting…'
		});
		return taskId;
	}

	private clearOpenCollectionState() {
		this.collectionPath = null;
		this.files = [];
		this.tasks = [];
		this.processingFiles = new Set();
		this.processingPaused = false;
		this.currentlyProcessingIds = new Set();
		this.waveformProgress = {};
		this.partialWaveforms = {};
		this.loading = false;
		this.endSwitchingUi();
		localStorage.removeItem('lastCollectionPath');
	}

	async unloadLibrary() {
		if (!this.collectionPath || this.switchingCollection) return;

		audioPlayer.stop();
		try {
			await invoke('close_collection');
		} catch (e) {
			console.error('Failed to unload library', e);
		}
		this.clearOpenCollectionState();
		this.notify();
	}

	async removeLibrary(path: string) {
		const name = collectionDisplayName(path);
		const confirmed = await confirmDialog(
			`Permanently delete "${name}" and all files inside it?\n\nThis cannot be undone.`,
			{
				title: 'Delete library',
				kind: 'error',
				okLabel: 'Delete',
				cancelLabel: 'Cancel'
			}
		);
		if (!confirmed) return;

		if (collectionPathsEqual(this.collectionPath, path)) {
			await this.unloadLibrary();
		}

		try {
			await invoke('delete_collection_folder', { path });
		} catch (e) {
			console.error('Failed to delete library', e);
			this.addTask({
				id: `delete-library-${Date.now()}`,
				name: 'Delete library',
				progress: 0,
				status: 'failed',
				message: e instanceof Error ? e.message : String(e)
			});
			return;
		}

		settingsStore.removeRecentCollection(path);
		const key = path.replace(/\\/g, '/').replace(/\/+$/, '');
		if (settingsStore.collectionUiByPath[key]) {
			const rest = { ...settingsStore.collectionUiByPath };
			delete rest[key];
			settingsStore.collectionUiByPath = rest;
			settingsStore.notify();
		}
	}

	async exportLibrary() {
		if (!this.collectionPath) return;

		if (this.tasks.some((t) => t.id === 'waveforms' || t.id === 'conversions')) {
			this.addTask({
				id: `export-blocked-${Date.now()}`,
				name: 'Export library',
				progress: 0,
				status: 'failed',
				message: 'Wait for waveform or conversion tasks to finish before exporting'
			});
			return;
		}
		if (this.currentlyProcessingIds.size > 0) {
			this.addTask({
				id: `export-blocked-${Date.now()}`,
				name: 'Export library',
				progress: 0,
				status: 'failed',
				message: 'Wait for processing to finish before exporting'
			});
			return;
		}

		const defaultName = `${collectionDisplayName(this.collectionPath)}.sonixylibrary`;
		const outputPath = await save({
			title: 'Export library',
			defaultPath: defaultName,
			filters: [{ name: 'Sonixy library', extensions: ['sonixylibrary'] }]
		});
		if (!outputPath) return;

		this.beginLibraryTransferTask('Exporting library');
		void invoke('export_collection_library', { outputPath }).catch((e) => {
			console.error('Failed to start export', e);
			const taskId = this.activeLibraryTransferTaskId;
			if (taskId) {
				this.updateTask(taskId, {
					status: 'failed',
					message: e instanceof Error ? e.message : String(e)
				});
				this.activeLibraryTransferTaskId = null;
			}
		});
	}

	async importLibrary() {
		const archivePath = await open({
			title: 'Import library',
			multiple: false,
			filters: [{ name: 'Sonixy library', extensions: ['sonixylibrary'] }]
		});
		if (!archivePath || typeof archivePath !== 'string') return;

		const parentDir = await open({
			directory: true,
			multiple: false,
			title: 'Choose parent folder for imported library'
		});
		if (!parentDir || typeof parentDir !== 'string') return;

		this.pendingImportOpen = true;
		this.beginLibraryTransferTask('Importing library');
		void invoke('import_collection_library', { archivePath, parentDir }).catch((e) => {
			console.error('Failed to start import', e);
			this.pendingImportOpen = false;
			const taskId = this.activeLibraryTransferTaskId;
			if (taskId) {
				this.updateTask(taskId, {
					status: 'failed',
					message: e instanceof Error ? e.message : String(e)
				});
				this.activeLibraryTransferTaskId = null;
			}
		});
	}

	private static readonly ETA_WINDOW_MS = 20_000;

	/** Batch task percent: finished count over total (matches the X / Y message). */
	private batchTaskPercent(task: Task): number {
		if (task.status === 'completed') return 100;
		if (task.total === undefined || task.completed === undefined) return task.progress;
		if (task.total === 0) return 100;
		return Math.min(100, (task.completed / task.total) * 100);
	}

	private syncBatchTask(taskId: 'waveforms' | 'conversions'): void {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task || task.total === undefined || task.completed === undefined) return;

		task.progress = this.batchTaskPercent(task);

		const etaMessage = task.status !== 'paused' ? this.computeEtaMessage(task) : '';
		task.eta = etaMessage || undefined;

		if (taskId === 'waveforms') {
			task.message = `${task.completed} / ${task.total} waveforms${etaMessage}`;
		} else {
			task.message = `Standardizing ${task.completed} / ${task.total} files${etaMessage}`;
		}
	}

	private computeEtaMessage(task: Task): string {
		if (task.total === undefined || task.completed === undefined || task.completed <= 0) return '';
		const unitsDone = task.completed;
		const now = Date.now();

		if (!task.progressHistory) task.progressHistory = [];
		task.progressHistory.push({ time: now, completed: unitsDone });

		const cutoff = now - CollectionStore.ETA_WINDOW_MS;
		while (task.progressHistory.length > 1 && task.progressHistory[0].time < cutoff) {
			task.progressHistory.shift();
		}

		const oldest = task.progressHistory[0];
		const newest = task.progressHistory[task.progressHistory.length - 1];
		const windowMs = newest.time - oldest.time;
		if (windowMs < 500) return '';

		const rate = (newest.completed - oldest.completed) / (windowMs / 1000);
		if (!isFinite(rate) || rate <= 0) return '';

		const remainingSeconds = (task.total - unitsDone) / rate;
		if (!isFinite(remainingSeconds) || remainingSeconds <= 0) return '';

		if (remainingSeconds < 60) {
			return ` - ${Math.round(remainingSeconds)}s remaining`;
		}
		const mins = Math.floor(remainingSeconds / 60);
		const secs = Math.round(remainingSeconds % 60);
		return ` - ${mins}m ${secs}s remaining`;
	}

	private applyProcessingTasks(result: { waveform_ids: string[]; conversion_ids: string[] }) {
		const allProcessingIds = [...result.waveform_ids, ...result.conversion_ids];
		if (allProcessingIds.length > 0) {
			allProcessingIds.forEach((id) => this.processingFiles.add(id));
			this.processingFiles = new Set(this.processingFiles);
		}

		if (result.conversion_ids.length > 0) {
			const task = this.tasks.find((t) => t.id === 'conversions');
			if (task) {
				task.total = (task.total || 0) + result.conversion_ids.length;
				task.status = 'running';
				this.syncBatchTask('conversions');
			} else {
				this.addTask({
					id: 'conversions',
					name: 'Converting unsupported formats to supported ones',
					progress: 0,
					status: 'running',
					total: result.conversion_ids.length,
					completed: 0,
					message: `Standardizing 0 / ${result.conversion_ids.length} files...`
				});
			}
		}

		const totalWaveformsNeeded = result.waveform_ids.length + result.conversion_ids.length;
		if (totalWaveformsNeeded > 0) {
			const task = this.tasks.find((t) => t.id === 'waveforms');
			if (task) {
				task.total = (task.total || 0) + totalWaveformsNeeded;
				task.status = 'running';
				if (!task.startTime) task.startTime = Date.now();
				this.syncBatchTask('waveforms');
			} else {
				this.addTask({
					id: 'waveforms',
					name: 'Generating Waveforms',
					progress: 0,
					status: 'running',
					total: totalWaveformsNeeded,
					completed: 0,
					startTime: Date.now(),
					message: `0 / ${totalWaveformsNeeded} waveforms`
				});
			}
		}
	}

	private handleCollectionResult(result: {
		files: Omit<FileItem, 'selected'>[];
		waveform_ids: string[];
		conversion_ids: string[];
	}) {
		this.files = result.files.map((f) => ({ ...f, selected: false }));
		this.knownVersion += 1; // Rust also bumped; bump ours to match the new list.
		this.invalidateDisplayedCache();
		this.applyProcessingTasks(result);
		this.notify();
	}

	private mergeAddedFiles(addedFiles: Omit<FileItem, 'selected'>[]) {
		const existingPaths = new Set(this.files.map((f) => f.filepath));
		const toAdd = addedFiles
			.filter((f) => !existingPaths.has(f.filepath))
			.map((f) => ({ ...f, selected: false }));

		if (toAdd.length === 0) return;

		this.files.push(...toAdd);
	}

	addTask(task: Task) {
		if (task.total !== undefined && task.completed === undefined) {
			task.completed = 0;
		}
		this.tasks.push(task);
		this.notify();
	}

	updateTask(id: string, updates: Partial<Task>) {
		const task = this.tasks.find((t) => t.id === id);
		if (task) {
			const statusChanged = updates.status && updates.status !== task.status;
			Object.assign(task, updates);
			if (task.id === 'waveforms' || task.id === 'conversions') {
				this.syncBatchTask(task.id);
			} else if (
				updates.progress === undefined &&
				task.total !== undefined &&
				task.completed !== undefined
			) {
				task.progress = this.batchTaskPercent(task);
			}
			if (statusChanged && (task.status === 'completed' || task.status === 'failed')) {
				setTimeout(() => this.removeTask(id), 5000);
			}
		}
		this.notify();
	}

	removeTask(id: string) {
		this.tasks = this.tasks.filter((t) => t.id !== id);
		this.notify();
	}

	isLocked(id: string) {
		return this.processingFiles.has(id);
	}

	private beginSwitchingUi(path: string) {
		this.endSwitchingUiTimer();
		this.switchingCollection = true;
		this.showSwitchingUi = false;
		this.switchingToPath = path;
		this.switchingUiTimer = setTimeout(() => {
			if (!this.switchingCollection) return;
			this.showSwitchingUi = true;
			this.files = [];
			this.notify();
		}, SWITCH_UI_DELAY_MS);
	}

	private endSwitchingUiTimer() {
		if (this.switchingUiTimer) {
			clearTimeout(this.switchingUiTimer);
			this.switchingUiTimer = null;
		}
	}

	private endSwitchingUi() {
		this.endSwitchingUiTimer();
		this.switchingCollection = false;
		this.showSwitchingUi = false;
		this.switchingToPath = null;
		this.notify();
	}

	async openCollectionByPath(path: string, options?: { force?: boolean }) {
		if (this.switchingCollection) {
			if (!options?.force) return;
			this.endSwitchingUi();
		}
		if (
			!options?.force &&
			collectionPathsEqual(this.collectionPath, path) &&
			this.files.length > 0
		) {
			return;
		}

		const previousPath = this.collectionPath;
		settingsStore.stashCollectionUi(previousPath);

		try {
			audioPlayer.stop();
			this.beginSwitchingUi(path);
			this.loading = true;
			this.collectionPath = path;
			this.knownVersion = 0;
			this.processingFiles = new Set();
			this.tasks = [];
			this.processingPaused = false;
			this.currentlyProcessingIds = new Set();
			this.waveformProgress = {};
			this.partialWaveforms = {};
			const result = await invoke<{
				files: Omit<FileItem, 'selected'>[];
				waveform_ids: string[];
				conversion_ids: string[];
			}>('switch_collection', { path });

			this.handleCollectionResult(result);
			settingsStore.applyCollectionUi(path);
			localStorage.setItem('lastCollectionPath', path);
			settingsStore.addRecentCollection(path);
		} catch (e) {
			console.error('Failed to open collection', e);
			if (previousPath && !collectionPathsEqual(previousPath, path)) {
				this.collectionPath = previousPath;
				try {
					await this.reloadFiles();
					settingsStore.applyCollectionUi(previousPath);
				} catch {
					this.collectionPath = null;
					this.files = [];
					localStorage.removeItem('lastCollectionPath');
				}
			} else {
				this.collectionPath = null;
				this.files = [];
				localStorage.removeItem('lastCollectionPath');
			}
		} finally {
			this.endSwitchingUi();
			this.loading = false;
			this.notify();
		}
	}

	async openCollection() {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				title: 'Select Collection Folder'
			});

			if (selected) {
				await this.openCollectionByPath(selected as string, { force: true });
			}
		} catch (e) {
			console.error('Failed to open collection', e);
		}
	}

	async reloadFiles() {
		if (!this.collectionPath) return;
		const selectedIds = new Set(this.files.filter((f) => f.selected).map((f) => f.id));
		const snapshot = await invoke<CollectionSnapshot>('get_collection_files');
		this.knownVersion = snapshot.version;
		this.invalidateDisplayedCache();
		this.files = snapshot.files.map((f) => ({ ...f, selected: selectedIds.has(f.id) }));
		this.notify();
	}

	async refresh() {
		if (!this.collectionPath) return;
		try {
			this.loading = true;
			const selectedIds = new Set(this.files.filter((f) => f.selected).map((f) => f.id));
			const result = await invoke<{
				files: Omit<FileItem, 'selected'>[];
				waveform_ids: string[];
				conversion_ids: string[];
			}>('rescan_collection');
			this.handleCollectionResult(result);
			for (const file of this.files) {
				file.selected = selectedIds.has(file.id);
			}
		} catch (e) {
			console.error('Failed to refresh collection', e);
		} finally {
			this.loading = false;
			this.notify();
		}
	}

	async addFiles(filePaths: string[], action: 'copy' | 'move', normalize: boolean = true) {
		if (!this.collectionPath) return;
		const taskId = Math.random().toString(36).substring(7);
		this.addTask({
			id: taskId,
			name: `${action === 'copy' ? 'Copying' : 'Moving'} ${filePaths.length} files`,
			progress: 0,
			status: 'running'
		});

		try {
			const result = await invoke<{
				files: Omit<FileItem, 'selected'>[];
				waveform_ids: string[];
				conversion_ids: string[];
			}>('add_files_to_collection', {
				files: filePaths,
				action,
				normalize
			});
			this.applyProcessingTasks(result);
			this.mergeAddedFiles(result.files);
			this.updateTask(taskId, { progress: 100, status: 'completed' });
		} catch (e) {
			console.error('Failed to add files', e);
			this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
		} finally {
			requestAnimationFrame(() => this.notify());
		}
	}

	async relocateFile(id: string) {
		if (this.isLocked(id)) return;
		try {
			const selected = await open({
				multiple: false,
				title: 'Locate Missing File',
				filters: [
					{
						name: 'Audio',
						extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a']
					}
				]
			});

			if (selected && typeof selected === 'string') {
				if (this.collectionPath && selected.startsWith(this.collectionPath)) {
					// Already in collection folder, just link it
					const taskId = Math.random().toString(36).substring(7);
					this.addTask({
						id: taskId,
						name: `Linking file`,
						progress: 0,
						status: 'running'
					});

					this.loading = true;
					const patch = await invoke<CollectionPatch>('relocate_file', {
						id,
						newPath: selected,
						action: 'link'
					});
					this.applyPatch(patch);
					this.updateTask(taskId, { progress: 100, status: 'completed' });
				} else {
					const action = await promptCopyOrMove('relocate');
					if (action) {
						await this.relocateFileWithAction(id, selected, action);
					}
				}
			}
		} catch (e) {
			console.error('Failed to relocate file', e);
		} finally {
			this.loading = false;
			this.notify();
		}
	}

	private async relocateFileWithAction(id: string, path: string, action: 'copy' | 'move') {
		const taskId = Math.random().toString(36).substring(7);
		this.addTask({
			id: taskId,
			name: `${action === 'copy' ? 'Copying' : 'Moving'} relocated file`,
			progress: 0,
			status: 'running'
		});

		try {
			this.loading = true;
			const patch = await invoke<CollectionPatch>('relocate_file', {
				id,
				newPath: path,
				action
			});
			this.applyPatch(patch);
			this.updateTask(taskId, { progress: 100, status: 'completed' });
		} catch (e) {
			console.error('Failed to complete relocation', e);
			this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
		} finally {
			this.loading = false;
			this.notify();
		}
	}

	async removeFromCollectionOnly(id: string) {
		if (this.isLocked(id)) return;
		const file = this.files.find((f) => f.id === id);
		const taskId = Math.random().toString(36).substring(7);
		this.addTask({
			id: taskId,
			name: `Removing ${file?.filename} from collection`,
			progress: 0,
			status: 'running'
		});

		try {
			this.loading = true;
			const patch = await invoke<CollectionPatch>('remove_file_from_collection', { id });
			this.applyPatch(patch);
			this.updateTask(taskId, { progress: 100, status: 'completed' });
		} catch (e) {
			console.error('Failed to remove file from collection', e);
			this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
		} finally {
			this.loading = false;
			this.notify();
		}
	}

	async removeFileFromDisk(id: string) {
		if (this.isLocked(id)) return;
		const file = this.files.find((f) => f.id === id);
		if (!file || !this.collectionPath) {
			console.error('removeFileFromDisk: File or collectionPath missing', {
				file,
				path: this.collectionPath
			});
			return;
		}

		const taskId = Math.random().toString(36).substring(7);
		this.addTask({
			id: taskId,
			name: `Deleting ${file.filename} from disk`,
			progress: 0,
			status: 'running'
		});

		try {
			this.loading = true;
			// 1. Delete from disk
			const fullPath = `${this.collectionPath}/${file.filepath}`.replace(/[/\\]+/g, '/');
			console.log('Attempting to delete file:', fullPath);

			try {
				await remove(fullPath);
			} catch (fsErr) {
				console.warn(
					'File system removal failed, but proceeding to remove from collection:',
					fsErr
				);
			}

			// 2. Remove from collection (database/UI state)
			const patch = await invoke<CollectionPatch>('remove_file_from_collection', { id });
			this.applyPatch(patch);
			this.updateTask(taskId, { progress: 100, status: 'completed' });
		} catch (e) {
			console.error('Failed to delete file from disk', e);
			this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
		} finally {
			this.loading = false;
			this.notify();
		}
	}

	async removeFile(id: string) {
		const file = this.files.find((f) => f.id === id);
		const confirmed = await confirmDialog(`Remove "${file?.filename}" from the collection?`, {
			title: 'Remove File',
			kind: 'warning',
			okLabel: 'Remove',
			cancelLabel: 'Cancel'
		});
		if (!confirmed) return;

		await this.removeFromCollectionOnly(id);
	}

	async regenerateWaveforms() {
		if (!this.collectionPath) return;
		try {
			// Remove existing task if any
			this.removeTask('waveforms');

			// Clear current processing states
			this.currentlyProcessingIds = new Set();
			this.processingFiles = new Set();
			this.waveformProgress = {};

			const missingWaveforms = await invoke<string[]>('regenerate_waveforms', {
				normalize: settingsStore.normalizeOnImport
			});

			if (missingWaveforms.length > 0) {
				this.processingFiles = new Set(missingWaveforms);

				this.addTask({
					id: 'waveforms',
					name: 'Generating Waveforms',
					progress: 0,
					status: 'running',
					total: missingWaveforms.length,
					completed: 0,
					startTime: Date.now(),
					message: `0 / ${missingWaveforms.length} waveforms`
				});
			}
		} catch (e) {
			console.error('Failed to regenerate waveforms', e);
		} finally {
			this.notify();
		}
	}

	async pauseProcessing() {
		try {
			await invoke('pause_processing');
			this.processingPaused = true;
			const now = Date.now();
			this.tasks.forEach((t) => {
				if (t.status === 'running' || t.status === 'pending') {
					t.status = 'paused';
					t.pauseStartTime = now;
				}
			});
		} catch (e) {
			console.error('Failed to pause processing', e);
		} finally {
			this.notify();
		}
	}

	async resumeProcessing() {
		try {
			await invoke('resume_processing');
			this.processingPaused = false;
			const now = Date.now();
			this.tasks.forEach((t) => {
				if (t.status === 'paused') {
					t.status = 'running';
					if (t.pauseStartTime) {
						t.pausedDuration = (t.pausedDuration ?? 0) + (now - t.pauseStartTime);
						t.pauseStartTime = undefined;
					}
					t.progressHistory = undefined;
				}
			});
		} catch (e) {
			console.error('Failed to resume processing', e);
		} finally {
			this.notify();
		}
	}

	async updateTags(id: string, tags: string[]) {
		if (this.isLocked(id)) return;
		try {
			const patch = await invoke<CollectionPatch>('update_file_tags', { id, tags });
			this.applyPatch(patch);
			this.notify();
		} catch (e) {
			console.error('Failed to update tags', e);
			throw e;
		}
	}

	async batchAddTag(ids: string[], tag: string) {
		const trimmed = tag.trim();
		if (!trimmed) return;
		const applicableIds: string[] = [];
		for (const id of ids) {
			const file = this.files.find((f) => f.id === id);
			if (!file || file.missing || this.isLocked(id)) continue;
			if (!file.tags.includes(trimmed)) {
				applicableIds.push(id);
			}
		}
		if (applicableIds.length === 0) return;
		try {
			const patch = await invoke<CollectionPatch>('update_files_tags', {
				ids: applicableIds,
				tag: trimmed,
				add: true
			});
			this.applyPatch(patch);
			this.notify();
		} catch (e) {
			console.error('Failed to batch-add tag', e);
		}
	}

	async batchRemoveTag(ids: string[], tag: string) {
		const applicableIds: string[] = [];
		for (const id of ids) {
			const file = this.files.find((f) => f.id === id);
			if (!file || file.missing || this.isLocked(id)) continue;
			if (file.tags.includes(tag)) {
				applicableIds.push(id);
			}
		}
		if (applicableIds.length === 0) return;
		try {
			const patch = await invoke<CollectionPatch>('update_files_tags', {
				ids: applicableIds,
				tag,
				add: false
			});
			this.applyPatch(patch);
			this.notify();
		} catch (e) {
			console.error('Failed to batch-remove tag', e);
		}
	}
}

export const collectionStore = new CollectionStore();
