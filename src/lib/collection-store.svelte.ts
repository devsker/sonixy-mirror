import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface FileItem {
    id: string;
    filename: string;
    filepath: string;
    format: string;
    length: string;
    size: string;
    tags: string[];
    selected: boolean;
    missing: boolean;
}

class CollectionStore {
    files = $state<FileItem[]>([]);
    collectionPath = $state<string | null>(null);
    loading = $state(false);
    pendingRelocate = $state<{id: string, path: string} | null>(null);

    constructor() {
        // Automatically open last collection if it exists
        if (typeof window !== 'undefined') {
            const lastPath = localStorage.getItem('lastCollectionPath');
            if (lastPath) {
                this.openCollectionByPath(lastPath);
            }
        }
    }

    async openCollectionByPath(path: string) {
        try {
            this.loading = true;
            this.collectionPath = path;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('open_collection', { path });
            this.files = result.map(f => ({ ...f, selected: false }));
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

    async addFiles(filePaths: string[], action: 'copy' | 'move') {
        if (!this.collectionPath) return;
        try {
            this.loading = true;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('add_files_to_collection', { files: filePaths, action });
            this.files = result.map(f => ({ ...f, selected: false }));
        } catch (e) {
            console.error('Failed to add files', e);
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
                    this.loading = true;
                    const result = await invoke<Omit<FileItem, 'selected'>[]>('relocate_file', { 
                        id, 
                        newPath: selected,
                        action: 'link'
                    });
                    this.files = result.map(f => ({ ...f, selected: false }));
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
        try {
            this.loading = true;
            const { id, path } = this.pendingRelocate;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('relocate_file', { id, newPath: path, action });
            this.files = result.map(f => ({ ...f, selected: false }));
            this.pendingRelocate = null;
        } catch (e) {
            console.error('Failed to complete relocation', e);
        } finally {
            this.loading = false;
        }
    }

    async removeFile(id: string) {
        if (!confirm('Are you sure you want to remove this file from the collection?')) return;
        try {
            this.loading = true;
            const result = await invoke<Omit<FileItem, 'selected'>[]>('remove_file_from_collection', { id });
            this.files = result.map(f => ({ ...f, selected: false }));
        } catch (e) {
            console.error('Failed to remove file', e);
        } finally {
            this.loading = false;
        }
    }
}

export const collectionStore = new CollectionStore();
