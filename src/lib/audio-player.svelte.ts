import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { collectionStore, type FileItem } from './collection-store.svelte';
import { settingsStore } from './settings-store.svelte';

class AudioPlayer {
	currentFileId = $state<string | null>(null);
	isPlaying = $state(false);
	isWaitingToReplay = $state(false);
	replayProgress = $state(0);
	currentTime = $state(0);
	duration = $state(0);
	volume = $state(settingsStore.volume);
	private lastVolume = settingsStore.volume > 0 ? settingsStore.volume : 1;
	progress = $derived(this.duration > 0 ? this.currentTime / this.duration : 0);
	private animationFrame: number | null = null;
	private replayAnimationFrame: number | null = null;
	private replayTimeout: ReturnType<typeof setTimeout> | null = null;

	abLoopEnabled = $state(false);
	abLoopStart = $state(0);
	abLoopEnd = $state(1);

	constructor() {
		if (typeof window !== 'undefined') {
			invoke('set_volume', { volume: this.volume });

			$effect.root(() => {
				$effect(() => {
					const v = this.volume;
					if (settingsStore.volume !== v) {
						settingsStore.volume = v;
					}
				});
			});

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

					const updateReplayProgress = (now: number) => {
						const elapsed = now - startTime;
						this.replayProgress = Math.min(1, elapsed / delay);

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
		if (this.currentTime >= endTime - 0.05) {
			await this.seekToFraction(this.abLoopStart);
		}
	}

	private async seekToFraction(fraction: number) {
		const newTime = fraction * this.duration;
		await invoke('seek_audio', { timeSeconds: newTime });
		this.currentTime = newTime;
	}

	private startUpdateLoop() {
		if (this.animationFrame) return;
		const update = async () => {
			if (this.isPlaying) {
				this.currentTime = await invoke<number>('get_audio_time');
				await this.checkAbLoopBoundary();
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
			this.clearAbLoop();

			collectionStore.files.forEach((f) => {
				f.selected = f.id === file.id;
			});
		}

		try {
			await invoke('play_audio', { path: file.filepath, gain: file.gain || 1.0 });
			this.isPlaying = true;
			this.startUpdateLoop();
		} catch (e) {
			console.error('AudioPlayer: Playback failed:', e);
		}
	}

	pause() {
		this.clearReplayTimeout();
		invoke('pause_audio');
		this.isPlaying = false;
		this.stopUpdateLoop();
	}

	resume() {
		this.clearReplayTimeout();
		invoke('resume_audio');
		this.isPlaying = true;
		this.startUpdateLoop();
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
			const currentIndex = collectionStore.displayedFiles.findIndex((f) => f.id === this.currentFileId);
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
			const currentIndex = collectionStore.displayedFiles.findIndex((f) => f.id === this.currentFileId);
			prevIndex = (currentIndex - 1 + collectionStore.displayedFiles.length) % collectionStore.displayedFiles.length;
		}

		const prevFile = collectionStore.displayedFiles[prevIndex];
		if (prevFile && !prevFile.missing) {
			this.play(prevFile);
		}
	}

	stop() {
		this.clearAbLoop();
		invoke('stop_audio');
		this.isPlaying = false;
		this.currentFileId = null;
		this.currentTime = 0;
		this.stopUpdateLoop();
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
	}
}

export const audioPlayer = new AudioPlayer();
