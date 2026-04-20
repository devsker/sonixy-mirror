import { convertFileSrc } from '@tauri-apps/api/core';
import { collectionStore, type FileItem } from './collection-store.svelte';

class AudioPlayer {
	audio: HTMLAudioElement | null = null;
	currentFileId = $state<string | null>(null);
	isPlaying = $state(false);
	currentTime = $state(0);
	duration = $state(0);
	volume = $state(1);
	progress = $derived(this.duration > 0 ? this.currentTime / this.duration : 0);
	private animationFrame: number | null = null;

	constructor() {
		if (typeof window !== 'undefined') {
			this.audio = new Audio();
			this.audio.volume = this.volume;
			this.audio.addEventListener('play', () => {
				this.isPlaying = true;
				this.startUpdateLoop();
			});
			this.audio.addEventListener('pause', () => {
				this.isPlaying = false;
				this.stopUpdateLoop();
			});
			this.audio.addEventListener('ended', () => {
				if (this.audio) {
					this.audio.currentTime = 0;
					this.audio.play();
				}
			});
			this.audio.addEventListener('timeupdate', () => {
				if (this.audio && !this.isPlaying) this.currentTime = this.audio.currentTime;
			});
			this.audio.addEventListener('loadedmetadata', () => {
				if (this.audio) {
					this.duration = this.audio.duration;
					console.log('AudioPlayer: Metadata loaded, duration:', this.duration);
				}
			});
			this.audio.addEventListener('error', (e) => {
				console.error('AudioPlayer: Audio element error:', {
					error: this.audio?.error,
					src: this.audio?.src,
					event: e
				});
			});
			this.audio.addEventListener('canplay', () => {
				console.log('AudioPlayer: Can play event fired');
			});
			this.audio.addEventListener('stalled', () => {
				console.warn('AudioPlayer: Playback stalled');
			});
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
		if (!this.audio || !collectionStore.collectionPath) {
			console.error('AudioPlayer: No audio element or collection path', { audio: !!this.audio, path: collectionStore.collectionPath });
			return;
		}

		if (this.currentFileId !== file.id) {
			this.currentFileId = file.id;
			
			// Normalize path to avoid mixed slashes and ensuring it's absolute
			let fullPath = `${collectionStore.collectionPath}/${file.filepath}`;
			// Basic normalization: replace multiple slashes and backslashes with a single slash
			fullPath = fullPath.replace(/[\\\/]+/g, '/');
			
			// On Windows, if it's an absolute path like C:/... ensure it starts correctly
			// but usually the regex above is fine.
			
			const assetUrl = convertFileSrc(fullPath);
			console.log('AudioPlayer: Playing', { filename: file.filename, fullPath, assetUrl });
			this.audio.src = assetUrl;
			this.audio.load();
		}

		try {
			await this.audio.play();
			console.log('AudioPlayer: Playback started');
		} catch (e) {
			console.error('AudioPlayer: Playback failed:', e);
		}
	}

	pause() {
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
		if (this.audio) {
			this.audio.volume = this.volume;
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
