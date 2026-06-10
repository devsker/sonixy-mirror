import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { collectionStore, type FileItem } from './collection-store';
import { useAudioVersion } from './store-sync';
import { settingsStore } from './settings-store';

class AudioPlayer {
	currentFileId: string | null = null;
	isPlaying = false;
	isWaitingToReplay = false;
	replayProgress = 0;
	currentTime = 0;
	duration = 0;
	volume = settingsStore.volume;
	playbackSpeed = 1;
	private lastVolume = settingsStore.volume > 0 ? settingsStore.volume : 1;
	private lastSyncTime = 0;
	private lastSyncWallClock = 0;
	get progress() {
		return this.duration > 0 ? this.currentTime / this.duration : 0;
	}
	get smoothProgress() {
		return this.duration > 0 ? this.smoothTime / this.duration : 0;
	}
	get smoothTime() {
		if (!this.isPlaying) return this.currentTime;
		const elapsed = (performance.now() - this.lastSyncWallClock) / 1000;
		return Math.min(
			this.duration,
			Math.max(0, this.lastSyncTime + elapsed * this.playbackSpeed)
		);
	}
	private animationFrame: number | null = null;
	private replayAnimationFrame: number | null = null;
	private replayTimeout: ReturnType<typeof setTimeout> | null = null;
	abLoopEnabled = false;
	abLoopStart = 0;
	abLoopEnd = 1;
	waveformFileId: string | null = null;
	selectionFileId: string | null = null;
	selectionIn: number | null = null;
	selectionOut: number | null = null;

	get selectionRange(): { start: number; end: number } | null {
		if (this.selectionIn === null || this.selectionOut === null) return null;
		const start = Math.min(this.selectionIn, this.selectionOut);
		const end = Math.max(this.selectionIn, this.selectionOut);
		if (end - start <= 0.001) return null;
		return { start, end };
	}

	constructor() {
		if (typeof window !== 'undefined') {
			invoke('set_volume', { volume: this.volume });

			listen('audio-ended', () => {
				if (this.abLoopEnabled && this.currentFileId) {
					this.seekToFraction(this.abLoopStart);
					const currentFile = collectionStore.files.find((f) => f.id === this.currentFileId);
					if (currentFile) {
						this.play(currentFile);
					}
					return;
				}

				this.isPlaying = false;
				this.stopUpdateLoop();
				this.currentTime = 0;

				if (this.duration < 2 && settingsStore.playbackDelay > 0) {
					this.isWaitingToReplay = true;
					this.replayProgress = 0;
					const startTime = performance.now();
					const delay = settingsStore.playbackDelay;

					let lastReplayNotify = 0;
					const updateReplayProgress = (now: number) => {
						const elapsed = now - startTime;
						this.replayProgress = Math.min(1, elapsed / delay);
						const t = performance.now();
						if (t - lastReplayNotify > 50) {
							this.notify();
							lastReplayNotify = t;
						}

						if (elapsed < delay) {
							this.replayAnimationFrame = requestAnimationFrame(updateReplayProgress);
						} else {
							this.replayAnimationFrame = null;
						}
					};
					this.replayAnimationFrame = requestAnimationFrame(updateReplayProgress);

					this.replayTimeout = setTimeout(() => {
						this.isWaitingToReplay = false;
						this.replayProgress = 0;
						if (this.currentFileId) {
							const currentFile = collectionStore.files.find((f) => f.id === this.currentFileId);
							if (currentFile) this.play(currentFile);
						}
					}, delay);
				} else {
					if (this.currentFileId) {
						const currentFile = collectionStore.files.find((f) => f.id === this.currentFileId);
						if (currentFile) this.play(currentFile);
					}
				}
			});
		}
	}

	notify() {
		useAudioVersion.getState().bump();
	}

	setAbLoop(start: number, end: number) {
		this.abLoopStart = Math.max(0, Math.min(1, start));
		this.abLoopEnd = Math.max(this.abLoopStart, Math.min(1, end));
		this.abLoopEnabled = this.abLoopEnd - this.abLoopStart > 0.001;
	}

	clearAbLoop() {
		this.abLoopEnabled = false;
		this.abLoopStart = 0;
		this.abLoopEnd = 1;
	}

	setWaveformFileId(id: string | null) {
		this.waveformFileId = id;
	}

	private activeFileId() {
		return this.currentFileId ?? this.waveformFileId;
	}

