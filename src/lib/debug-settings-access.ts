import { isDev } from './dev';
import { useDebugAccessVersion } from './store-sync';

const UNLOCK_STORAGE_KEY = 'sonixy.debugUnlocked';
const SETTINGS_CLICKS_TO_UNLOCK = 4;
const SETTINGS_CLICK_RESET_MS = 2000;

function readUnlockedFromStorage(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(UNLOCK_STORAGE_KEY) === '1';
}

class DebugSettingsAccess {
	unlocked = isDev || readUnlockedFromStorage();

	private settingsClickCount = 0;
	private settingsClickResetTimer: ReturnType<typeof setTimeout> | undefined;

	notify() {
		useDebugAccessVersion.getState().bump();
	}

	get visible(): boolean {
		return isDev || this.unlocked;
	}

	unlock(): void {
		if (this.unlocked) return;
		localStorage.setItem(UNLOCK_STORAGE_KEY, '1');
		this.unlocked = true;
		this.notify();
	}

	registerSettingsClick(): void {
		if (this.visible) return;

		this.settingsClickCount += 1;
		clearTimeout(this.settingsClickResetTimer);
		this.settingsClickResetTimer = setTimeout(() => {
			this.settingsClickCount = 0;
		}, SETTINGS_CLICK_RESET_MS);

		if (this.settingsClickCount >= SETTINGS_CLICKS_TO_UNLOCK) {
			this.settingsClickCount = 0;
			clearTimeout(this.settingsClickResetTimer);
			this.unlock();
		}
	}
}

export const debugSettingsAccess = new DebugSettingsAccess();
