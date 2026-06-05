import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import version from '../../package.json';
import { isDev } from '@/lib/dev';
import { debugSettingsAccess } from '@/lib/debug-settings-access';
import { collectionStore } from '@/lib/collection-store';
import { settingsStore } from '@/lib/settings-store';
import { audioPlayer } from '@/lib/audio-player';
import {
	useStoreVersion,
	useCollectionVersion,
	useSettingsVersion,
	useAudioVersion,
	useDebugAccessVersion
} from '@/lib/store-sync';

export default function DebugSettingsPage() {
	const navigate = useNavigate();
	useStoreVersion(useDebugAccessVersion);
	useStoreVersion(useCollectionVersion);
	useStoreVersion(useSettingsVersion);
	useStoreVersion(useAudioVersion);

	const canAccess = debugSettingsAccess.visible;

	useEffect(() => {
		if (!debugSettingsAccess.visible) {
			navigate('/settings', { replace: true });
		}
	}, [navigate]);

	function clearLocalSettings() {
		localStorage.removeItem('settings');
		localStorage.removeItem('lastCollectionPath');
		location.reload();
	}

	if (!canAccess) return null;

	return (
		<div className="settings-page settings">
			<h1>Debug</h1>

			<div className="settings-container">
				<section className="settings-section">
					<h2>Environment</h2>
					<dl className="debug-dl">
						<div>
							<dt>Mode</dt>
							<dd>{isDev ? 'Development' : 'Production'}</dd>
						</div>
						<div>
							<dt>Version</dt>
							<dd>{version.version}</dd>
						</div>
					</dl>
				</section>

				<section className="settings-section">
					<h2>Collection</h2>
					<dl className="debug-dl">
						<div>
							<dt>Path</dt>
							<dd className="mono">{collectionStore.collectionPath ?? '—'}</dd>
						</div>
						<div>
							<dt>Files</dt>
							<dd>{collectionStore.files.length}</dd>
						</div>
						<div>
							<dt>Switching</dt>
							<dd>{collectionStore.switchingCollection ? 'yes' : 'no'}</dd>
						</div>
						<div>
							<dt>Switch UI visible</dt>
							<dd>{collectionStore.showSwitchingUi ? 'yes' : 'no'}</dd>
						</div>
						<div>
							<dt>Loading</dt>
							<dd>{collectionStore.loading ? 'yes' : 'no'}</dd>
						</div>
					</dl>
					<button
						type="button"
						className="reset-btn"
						onClick={() => collectionStore.refresh()}
					>
						Rescan collection
					</button>
				</section>

				<section className="settings-section">
					<h2>Playback</h2>
					<dl className="debug-dl">
						<div>
							<dt>Current file</dt>
							<dd className="mono">{audioPlayer.currentFileId ?? '—'}</dd>
						</div>
						<div>
							<dt>Playing</dt>
							<dd>{audioPlayer.isPlaying ? 'yes' : 'no'}</dd>
						</div>
						<div>
							<dt>A–B loop</dt>
							<dd>{audioPlayer.abLoopEnabled ? 'yes' : 'no'}</dd>
						</div>
					</dl>
				</section>

				<section className="settings-section">
					<h2>Storage</h2>
					<button
						type="button"
						className="reset-btn danger"
						onClick={clearLocalSettings}
					>
						Clear localStorage &amp; reload
					</button>
					<p className="description">
						Removes saved settings and last collection path, then reloads the app.
					</p>
					<details className="settings-dump">
						<summary>Current settings JSON</summary>
						<pre>
							{JSON.stringify(
								{
									theme: settingsStore.theme,
									recentCollections: settingsStore.recentCollections,
									titlebarStyle: settingsStore.titlebarStyle,
									titlebarLayout: settingsStore.titlebarLayout
								},
								null,
								2
							)}
						</pre>
					</details>
				</section>
			</div>
		</div>
	);
}
