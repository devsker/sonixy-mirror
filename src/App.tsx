import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Route, Routes } from 'react-router-dom';
import { Titlebar } from '@/components/Titlebar';
import Sidebar from '@/components/Sidebar';
import DropPrompt from '@/components/DropPrompt';
import ContextMenu from '@/components/ContextMenu';
import HomePage from '@/pages/HomePage';
import SettingsPage from '@/pages/SettingsPage';
import DebugSettingsPage from '@/pages/DebugSettingsPage';
import { collectionStore } from '@/lib/collection-store';
import { audioPlayer } from '@/lib/audio-player';
import { settingsStore } from '@/lib/settings-store';
import { preloadDragIcon } from '@/lib/file-drag';
import { checkForUpdatesOnStartup } from '@/lib/updater';
import { filterExternalDropPaths } from '@/lib/external-drop';
import { useStoreVersion, useCollectionVersion, useSettingsVersion } from '@/lib/store-sync';

function applyTheme(value: string) {
	const root = document.documentElement;
	root.classList.remove('light', 'dark');

	if (value === 'system') {
		const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		root.classList.add(systemDark ? 'dark' : 'light');
	} else {
		root.classList.add(value);
	}
}

export default function App() {
	const collectionVersion = useStoreVersion(useCollectionVersion);
	const settingsVersion = useStoreVersion(useSettingsVersion);
	void collectionVersion;

	const [dropPaths, setDropPaths] = useState<string[]>([]);
	const [showDropPrompt, setShowDropPrompt] = useState(false);
	const [ffmpegDownloadMessage, setFfmpegDownloadMessage] = useState<string | null>(null);
	const [ffmpegDownloadProgress, setFfmpegDownloadProgress] = useState(0);

	const showDropPromptUi = showDropPrompt || collectionStore.pendingRelocate !== null;

	useEffect(() => {
		preloadDragIcon();
		checkForUpdatesOnStartup();

		const unlistenFfmpeg = listen<{ progress: number; message: string }>(
			'ffmpeg-download-progress',
			(event) => {
				setFfmpegDownloadProgress(event.payload.progress);
				setFfmpegDownloadMessage(event.payload.message);
				if (event.payload.progress >= 1) {
					setTimeout(() => {
						setFfmpegDownloadMessage(null);
						setFfmpegDownloadProgress(0);
					}, 1500);
				}
			}
		);

		const appWindow = getCurrentWindow();
		const unlistenPromise = appWindow.onDragDropEvent((event) => {
			if (collectionStore.isDraggingFromApp) return;

			if (event.payload.type === 'drop' && collectionStore.collectionPath) {
				const filteredPaths = filterExternalDropPaths(
					event.payload.paths,
					collectionStore.collectionPath
				);

				if (filteredPaths.length > 0) {
					setDropPaths(filteredPaths);
					setShowDropPrompt(true);
				}
			}
		});

		return () => {
			unlistenFfmpeg.then((f) => f());
			unlistenPromise.then((f) => f());
		};
	}, []);

	useEffect(() => {
		applyTheme(settingsStore.theme);
		setTimeout(() => {
			document.documentElement.classList.remove('no-transitions');
		}, 0);

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (settingsStore.theme === 'system') applyTheme('system');
		};
		mediaQuery.addEventListener('change', handler);
		return () => mediaQuery.removeEventListener('change', handler);
	}, []);

	useEffect(() => {
		applyTheme(settingsStore.theme);
	}, [settingsVersion]);

	function isTypingTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;

		switch (e.code) {
			case 'Space':
			case 'KeyK':
				e.preventDefault();
				audioPlayer.toggle();
				break;
			case 'KeyI':
				e.preventDefault();
				audioPlayer.setSelectionIn();
				break;
			case 'KeyO':
				e.preventDefault();
				audioPlayer.setSelectionOut();
				break;
			case 'KeyX':
				e.preventDefault();
				audioPlayer.clearSelection();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				audioPlayer.previous();
				break;
			case 'ArrowRight':
				e.preventDefault();
				audioPlayer.next();
				break;
			case 'KeyJ':
				e.preventDefault();
				audioPlayer.cycleSlower();
				break;
			case 'KeyL':
				e.preventDefault();
				audioPlayer.cycleFaster();
				break;
			case 'KeyM':
				e.preventDefault();
				audioPlayer.toggleMute();
				break;
			case 'Escape':
				if (showDropPromptUi || collectionStore.pendingRelocate) return;
				audioPlayer.stop();
				break;
		}
	}

	async function handleDropSelect(action: 'copy' | 'move') {
		if (collectionStore.pendingRelocate) {
			await collectionStore.confirmRelocate(action);
		} else if (dropPaths.length > 0) {
			setShowDropPrompt(false);
			await collectionStore.addFiles(dropPaths, action, settingsStore.normalizeOnImport);
			setDropPaths([]);
		}
	}

	function handleDropCancel() {
		setShowDropPrompt(false);
		collectionStore.pendingRelocate = null;
		collectionStore.notify();
		setDropPaths([]);
	}

	function closeDropPrompt() {
		if (showDropPrompt) handleDropCancel();
	}

	useEffect(() => {
		const onKeydown = (e: KeyboardEvent) => handleKeydown(e);
		const onClick = () => closeDropPrompt();
		const onContextMenu = (e: MouseEvent) => e.preventDefault();

		window.addEventListener('keydown', onKeydown);
		window.addEventListener('click', onClick);
		window.addEventListener('contextmenu', onContextMenu);

		return () => {
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('click', onClick);
			window.removeEventListener('contextmenu', onContextMenu);
		};
	});

	return (
		<div className="app-container">
			<Titlebar />
			<div className="app-layout">
				<Sidebar />
				<main className="app-content">
					<Routes>
						<Route path="/" element={<HomePage />} />
						<Route path="/settings" element={<SettingsPage />} />
						<Route path="/debug-settings" element={<DebugSettingsPage />} />
					</Routes>
				</main>
			</div>

			{showDropPromptUi && <DropPrompt onSelect={handleDropSelect} onCancel={handleDropCancel} />}

			<ContextMenu />

			{ffmpegDownloadMessage && (
				<div className="ffmpeg-banner" role="status">
					<p>{ffmpegDownloadMessage}</p>
					<progress max={1} value={ffmpegDownloadProgress} />
				</div>
			)}
		</div>
	);
}
