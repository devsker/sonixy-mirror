export function normalizePath(path: string): string {
	return path.replace(/[/\\]+/g, '/');
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
