import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { isDev } from './dev';

export type UpdateCheckState = 'idle' | 'checking' | 'current' | 'error';

export async function checkForUpdates(silent = false): Promise<UpdateCheckState> {
	if (isDev) {
		if (!silent) {
			await message('Updates are not checked in development builds.', {
				title: 'Updates',
				kind: 'info'
			});
		}
		return 'idle';
	}

	try {
		const update = await check();
		if (!update) {
			if (!silent) {
				await message('Sonixy is up to date.', { title: 'Updates', kind: 'info' });
			}
			return 'current';
		}

		const install = await ask(
			`Sonixy ${update.version} is available.${update.body ? `\n\n${update.body}` : ''}\n\nInstall and restart now?`,
			{ title: 'Update available', kind: 'info', okLabel: 'Install', cancelLabel: 'Later' }
		);

		if (!install) {
			return 'current';
		}

		await update.downloadAndInstall();
		await relaunch();
		return 'current';
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		if (!silent) {
			await message(`Could not check for updates.\n\n${detail}`, {
				title: 'Updates',
				kind: 'error'
			});
		}
		return 'error';
	}
}

export function checkForUpdatesOnStartup(): void {
	if (isDev) return;
	void checkForUpdates(true);
}
