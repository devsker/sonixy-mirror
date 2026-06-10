export type ShortcutAction =
	| 'togglePlay'
	| 'selectionIn'
	| 'selectionOut'
	| 'clearSelection'
	| 'previousFile'
	| 'nextFile'
	| 'slower'
	| 'faster'
	| 'toggleMute'
	| 'stop';

export type KeyboardShortcuts = Record<ShortcutAction, string[]>;

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
	togglePlay: ['Space', 'KeyK'],
	selectionIn: ['KeyI'],
	selectionOut: ['KeyO'],
	clearSelection: ['KeyX'],
	previousFile: ['ArrowLeft'],
	nextFile: ['ArrowRight'],
	slower: ['KeyJ'],
	faster: ['KeyL'],
	toggleMute: ['KeyM'],
	stop: ['Escape']
};

export const SHORTCUT_GROUPS: {
	title: string;
	actions: { id: ShortcutAction; label: string }[];
}[] = [
	{
		title: 'Playback',
		actions: [
			{ id: 'togglePlay', label: 'Play / pause' },
			{ id: 'slower', label: 'Slower' },
			{ id: 'faster', label: 'Faster' },
			{ id: 'toggleMute', label: 'Mute / unmute' },
			{ id: 'stop', label: 'Stop playback' }
		]
	},
	{
		title: 'Selection',
		actions: [
			{ id: 'selectionIn', label: 'Set selection in' },
			{ id: 'selectionOut', label: 'Set selection out' },
			{ id: 'clearSelection', label: 'Clear selection' }
		]
	},
	{
		title: 'Navigation',
		actions: [
			{ id: 'previousFile', label: 'Previous file' },
			{ id: 'nextFile', label: 'Next file' }
		]
	}
];

const MODIFIER_CODES = new Set([
	'ShiftLeft',
	'ShiftRight',
	'ControlLeft',
	'ControlRight',
	'AltLeft',
	'AltRight',
	'MetaLeft',
	'MetaRight'
]);

const KEY_LABELS: Record<string, string> = {
	Space: 'Space',
	Escape: 'Esc',
	ArrowLeft: '←',
	ArrowRight: '→',
	ArrowUp: '↑',
	ArrowDown: '↓',
	Backspace: 'Backspace',
	Delete: 'Delete',
	Enter: 'Enter',
	Tab: 'Tab'
};

const SHORTCUT_ACTIONS = new Set<ShortcutAction>(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS) as ShortcutAction[]);

export function isBindableKey(code: string) {
	return code.length > 0 && !MODIFIER_CODES.has(code);
}

export function formatKeyCode(code: string) {
	if (KEY_LABELS[code]) return KEY_LABELS[code];
	if (code.startsWith('Key')) return code.slice(3);
	if (code.startsWith('Digit')) return code.slice(5);
	return code;
}

export function mergeKeyboardShortcuts(partial: unknown): KeyboardShortcuts {
	const merged = Object.fromEntries(
		Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([action, defaults]) => [action, [...defaults]])
	) as KeyboardShortcuts;

	if (!partial || typeof partial !== 'object') return merged;

	for (const [action, keys] of Object.entries(partial)) {
		if (!SHORTCUT_ACTIONS.has(action as ShortcutAction)) continue;
		if (!Array.isArray(keys)) continue;

		const cleaned = keys.filter((key): key is string => typeof key === 'string' && isBindableKey(key));
		if (cleaned.length > 0) {
			merged[action as ShortcutAction] = [...new Set(cleaned)];
		}
	}

	return merged;
}

export function resolveShortcutAction(
	code: string,
	shortcuts: KeyboardShortcuts
): ShortcutAction | null {
	for (const [action, keys] of Object.entries(shortcuts) as [ShortcutAction, string[]][]) {
		if (keys.includes(code)) return action;
	}
	return null;
}

export function findShortcutConflict(
	code: string,
	shortcuts: KeyboardShortcuts,
	excludeAction?: ShortcutAction
): ShortcutAction | null {
	for (const [action, keys] of Object.entries(shortcuts) as [ShortcutAction, string[]][]) {
		if (action === excludeAction) continue;
		if (keys.includes(code)) return action;
	}
	return null;
}

export function actionLabelFor(action: ShortcutAction) {
	for (const group of SHORTCUT_GROUPS) {
		const match = group.actions.find((entry) => entry.id === action);
		if (match) return match.label;
	}
	return action;
}
