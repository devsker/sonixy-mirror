import { confirm, message } from '@tauri-apps/plugin-dialog';

const COPY = 'Copy';
const MOVE = 'Move';
const CANCEL = 'Cancel';
const REMOVE_FROM_COLLECTION = 'Remove from Collection';
const REMOVE_FROM_DISK = 'Remove from Disk';

export async function promptCopyOrMove(
	context: 'drop' | 'relocate'
): Promise<'copy' | 'move' | null> {
	const body =
		context === 'drop'
			? 'How would you like to add these files to your collection?\n\n' +
				'Copy — original files stay where they are.\n' +
				'Move — original files are moved to the collection.'
			: 'The selected file is outside the collection.\n\n' +
				'Copy it into the collection, or move it?';

	const result = await message(body, {
		title: context === 'drop' ? 'Add Files to Collection' : 'Relocate File',
		kind: 'info',
		buttons: { yes: COPY, no: MOVE, cancel: CANCEL }
	});

	if (result === COPY) return 'copy';
	if (result === MOVE) return 'move';
	return null;
}

export async function promptRemoveFile(
	filename: string
): Promise<'collection' | 'disk' | null> {
	const result = await message(
		`How would you like to remove "${filename}"?\n\n"Remove from Disk" permanently deletes the file.`,
		{
			title: 'Remove File',
			kind: 'warning',
			buttons: {
				yes: REMOVE_FROM_COLLECTION,
				no: REMOVE_FROM_DISK,
				cancel: CANCEL
			}
		}
	);

	if (result === REMOVE_FROM_COLLECTION) return 'collection';
	if (result === REMOVE_FROM_DISK) return 'disk';
	return null;
}

export async function promptTagName(title: string): Promise<string | null> {
	const value = window.prompt(title);
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed || null;
}

export async function promptPickTag(tags: string[], fileCount: number): Promise<string | null> {
	if (tags.length === 0) return null;

	if (tags.length === 1) {
		const confirmed = await confirm(`Remove tag "${tags[0]}" from ${fileCount} files?`, {
			title: 'Remove Tag',
			kind: 'warning',
			okLabel: 'Remove',
			cancelLabel: 'Cancel'
		});
		return confirmed ? tags[0] : null;
	}

	const lines = tags.map((tag, index) => `${index + 1}. ${tag}`).join('\n');
	const value = window.prompt(
		`Remove which tag from ${fileCount} files?\n\n${lines}\n\nEnter the tag name:`,
		tags[0]
	);
	if (value === null) return null;
	const trimmed = value.trim();
	return tags.includes(trimmed) ? trimmed : null;
}
