import { convertFileSrc } from '@tauri-apps/api/core';
import { collectionStore, type FileItem } from './collection-store.svelte';
import { settingsStore } from './settings-store.svelte';

class AudioPlayer {
	audio: HTMLAudioElement | null = null;
	currentFileId = $state<string | null>(null);
	isPlaying = $state(false);
	isWaitingToReplay = $state(false);
	replayProgress = $state(0);
	currentTime = $state(0);
	duration = $state(0);
	volume = $state(1);
	private lastVolume = 1;
	progress = $derived(this.duration > 0 ? this.currentTime / this.duration : 0);
	private animationFrame: number | null = null;
	private replayAnimationFrame: number | null = null;
	private replayTimeout: ReturnType<typeof setTimeout> | null = null;
	
	// Web Audio API
	private audioCtx: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private sourceNode: MediaElementAudioSourceNode | null = null;
	currentFileGain = 1.0;

	constructor() {
		if (typeof window !== 'undefined') {
			this.audio = new Audio();
			this.audio.crossOrigin = "anonymous";
			
			this.audio.addEventListener('play', () => {
				this.isPlaying = true;
				this.startUpdateLoop();
				this.clearReplayTimeout();
				// Resume AudioContext if it's suspended
				if (this.audioCtx?.state === 'suspended') {
					this.audioCtx.resume();
				}
			});
			this.audio.addEventListener('pause', () => {
				this.isPlaying = false;
				this.stopUpdateLoop();
			});
			this.audio.addEventListener('ended', () => {
				if (this.audio) {
					this.audio.currentTime = 0;
					
					// On short audio files < 2 sec add a little delay before playing again
					if (this.audio.duration < 2 && settingsStore.playbackDelay > 0) {
						this.isWaitingToReplay = true;
						this.replayProgress = 0;
						const startTime = performance.now();
						const duration = settingsStore.playbackDelay;

						const updateReplayProgress = (now: number) => {
							const elapsed = now - startTime;
							this.replayProgress = Math.min(1, elapsed / duration);
							
							if (elapsed < duration) {
								this.replayAnimationFrame = requestAnimationFrame(updateReplayProgress);
							} else {
								this.replayAnimationFrame = null;
							}
						};
						this.replayAnimationFrame = requestAnimationFrame(updateReplayProgress);

						this.replayTimeout = setTimeout(() => {
							this.isWaitingToReplay = false;
							this.replayProgress = 0;
							if (this.audio && this.audio.paused && this.currentFileId) {
								this.audio.play();
							}
						}, duration);
					} else {
						this.audio.play();
					}
				}
			});
			this.audio.addEventListener('timeupdate', () => {
				if (this.audio && !this.isPlaying) this.currentTime = this.audio.currentTime;
			});
			this.audio.addEventListener('loadedmetadata', () => {
				if (this.audio) {
					this.duration = this.audio.duration;
				}
			});
		}
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

	private initAudioContext() {
		if (this.audioCtx || !this.audio) return;

		this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
		this.gainNode = this.audioCtx.createGain();
		this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
		
		this.sourceNode.connect(this.gainNode);
		this.gainNode.connect(this.audioCtx.destination);
		
		this.updateEffectiveGain();
	}

	private updateEffectiveGain() {
		if (this.gainNode) {
			// Web Audio API allows gain > 1.0
			this.gainNode.gain.value = this.volume * this.currentFileGain;
		}
	}

	private startUpdateLoop() {
		if (this.animationFrame) return;
		const update = () => {
			if (this.audio && this.isPlaying) {
				this.currentTime = this.audio.currentTime;
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
		if (!this.audio || !collectionStore.collectionPath) return;

		this.clearReplayTimeout();

		if (!this.audioCtx) {
			this.initAudioContext();
		}

		this.currentFileGain = file.gain || 1.0;
		this.updateEffectiveGain();

		if (this.currentFileId !== file.id) {
			this.currentFileId = file.id;
			
			// Sync selection in collectionStore
			collectionStore.files.forEach(f => {
				f.selected = (f.id === file.id);
			});

			let fullPath = `${collectionStore.collectionPath}/${file.filepath}`;
			fullPath = fullPath.replace(/[\\\/]+/g, '/');
			
			const assetUrl = convertFileSrc(fullPath);
			this.audio.src = assetUrl;
			this.audio.load();
		}

		try {
			await this.audio.play();
		} catch (e) {
			console.error('AudioPlayer: Playback failed:', e);
		}
	}

	pause() {
		this.clearReplayTimeout();
		this.audio?.pause();
	}

	toggle(file?: FileItem) {
		if (!file) {
			if (this.currentFileId) {
				const currentFile = collectionStore.files.find(f => f.id === this.currentFileId);
				if (currentFile) file = currentFile;
			} else if (collectionStore.files.length > 0) {
				file = collectionStore.files[0];
			}
		}

		if (!file) return;

		if (this.currentFileId === file.id) {
			if (this.isPlaying) {
				this.pause();
			} else {
				this.play(file);
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
		this.updateEffectiveGain();
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
		if (collectionStore.files.length === 0) return;
		
		let nextIndex = 0;
		if (this.currentFileId) {
			const currentIndex = collectionStore.files.findIndex(f => f.id === this.currentFileId);
			nextIndex = (currentIndex + 1) % collectionStore.files.length;
		}
		
		const nextFile = collectionStore.files[nextIndex];
		if (nextFile && !nextFile.missing) {
			this.play(nextFile);
		}
	}

	previous() {
		if (collectionStore.files.length === 0) return;
		
		let prevIndex = collectionStore.files.length - 1;
		if (this.currentFileId) {
			const currentIndex = collectionStore.files.findIndex(f => f.id === this.currentFileId);
			prevIndex = (currentIndex - 1 + collectionStore.files.length) % collectionStore.files.length;
		}
		
		const prevFile = collectionStore.files[prevIndex];
		if (prevFile && !prevFile.missing) {
			this.play(prevFile);
		}
	}

	seek(progressPercent: number) {
		if (this.audio && this.audio.readyState > 0) {
			const newTime = progressPercent * this.duration;
			this.audio.currentTime = newTime;
			this.currentTime = newTime;
		}
	}
}

export const audioPlayer = new AudioPlayer();
