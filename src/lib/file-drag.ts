import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { resolveResource } from '@tauri-apps/api/path';
import { collectionStore } from '$lib/collection-store.svelte';

let dragIconPath: string | null = null;

async function getDragIcon(): Promise<string> {
	if (!dragIconPath) {
		dragIconPath = await resolveResource('icons/32x32.png');
	}
	return dragIconPath;
}

/** Start an OS-level drag of one or more absolute file paths. */
export async function startExternalFileDrag(paths: string[]): Promise<void> {
	if (paths.length === 0) return;

	const icon = await getDragIcon();
	collectionStore.isDraggingFromApp = true;
	try {
		await startDrag({ item: paths, icon });
	} finally {
		collectionStore.isDraggingFromApp = false;
	}
}
