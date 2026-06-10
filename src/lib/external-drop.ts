import { collectionStore } from './collection-store';
import { promptCopyOrMove } from './native-dialog';
import { settingsStore } from './settings-store';

export function normalizePath(path: string): string {
	return path.replace(/[/\\]+/g, '/');
}

let handlingExternalDrop = false;

/** Prompt for copy/move and import paths dropped from outside the collection. */
export async function handleExternalFileDrop(paths: string[]) {
	if (handlingExternalDrop || !collectionStore.collectionPath) return;

	const filteredPaths = filterExternalDropPaths(paths, collectionStore.collectionPath);
	if (filteredPaths.length === 0) return;

	handlingExternalDrop = true;
	try {
		// Native dialogs fail if opened synchronously inside the drag-drop callback.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const action = await promptCopyOrMove('drop');
		if (!action) return;

		await collectionStore.addFiles(filteredPaths, action, settingsStore.normalizeOnImport);
	} finally {
		handlingExternalDrop = false;
	}
}

export function filterExternalDropPaths(paths: string[], collectionPath: string): string[] {
	const collection = normalizePath(collectionPath);
	const collectionPrefix = collection.endsWith('/') ? collection : `${collection}/`;

	return paths.filter((path) => {
		const normalizedPath = normalizePath(path);
		if (normalizedPath === collection) return false;
		if (normalizedPath.startsWith(collectionPrefix)) return false;
		return true;
	});
}

export function isPhysicalPointInElement(
	el: HTMLElement,
	physicalX: number,
	physicalY: number
): boolean {
	const scale = window.devicePixelRatio || 1;
	const x = physicalX / scale;
	const y = physicalY / scale;
	const rect = el.getBoundingClientRect();
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
