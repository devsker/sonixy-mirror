import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { remove } from '@tauri-apps/plugin-fs';
import { audioPlayer } from './audio-player.svelte';

export interface FileItem {
    id: string;
    filename: string;
    filepath: string;
    format: string;
    length: string;
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
    status: 'pending' | 'running' | 'completed' | 'failed';
    message?: string;
    total?: number;
    completed?: number;
}

class CollectionStore {
    files = $state<FileItem[]>([]);
    collectionPath = $state<string | null>(null);
    loading = $state(false);
    pendingRelocate = $state<{id: string, path: string} | null>(null);
    tasks = $state<Task[]>([]);
    processingFiles = $state<Set<string>>(new Set());
    currentlyProcessingIds = $state<Set<string>>(new Set());

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
                this.currentlyProcessingIds.add(id);
                this.currentlyProcessingIds = new Set(this.currentlyProcessingIds);
            });

            // Listen for waveform generation
            listen('waveform-generated', (event) => {
                const payload = event.payload as { id: string, gain: number };
                const id = payload.id;
                const gain = payload.gain;
                
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
                    task.progress = (task.completed / task.total) * 100;
                    task.message = `${task.completed} / ${task.total} waveforms`;
                    if (task.completed >= task.total) {
                        this.updateTask(task.id, { status: 'completed' });
                    }
                }
            });
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
            if (task.total !== undefined && task.completed !== undefined) {
                task.progress = (task.completed / task.total) * 100;
            }
            if ((statusChanged || updates.status) && (task.status === 'completed' || task.status === 'failed')) {
                setTimeout(() => this.removeTask(id), 5000);
            }
        }
    }

    removeTask(id: string) {
        this.tasks = this.tasks.filter(t => t.id !== id);
    }

    async function openCollectionByPath(path: string) {
        try {
            audioPlayer.stop();
            this.loading = true;
            this.collectionPath = path;
            this.processingFiles = new Set();
            const [files, missingWaveforms] = await invoke<[Omit<FileItem, 'selected'>[], string[]]>('open_collection', { path });
            this.files = files.map(f => ({ ...f, selected: false }));
            localStorage.setItem('lastCollectionPath', path);
            
            if (missingWaveforms.length > 0) {
                missingWaveforms.forEach(id => this.processingFiles.add(id));
                this.processingFiles = new Set(this.processingFiles);

                this.addTask({
                    id: 'waveforms',
                    name: 'Generating Waveforms',
                    progress: 0,
                    status: 'running',
                    total: missingWaveforms.length,
                    completed: 0,
                    message: `0 / ${missingWaveforms.length} waveforms`
                });
            }
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
            const [files, missingWaveforms] = await invoke<[Omit<FileItem, 'selected'>[], string[]]>('add_files_to_collection', { 
                files: filePaths, 
                action,
                normalize
            });
            this.files = files.map(f => ({ ...f, selected: false }));
            this.updateTask(taskId, { progress: 100, status: 'completed' });

            if (missingWaveforms.length > 0) {
                missingWaveforms.forEach(id => this.processingFiles.add(id));
                this.processingFiles = new Set(this.processingFiles);

                let task = this.tasks.find(t => t.id === 'waveforms');
                if (task) {
                    task.total = (task.total || 0) + missingWaveforms.length;
                    task.completed = (task.completed || 0);
                    task.status = 'running';
                    task.message = `${task.completed} / ${task.total} waveforms`;
                    task.progress = (task.completed / task.total) * 100;
                } else {
                    this.addTask({
                        id: 'waveforms',
                        name: 'Generating Waveforms',
                        progress: 0,
                        status: 'running',
                        total: missingWaveforms.length,
                        completed: 0,
                        message: `0 / ${missingWaveforms.length} waveforms`
                    });
                }
            }
        } catch (e) {
            console.error('Failed to add files', e);
            this.updateTask(taskId, { status: 'failed', message: (e as Error).message });
        } finally {
            this.loading = false;
        }
    }

    async relocateFile(id: string) {
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
            
            const missingWaveforms = await invoke<string[]>('regenerate_waveforms');
            
            if (missingWaveforms.length > 0) {
                this.processingFiles = new Set(missingWaveforms);
                
                this.addTask({
                    id: 'waveforms',
                    name: 'Generating Waveforms',
                    progress: 0,
                    status: 'running',
                    total: missingWaveforms.length,
                    completed: 0,
                    message: `0 / ${missingWaveforms.length} waveforms`
                });
            }
        } catch (e) {
            console.error('Failed to regenerate waveforms', e);
        }
    }
}

export const collectionStore = new CollectionStore();
