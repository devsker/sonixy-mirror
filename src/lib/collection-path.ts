export function normalizeCollectionPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function collectionPathsEqual(
	a: string | null | undefined,
	b: string | null | undefined
): boolean {
	if (!a || !b) return false;
	return normalizeCollectionPath(a) === normalizeCollectionPath(b);
}

export function collectionDisplayName(path: string | null | undefined): string {
	if (!path) return '';
	const normalized = normalizeCollectionPath(path);
	const parts = normalized.split('/');
	return parts[parts.length - 1] || normalized;
}
