import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { join, resolveResource, resourceDir } from '@tauri-apps/api/path';
import { collectionStore } from '$lib/collection-store.svelte';

const DRAG_THRESHOLD_PX = 5;

let dragIconPath: string | null = null;
let dragIconPromise: Promise<string> | null = null;

async function resolveDragIconPath(): Promise<string> {
	try {
		return await resolveResource('icons/32x32.png');
	} catch {
		return join(await resourceDir(), 'icons/32x32.png');
	}
}

/** Warm up the drag preview icon so drags do not await path resolution. */
export function preloadDragIcon(): void {
	if (dragIconPath || dragIconPromise) return;
	dragIconPromise = resolveDragIconPath().then((path) => {
		dragIconPath = path;
		return path;
	});
}

async function getDragIcon(): Promise<string> {
	if (dragIconPath) return dragIconPath;
	preloadDragIcon();
	return dragIconPromise!;
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

export type ExternalFileDragOptions = {
	getPaths: () => string[];
	disabled?: () => boolean;
};

/**
 * Pointer-driven file drag (no HTML5 draggable). Required on macOS/Tauri: HTML
 * draggable starts a WebKit session on WryWebViewParent that returns NULL and
 * crashes when combined with tauri-plugin-drag.
 */
export function externalFileDrag(
	node: Element,
	options: ExternalFileDragOptions
): { destroy: () => void; update: (options: ExternalFileDragOptions) => void } {
	let config = options;
	let pointerDown = false;
	let dragStarted = false;
	let startX = 0;
	let startY = 0;

	const onMouseDown = (e: MouseEvent) => {
		if (e.button !== 0 || config.disabled?.()) return;
		pointerDown = true;
		dragStarted = false;
		startX = e.clientX;
		startY = e.clientY;
	};

	const onMouseMove = (e: MouseEvent) => {
		if (!pointerDown || dragStarted) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

		dragStarted = true;
		pointerDown = false;
		const paths = config.getPaths();
		if (paths.length > 0) {
			void startExternalFileDrag(paths).catch((err) => {
				console.error('Failed to start file drag:', err);
			});
		}
	};

	const endPointer = () => {
		pointerDown = false;
	};

	node.addEventListener('mousedown', onMouseDown);
	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', endPointer);

	return {
		update(next) {
			config = next;
		},
		destroy() {
			node.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', endPointer);
		}
	};
}