	private playheadFraction() {
		if (!this.currentFileId || this.duration <= 0) return 0;
		return this.smoothProgress;
	}

	setSelectionIn(fraction?: number) {
		const fileId = this.activeFileId();
		if (!fileId) return;
		const f = Math.max(0, Math.min(1, fraction ?? this.playheadFraction()));
		this.selectionFileId = fileId;

		if (this.selectionIn !== null && this.selectionOut !== null) {
			this.selectionIn = f;
			this.selectionOut = null;
		} else {
			this.selectionIn = f;
		}
		this.notify();
	}

	setSelectionOut(fraction?: number) {
		const fileId = this.activeFileId();
		if (!fileId) return;
		const f = Math.max(0, Math.min(1, fraction ?? this.playheadFraction()));
		this.selectionFileId = fileId;

		if (this.selectionIn !== null && this.selectionOut !== null) {
			this.selectionOut = f;
			this.selectionIn = null;
		} else {
			this.selectionOut = f;
		}
		this.notify();
	}

	setSelection(start: number, end: number, fileId?: string) {
		const id = fileId ?? this.activeFileId();
		if (!id) return;
		const lo = Math.max(0, Math.min(1, Math.min(start, end)));
		const hi = Math.max(0, Math.min(1, Math.max(start, end)));
		this.selectionFileId = id;
		this.selectionIn = lo;
		this.selectionOut = hi;
		this.notify();
	}

	clearSelection() {
		this.selectionFileId = null;
		this.selectionIn = null;
		this.selectionOut = null;
		this.notify();
	}

	async setPlaybackSpeed(speed: number) {
		this.playbackSpeed = speed;
		try {
			await invoke('set_playback_speed', { speed });
			this.syncPlaybackClock(this.smoothTime);
			this.notify();
		} catch (e) {
			console.error('AudioPlayer: Failed to set playback speed:', e);
		}
	}

	cycleFaster() {
		if (this.playbackSpeed === 1) void this.setPlaybackSpeed(2);
		else if (this.playbackSpeed === 2) void this.setPlaybackSpeed(4);
		else void this.setPlaybackSpeed(1);
	}

	cycleSlower() {
		if (this.playbackSpeed === 1) void this.setPlaybackSpeed(0.5);
		else if (this.playbackSpeed === 0.5) void this.setPlaybackSpeed(0.25);
		else void this.setPlaybackSpeed(1);
	}

	private async resetPlaybackSpeed() {
		if (this.playbackSpeed === 1) return;
		await this.setPlaybackSpeed(1);
	}

	private clearReplayTimeout() {
		if (this.replayTimeout) {
			clearTimeout(this.replayTimeout);
			this.replayTimeout = null;
		}
		if (this.replayAnimationFrame) {
			cancelAnimationFrame(this.replayAnimationFrame);
			this.replayAnimationFrame = null;
		}
		this.isWaitingToReplay = false;
		this.replayProgress = 0;
	}

	private async checkAbLoopBoundary() {
		if (!this.abLoopEnabled || this.duration <= 0) return;
		const endTime = this.abLoopEnd * this.duration;
		const time = this.isPlaying ? this.smoothTime : this.currentTime;
		if (time >= endTime - 0.05) {
			await this.seekToFraction(this.abLoopStart);
		}
	}

	private syncPlaybackClock(time = this.currentTime) {
		this.lastSyncTime = time;
		this.lastSyncWallClock = performance.now();
	}

	private async seekToFraction(fraction: number) {
		const newTime = fraction * this.duration;
		await invoke('seek_audio', { timeSeconds: newTime });
		this.currentTime = newTime;
		this.syncPlaybackClock(newTime);
	}

	private startUpdateLoop() {
		if (this.animationFrame) return;
		let lastPlaybackNotify = 0;
		let lastPoll = 0;
		const update = async (now: number) => {
			if (this.isPlaying) {
				if (now - lastPoll > 200) {
					this.currentTime = await invoke<number>('get_audio_time');
					this.syncPlaybackClock(this.currentTime);
					lastPoll = now;
					await this.checkAbLoopBoundary();
				} else if (this.abLoopEnabled) {
					this.currentTime = this.smoothTime;
					await this.checkAbLoopBoundary();
				}
				if (now - lastPlaybackNotify > 50) {
					this.notify();
					lastPlaybackNotify = now;
				}
				this.animationFrame = requestAnimationFrame(update);
			} else {
				this.animationFrame = null;
			}
		};
		this.animationFrame = requestAnimationFrame(update);
	}

