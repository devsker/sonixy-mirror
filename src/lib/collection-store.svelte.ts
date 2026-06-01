import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { remove } from '@tauri-apps/plugin-fs';
import { audioPlayer } from './audio-player.svelte';
import { settingsStore } from './settings-store.svelte';

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

class CollectionStore {
    files = $state<FileItem[]>([]);
    collectionPath = $state<string | null>(null);
    loading = $state(false);
    pendingRelocate = $state<{id: string, path: string} | null>(null);
    tasks = $state<Task[]>([]);
    processingPaused = $state(false);
    processingFiles = $state<Set<string>>(new Set());
    currentlyProcessingIds = $state<Set<string>>(new Set());
    waveformProgress = $state<Record<string, number>>({});
    partialWaveforms = $state<Record<string, number[]>>({});
    isDraggingFromApp = $state(false);

    // Filter & Sort State
    sortColumn = $state<string | null>(null);
    sortDirection = $state<'asc' | 'desc'>('asc');
    selectedFormats = $state<string[]>([]);
    selectedTags = $state<string[]>([]);

    displayedFiles = $derived.by(() => {
        let result = [...this.files];

        // Apply Filters
        if (this.selectedFormats.length > 0) {
            result = result.filter((f) => this.selectedFormats.includes(f.format));
        }
        if (this.selectedTags.length > 0) {
            result = result.filter((f) => f.tags.some((t) => this.selectedTags.includes(t)));
        }

        // Apply Sorting
        const col = this.sortColumn;
        const dir = this.sortDirection;

        if (col) {
            result.sort((a, b) => {
                let compareA: string | number;
                let compareB: string | number;

                if (col === 'length') {
                    compareA = a.duration;
                    compareB = b.duration;
                } else if (col === 'size') {
                    compareA = this.parseSize(a.size);
                    compareB = this.parseSize(b.size);
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

        return result;
    });

    private parseDuration(d: string) {
        const parts = d.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return parts[0];
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
            });

            // Listen for waveform progress
            // partialWaveforms is throttled to 50ms per file to limit SVG path rebuilds.
            const lastPartialWrite: Record<string, number> = {};
            listen('waveform-progress', (event) => {
                const payload = event.payload as { id: string, progress: number, data?: number[] };
                this.waveformProgress[payload.id] = payload.progress;
                if (payload.data) {
                    const now = Date.now();
                    if ((now - (lastPartialWrite[payload.id] ?? 0)) >= 50) {
                        this.partialWaveforms[payload.id] = payload.data;
                        lastPartialWrite[payload.id] = now;
                    }
                }

            });

            // Listen for waveform generation
            listen('waveform-generated', (event) => {
                const payload = event.payload as { id: string, gain: number };
                const id = payload.id;
                const gain = payload.gain;
                
                if (id.endsWith('-converting')) {
                    const task = this.tasks.find(t => t.id === 'conversions');
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

                    // Refresh file list to see the new MP3
                    this.refresh();
                } else {
                    // Update file gain in store
                    const file = this.files.find(f => f.id === id);
                    if (file) {
                        file.gain = gain;
                    }

                    this.processingFiles.delete(id);
                    this.processingFiles = new Set(this.processingFiles); // Trigger reactivity

                    this.currentlyProcessingIds.delete(id);
                    this.currentlyProcessingIds = new Set(this.currentlyProcessingIds);

                    const task = this.tasks.find(t => t.id === 'waveforms');
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
            });
        }
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

        const etaMessage =
            task.status !== 'paused' ? this.computeEtaMessage(task) : '';
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

    private handleCollectionResult(result: { files: Omit<FileItem, 'selected'>[], waveform_ids: string[], conversion_ids: string[] }) {
        this.files = result.files.map(f => ({ ...f, selected: false }));
        
        // All these IDs will eventually need a waveform
        const allProcessingIds = [...result.waveform_ids, ...result.conversion_ids];
        if (allProcessingIds.length > 0) {
            allProcessingIds.forEach(id => this.processingFiles.add(id));
            this.processingFiles = new Set(this.processingFiles);
        }

        if (result.conversion_ids.length > 0) {
            let task = this.tasks.find(t => t.id === 'conversions');
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
            let task = this.tasks.find(t => t.id === 'waveforms');
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

    addTask(task: Task) {
        if (task.total !== undefined && task.completed === undefined) {
            task.completed = 0;
        }
        this.tasks.push(task);
    }

    updateTask(id: string, updates: Partial<Task>) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            const statusChanged = updates.status && updates.status !== task.status;
            Object.assign(task, updates);
            if (task.id === 'waveforms' || task.id === 'conversions') {
                this.syncBatchTask(task.id);
            } else if (updates.progress === undefined && task.total !== undefined && task.completed !== undefined) {
                task.progress = this.batchTaskPercent(task);
            }
            if (statusChanged && (task.status === 'completed' || task.status === 'failed')) {
                setTimeout(() => this.removeTask(id), 5000);
            }
        }
    }

    removeTask(id: string) {
        this.tasks = this.tasks.filter(t => t.id !== id);
    }

    isLocked(id: string) {
        return this.processingFiles.has(id);
    }

    async openCollectionByPath(path: string) {
        try {
            audioPlayer.stop();
            this.loading = true;
            this.collectionPath = path;
            this.processingFiles = new Set();
            this.tasks = [];
            this.processingPaused = false;
            this.currentlyProcessingIds = new Set();
            this.waveformProgress = {};
            this.partialWaveforms = {};
            const result = await invoke<{ files: Omit<FileItem, 'selected'>[], waveform_ids: string[], conversion_ids: string[] }>('open_collection', { path });
            this.handleCollectionResult(result);
            localStorage.setItem('lastCollectionPath', path);
        } catch (e) {
            console.error('Failed to auto-open collection', e);
            this.collectionPath = null;
            localStorage.removeItem('lastCollectionPath');
        } finally {
            this.loading = false;
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
                await this.openCollectionByPath(selected as string);
            }
        } catch (e) {
            console.error('Failed to open collection', e);
        }
    }

    async refresh() {
        if (!this.collectionPath) return;
        try {
            this.loading = true;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('get_collection_files');
            this.files = result.map(f => ({ ...f, selected: false }));
        } catch (e) {
            console.error('Failed to refresh collection', e);
        } finally {
            this.loading = false;
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
            this.loading = true;
            const result = await invoke<{ files: Omit<FileItem, 'selected'>[], waveform_ids: string[], conversion_ids: string[] }>('add_files_to_collection', { 
                files: filePaths, 
                action,
                normalize
            });
            this.handleCollectionResult(result);
            this.updateTask(taskId, { progress: 100, status: 'completed' });
        } catch (e) {
            console.error('Failed to add files', e);
            this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
        } finally {
            this.loading = false;
        }
    }

    async relocateFile(id: string) {
        if (this.isLocked(id)) return;
        try {
            const selected = await open({
                multiple: false,
                title: 'Locate Missing File',
                filters: [{
                    name: 'Audio',
                    extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a']
                }]
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
                    const result = await invoke<Omit<FileItem, 'selected'>[]>('relocate_file', { 
                        id, 
                        newPath: selected,
                        action: 'link'
                    });
                    this.files = result.map(f => ({ ...f, selected: false }));
                    this.updateTask(taskId, { progress: 100, status: 'completed' });
                } else {
                    // Outside collection, ask user to copy or move
                    this.pendingRelocate = { id, path: selected };
                }
            }
        } catch (e) {
            console.error('Failed to relocate file', e);
        } finally {
            this.loading = false;
        }
    }

    async confirmRelocate(action: 'copy' | 'move') {
        if (!this.pendingRelocate) return;
        const taskId = Math.random().toString(36).substring(7);
        this.addTask({
            id: taskId,
            name: `${action === 'copy' ? 'Copying' : 'Moving'} relocated file`,
            progress: 0,
            status: 'running'
        });

        try {
            this.loading = true;
            const { id, path } = this.pendingRelocate;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('relocate_file', { id, newPath: path, action });
            this.files = result.map(f => ({ ...f, selected: false }));
            this.pendingRelocate = null;
            this.updateTask(taskId, { progress: 100, status: 'completed' });
        } catch (e) {
            console.error('Failed to complete relocation', e);
            this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
        } finally {
            this.loading = false;
        }
    }

    async removeFromCollectionOnly(id: string) {
        if (this.isLocked(id)) return;
        const file = this.files.find(f => f.id === id);
        const taskId = Math.random().toString(36).substring(7);
        this.addTask({
            id: taskId,
            name: `Removing ${file?.filename} from collection`,
            progress: 0,
            status: 'running'
        });

        try {
            this.loading = true;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('remove_file_from_collection', { id });
            this.files = result.map(f => ({ ...f, selected: false }));
            this.updateTask(taskId, { progress: 100, status: 'completed' });
        } catch (e) {
            console.error('Failed to remove file from collection', e);
            this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
        } finally {
            this.loading = false;
        }
    }

    async removeFileFromDisk(id: string) {
        if (this.isLocked(id)) return;
        const file = this.files.find(f => f.id === id);
        if (!file || !this.collectionPath) {
            console.error('removeFileFromDisk: File or collectionPath missing', { file, path: this.collectionPath });
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
            const fullPath = `${this.collectionPath}/${file.filepath}`.replace(/[\\\/]+/g, '/');
            console.log('Attempting to delete file:', fullPath);
            
            try {
                await remove(fullPath);
            } catch (fsErr) {
                console.warn('File system removal failed, but proceeding to remove from collection:', fsErr);
            }

            // 2. Remove from collection (database/UI state)
            const result = await invoke<Omit<FileItem, 'selected'>[]>('remove_file_from_collection', { id });
            this.files = result.map(f => ({ ...f, selected: false }));
            this.updateTask(taskId, { progress: 100, status: 'completed' });
        } catch (e) {
            console.error('Failed to delete file from disk', e);
            this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
        } finally {
            this.loading = false;
        }
    }

    async removeFile(id: string) {
        const file = this.files.find(f => f.id === id);
        if (!confirm(`Are you sure you want to remove "${file?.filename}" from the collection?`)) return;
        
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
        }
    }

    async pauseProcessing() {
        try {
            await invoke('pause_processing');
            this.processingPaused = true;
            const now = Date.now();
            this.tasks.forEach(t => {
                if (t.status === 'running' || t.status === 'pending') {
                    t.status = 'paused';
                    t.pauseStartTime = now;
                }
            });
        } catch (e) {
            console.error('Failed to pause processing', e);
        }
    }

    async resumeProcessing() {
        try {
            await invoke('resume_processing');
            this.processingPaused = false;
            const now = Date.now();
            this.tasks.forEach(t => {
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
        }
    }

    async updateTags(id: string, tags: string[]) {
        if (this.isLocked(id)) return;
        try {
            const updatedItem = await invoke<Omit<FileItem, 'selected'>>('update_file_tags', { id, tags });
            const index = this.files.findIndex(f => f.id === id);
            if (index !== -1) {
                // Keep the selection state
                const selected = this.files[index].selected;
                this.files[index] = { ...updatedItem, selected };
            }
        } catch (e) {
            console.error('Failed to update tags', e);
            throw e;
        }
    }
}

export const collectionStore = new CollectionStore();
