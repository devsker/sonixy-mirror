import { useEffect, useState } from 'react';
import {
	actionLabelFor,
	formatKeyCode,
	isBindableKey,
	type ShortcutAction
} from '@/lib/keyboard-shortcuts';
import { settingsStore } from '@/lib/settings-store';
import { useStoreVersion, useSettingsVersion } from '@/lib/store-sync';

type Props = {
	action: ShortcutAction;
	label: string;
};

export function ShortcutBinding({ action, label }: Props) {
	useStoreVersion(useSettingsVersion);
	const keys = settingsStore.keyboardShortcuts[action];
	const [recordingIndex, setRecordingIndex] = useState<number | 'add' | null>(null);
	const [conflict, setConflict] = useState<string | null>(null);

	useEffect(() => {
		if (recordingIndex === null) return;

		const onKeyDown = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (e.code === 'Escape') {
				setRecordingIndex(null);
				setConflict(null);
				return;
			}

			if (!isBindableKey(e.code)) return;

			const otherAction = settingsStore.findShortcutConflict(e.code, action);
			if (otherAction) {
				setConflict(`Already used by ${actionLabelFor(otherAction)}`);
				return;
			}

			const nextKeys = [...keys];
			if (recordingIndex === 'add') {
				if (!nextKeys.includes(e.code)) nextKeys.push(e.code);
			} else {
				nextKeys[recordingIndex] = e.code;
			}

			settingsStore.setShortcutKeys(action, [...new Set(nextKeys)]);
			setRecordingIndex(null);
			setConflict(null);
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [action, keys, recordingIndex]);

	const removeKey = (index: number) => {
		const nextKeys = keys.filter((_, i) => i !== index);
		if (nextKeys.length === 0) {
			settingsStore.resetShortcutAction(action);
			return;
		}
		settingsStore.setShortcutKeys(action, nextKeys);
	};

	return (
		<li className="shortcut-list-item">
			<span className="shortcut-desc">{label}</span>
			<div className="shortcut-bindings">
				{keys.map((code, index) => (
					<span key={`${code}-${index}`} className="shortcut-binding-group">
						<button
							type="button"
							className={`shortcut-bind-btn${recordingIndex === index ? ' recording' : ''}`}
							onClick={() => {
								setConflict(null);
								setRecordingIndex(index);
							}}
						>
							<kbd>{formatKeyCode(code)}</kbd>
						</button>
						{keys.length > 1 && (
							<button
								type="button"
								className="shortcut-remove-btn"
								aria-label={`Remove ${formatKeyCode(code)}`}
								onClick={() => removeKey(index)}
							>
								×
							</button>
						)}
					</span>
				))}
				<button
					type="button"
					className={`shortcut-add-btn${recordingIndex === 'add' ? ' recording' : ''}`}
					onClick={() => {
						setConflict(null);
						setRecordingIndex('add');
					}}
				>
					+
				</button>
			</div>
			{recordingIndex !== null && (
				<span className={`shortcut-recording-hint${conflict ? ' conflict' : ''}`}>
					{conflict ?? 'Press a key… (Esc to cancel)'}
				</span>
			)}
		</li>
	);
}
