import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	Minus,
	Square,
	X,
	RefreshCw,
	CheckCircle2,
	AlertCircle,
	Loader2,
	Play,
	Pause,
	SkipBack,
	SkipForward,
	Volume2,
	VolumeX,
	Volume1,
	FolderOpen
} from 'lucide-react';
import { collectionStore } from '@/lib/collection-store';
import { audioPlayer } from '@/lib/audio-player';
import { settingsStore } from '@/lib/settings-store';
import { collectionDisplayName } from '@/lib/collection-path';
import {
	parseTitlebarLayout,
	resolveTitlebarStyle,
	usesLinuxWindowControls,
	usesMacTrafficLights,
	windowControlsPinLeft
} from '@/lib/platform';
import {
	useStoreVersion,
	useCollectionVersion,
	useSettingsVersion,
	useAudioVersion
} from '@/lib/store-sync';
import { MacTrafficLights } from './MacTrafficLights';
import { LinuxWindowControls } from './LinuxWindowControls';
import styles from './Titlebar.module.css';

const appWindow = getCurrentWindow();

function blurButton(e: React.MouseEvent<HTMLElement>) {
	e.currentTarget.blur();
}

export function Titlebar() {
	useStoreVersion(useCollectionVersion);
	useStoreVersion(useSettingsVersion);
	useStoreVersion(useAudioVersion);

	const [showTasks, setShowTasks] = useState(false);

	const titlebarStyle = resolveTitlebarStyle(settingsStore.titlebarStyle);
	const showMacTrafficLights = usesMacTrafficLights(titlebarStyle);
	const showLinuxWindowControls = usesLinuxWindowControls(titlebarStyle);
	const pinWindowControlsLeft = windowControlsPinLeft(titlebarStyle);

	const loading = collectionStore.loading;
	const collectionPath = collectionStore.collectionPath;
	const collectionName = collectionDisplayName(collectionPath);
	const showSwitchingUi = collectionStore.showSwitchingUi;
	const tasks = collectionStore.tasks;
	const tasksPanelRequest = collectionStore.tasksPanelRequest;
	const processingPaused = collectionStore.processingPaused;

	const activeTasks = tasks.filter(
		(t) => t.status === 'running' || t.status === 'pending' || t.status === 'paused'
	);
	const activeTasksCount = activeTasks.length;
	const overallProgress =
		activeTasksCount > 0
			? activeTasks.reduce((acc, t) => acc + t.progress, 0) / activeTasksCount
			: tasks.length > 0
				? 100
				: 0;

	const isPlaying = audioPlayer.isPlaying;
	const isWaitingToReplay = audioPlayer.isWaitingToReplay;
	const replayProgress = audioPlayer.replayProgress;
	const volume = audioPlayer.volume;

	const sections = parseTitlebarLayout(settingsStore.titlebarLayout);

	useEffect(() => {
		const closeTasks = () => setShowTasks(false);
		window.addEventListener('click', closeTasks);
		return () => window.removeEventListener('click', closeTasks);
	}, []);

	useEffect(() => {
		if (tasksPanelRequest > 0) {
			setShowTasks(true);
		}
	}, [tasksPanelRequest]);

	const minimize = useCallback(async () => {
		await appWindow.minimize();
	}, []);

	const toggleMaximize = useCallback(async () => {
		if (await appWindow.isMaximized()) {
			await appWindow.unmaximize();
		} else {
			await appWindow.maximize();
		}
	}, []);

	const close = useCallback(async () => {
		await appWindow.close();
	}, []);

	const toggleTasks = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setShowTasks((v) => !v);
	}, []);

	const handleVolumeWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		const delta = e.deltaY > 0 ? -0.05 : 0.05;
		audioPlayer.setVolume(audioPlayer.volume + delta);
	}, []);

	const windowControls = (
		<div
			className={`${styles.windowControls} ${showMacTrafficLights ? styles.windowControlsMacos : ''} ${showLinuxWindowControls ? styles.windowControlsLinux : ''}`}
		>
			{showMacTrafficLights ? (
				<MacTrafficLights onClose={close} onMinimize={minimize} onZoom={toggleMaximize} />
			) : showLinuxWindowControls ? (
				<LinuxWindowControls onClose={close} onMinimize={minimize} onZoom={toggleMaximize} />
			) : (
				<>
					<button
						type="button"
						className={styles.controlBtn}
						onClick={minimize}
						aria-label="Minimize"
					>
						<Minus size={14} />
					</button>
					<button
						type="button"
						className={styles.controlBtn}
						onClick={toggleMaximize}
						aria-label="Maximize"
					>
						<Square size={12} />
					</button>
					<button
						type="button"
						className={`${styles.controlBtn} ${styles.closeBtn}`}
						onClick={close}
						aria-label="Close"
					>
						<X size={14} />
					</button>
				</>
			)}
		</div>
	);

	const renderElement = (id: string) => {
		if (id === 'title') {
			return (
				<div
					key={id}
					data-tauri-drag-region
					className={styles.titleContainer}
					title={collectionPath ?? undefined}
				>
					<span className={`${styles.title} ${collectionPath ? styles.titleHasCollection : ''}`}>
						{collectionPath ? (
							<span
								className={`${styles.collectionName} ${showSwitchingUi ? styles.collectionNameLoading : ''}`}
							>
								{collectionName}
							</span>
						) : (
							'Sonixy'
						)}
					</span>
				</div>
			);
		}
		if (id === 'folder') {
			return (
				<button
					key={id}
					type="button"
					className={styles.folderBtn}
					onClick={() => collectionStore.openCollection()}
					aria-label="Open Collection"
				>
					<FolderOpen size={14} />
				</button>
			);
		}
		if (id === 'playback') {
			return (
				<div key={id} className={styles.playbackControls}>
					<button
						type="button"
						className={styles.playbackBtn}
						onClick={(e) => {
							audioPlayer.previous();
							blurButton(e);
						}}
						aria-label="Previous"
					>
						<SkipBack size={14} fill="currentColor" />
					</button>
					<button
						type="button"
						className={`${styles.playbackBtn} ${styles.playPause}`}
						onClick={(e) => {
							audioPlayer.toggle();
							blurButton(e);
						}}
						aria-label={isPlaying ? 'Pause' : 'Play'}
					>
						{isWaitingToReplay ? (
							<svg width="18" height="18" viewBox="0 0 18 18">
								<circle
									cx="9"
									cy="9"
									r="7"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									opacity="0.2"
								/>
								<circle
									cx="9"
									cy="9"
									r="7"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeDasharray="44"
									strokeDashoffset={44 - 44 * replayProgress}
									strokeLinecap="round"
									transform="rotate(-90 9 9)"
								/>
							</svg>
						) : isPlaying ? (
							<Pause size={16} fill="currentColor" />
						) : (
							<Play size={16} fill="currentColor" />
						)}
					</button>
					<button
						type="button"
						className={styles.playbackBtn}
						onClick={(e) => {
							audioPlayer.next();
							blurButton(e);
						}}
						aria-label="Next"
					>
						<SkipForward size={14} fill="currentColor" />
					</button>
				</div>
			);
		}
		if (id === 'volume') {
			return (
				<div key={id} className={styles.volumeControl} onWheel={handleVolumeWheel}>
					<button
						type="button"
						className={`${styles.playbackBtn} ${styles.volumeBtn}`}
						onClick={(e) => {
							audioPlayer.toggleMute();
							blurButton(e);
						}}
					>
						{volume === 0 ? (
							<VolumeX size={14} />
						) : volume < 0.5 ? (
							<Volume1 size={14} />
						) : (
							<Volume2 size={14} />
						)}
					</button>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={volume}
						onInput={(e) => audioPlayer.setVolume(parseFloat(e.currentTarget.value))}
						className={styles.volumeSlider}
					/>
				</div>
			);
		}
		if (id === 'tasks' && collectionPath) {
			return (
				<div
					key={id}
					className={styles.taskContainer}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
					role="presentation"
				>
					<button
						type="button"
						className={`${styles.controlBtn} ${styles.taskBtn} ${activeTasksCount > 0 ? styles.taskBtnActive : ''}`}
						onClick={toggleTasks}
						aria-label="Tasks"
					>
						<div className={styles.taskBtnIcon}>
							<svg width="18" height="18" viewBox="0 0 18 18">
								<circle
									cx="9"
									cy="9"
									r="7"
									fill="none"
									stroke={processingPaused ? 'var(--warning-color, #eab308)' : 'currentColor'}
									strokeWidth="2"
									opacity="0.2"
								/>
								<circle
									cx="9"
									cy="9"
									r="7"
									fill="none"
									stroke={
										processingPaused
											? 'var(--warning-color, #eab308)'
											: 'var(--accent-color, #3b82f6)'
									}
									strokeWidth="2"
									strokeDasharray="44"
									strokeDashoffset={44 - (44 * overallProgress) / 100}
									strokeLinecap="round"
									transform="rotate(-90 9 9)"
								/>
							</svg>
							{processingPaused && (
								<Pause
									size={10}
									fill="var(--text-muted)"
									color="var(--text-muted)"
									className={styles.taskPauseOverlay}
								/>
							)}
						</div>
					</button>

					{showTasks && (
						<div className={styles.tasksPopover}>
							<div className={styles.popoverHeader}>
								<span>Background Tasks</span>
								{activeTasksCount > 0 && (
									<button
										type="button"
										className={styles.pauseResumeBtn}
										onClick={() =>
											processingPaused
												? collectionStore.resumeProcessing()
												: collectionStore.pauseProcessing()
										}
										aria-label={processingPaused ? 'Resume tasks' : 'Pause tasks'}
									>
										{processingPaused ? (
											<>
												<Play size={11} fill="currentColor" />
												<span>Resume</span>
											</>
										) : (
											<>
												<Pause size={11} fill="currentColor" />
												<span>Pause</span>
											</>
										)}
									</button>
								)}
							</div>
							<div className={styles.tasksList}>
								{tasks.length === 0 ? (
									<div className={styles.noTasks}>No active tasks</div>
								) : (
									tasks.map((task) => (
										<div key={task.id} className={styles.taskItem}>
											<div className={styles.taskInfo}>
												<span className={styles.taskName}>{task.name}</span>
												<div className={styles.taskStatus}>
													{task.status === 'running' && (
														<Loader2 size={12} className={styles.animateSpin} />
													)}
													{task.status === 'paused' && <Pause size={12} />}
													{task.status === 'completed' && (
														<CheckCircle2 size={12} color="var(--success-color, #22c55e)" />
													)}
													{task.status === 'failed' && (
														<AlertCircle size={12} color="var(--error-color, #ef4444)" />
													)}
													<span>{Math.round(task.progress)}%</span>
												</div>
											</div>
											<div className={styles.taskProgressBar}>
												<div
													className={`${styles.progressFill} ${task.status === 'paused' ? styles.progressFillPaused : ''} ${task.status === 'completed' ? styles.progressFillCompleted : ''} ${task.status === 'failed' ? styles.progressFillFailed : ''}`}
													style={{ width: `${task.progress}%` }}
												/>
											</div>
											{task.message && (
												<span className={styles.taskMessage}>
													{task.status === 'paused'
														? task.message.replace(/ - .+remaining$/, '')
														: task.message}
												</span>
											)}
										</div>
									))
								)}
							</div>
						</div>
					)}
				</div>
			);
		}
		if (id === 'refresh' && collectionPath) {
			return (
				<button
					key={id}
					type="button"
					className={styles.controlBtn}
					onClick={() => collectionStore.refresh()}
					aria-label="Refresh"
					disabled={loading}
				>
					<RefreshCw size={14} className={loading ? styles.animateSpin : undefined} />
				</button>
			);
		}
		if (id === 'spacer') {
			return <div key={id} data-tauri-drag-region className={styles.spacer} />;
		}
		return null;
	};

	return (
		<div data-tauri-drag-region className={styles.titlebar}>
			{pinWindowControlsLeft && (
				<div className={`${styles.titlebarPinned} ${styles.titlebarPinnedLeft}`}>
					{windowControls}
				</div>
			)}

			<div data-tauri-drag-region className={`${styles.titlebarSection} ${styles.titlebarLeft}`}>
				{sections.left.map((id) => renderElement(id))}
			</div>

			<div data-tauri-drag-region className={`${styles.titlebarSection} ${styles.titlebarCenter}`}>
				{sections.center.map((id) => renderElement(id))}
			</div>

			<div data-tauri-drag-region className={`${styles.titlebarSection} ${styles.titlebarRight}`}>
				{sections.right.map((id) => renderElement(id))}
			</div>

			{!pinWindowControlsLeft && (
				<div className={`${styles.titlebarPinned} ${styles.titlebarPinnedRight}`}>
					{windowControls}
				</div>
			)}
		</div>
	);
}