	private stopUpdateLoop() {
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}
	}

	async play(file: FileItem) {
		if (!collectionStore.collectionPath) return;
		if (collectionStore.processingFiles.has(file.id)) {
			console.warn('AudioPlayer: Cannot play file while it is being processed.');
			return;
		}

		this.clearReplayTimeout();

		if (this.currentFileId !== file.id) {
			this.currentFileId = file.id;
			this.duration = file.duration || 0;
			if (this.selectionFileId !== file.id) {
				this.clearSelection();
			}
			await this.resetPlaybackSpeed();

			collectionStore.files.forEach((f) => {
				f.selected = f.id === file.id;
			});
		}

		try {
			await invoke('play_audio', { path: file.filepath, gain: file.gain || 1.0 });
			this.isPlaying = true;
			this.currentTime = 0;
			this.syncPlaybackClock(0);
			this.startUpdateLoop();
			this.notify();
		} catch (e) {
			console.error('AudioPlayer: Playback failed:', e);
		}
	}

	pause() {
		this.clearReplayTimeout();
		invoke('pause_audio');
		this.currentTime = this.smoothTime;
		this.syncPlaybackClock(this.currentTime);
		this.isPlaying = false;
		this.stopUpdateLoop();
		this.notify();
	}

	resume() {
		this.clearReplayTimeout();
		invoke('resume_audio');
		this.syncPlaybackClock(this.currentTime);
		this.isPlaying = true;
		this.startUpdateLoop();
		this.notify();
	}

	toggle(file?: FileItem) {
		if (!file) {
			if (this.currentFileId) {
				const currentFile = collectionStore.files.find((f) => f.id === this.currentFileId);
				if (currentFile) file = currentFile;
			} else if (collectionStore.displayedFiles.length > 0) {
				file = collectionStore.displayedFiles[0];
			}
		}

		if (!file) return;

		if (this.currentFileId === file.id) {
			if (this.isPlaying) {
				this.pause();
			} else {
				this.resume();
			}
		} else {
			this.play(file);
		}
	}

	setVolume(v: number) {
		this.volume = Math.max(0, Math.min(1, v));
		if (this.volume > 0) {
			this.lastVolume = this.volume;
		}
		invoke('set_volume', { volume: this.volume });
		if (settingsStore.volume !== this.volume) {
			settingsStore.volume = this.volume;
			settingsStore.notify();
		}
		this.notify();
	}

	toggleMute() {
		if (this.volume > 0) {
			this.lastVolume = this.volume;
			this.setVolume(0);
		} else {
			this.setVolume(this.lastVolume);
		}
	}

	next() {
		if (collectionStore.displayedFiles.length === 0) return;

		let nextIndex = 0;
		if (this.currentFileId) {
			const currentIndex = collectionStore.displayedFiles.findIndex(
				(f) => f.id === this.currentFileId
			);
			nextIndex = (currentIndex + 1) % collectionStore.displayedFiles.length;
		}

		const nextFile = collectionStore.displayedFiles[nextIndex];
		if (nextFile && !nextFile.missing) {
			this.play(nextFile);
		}
	}

	previous() {
		if (collectionStore.displayedFiles.length === 0) return;

		let prevIndex = collectionStore.displayedFiles.length - 1;
		if (this.currentFileId) {
			const currentIndex = collectionStore.displayedFiles.findIndex(
				(f) => f.id === this.currentFileId
			);
			prevIndex =
				(currentIndex - 1 + collectionStore.displayedFiles.length) %
				collectionStore.displayedFiles.length;
		}

		const prevFile = collectionStore.displayedFiles[prevIndex];
		if (prevFile && !prevFile.missing) {
			this.play(prevFile);
		}
	}

	async stop() {
		this.clearSelection();
		await this.resetPlaybackSpeed();
		invoke('stop_audio');
		this.isPlaying = false;
		this.currentFileId = null;
		this.currentTime = 0;
		this.stopUpdateLoop();
		this.notify();
	}

	stopIfPlaying(fileId: string) {
		if (this.currentFileId === fileId) {
			this.stop();
		}
	}

	async seek(progressPercent: number) {
		const newTime = progressPercent * this.duration;
		await invoke('seek_audio', { timeSeconds: newTime });
		this.currentTime = newTime;
		this.syncPlaybackClock(newTime);
		this.notify();
	}
}

export const audioPlayer = new AudioPlayer();
