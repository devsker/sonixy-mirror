import { useState } from 'react';
import { getDefaultTitlebarLayout, type TitlebarStyleSetting } from '@/lib/platform';
import { collectionStore } from '@/lib/collection-store';
import { settingsStore } from '@/lib/settings-store';
import { useStoreVersion, useSettingsVersion } from '@/lib/store-sync';
import { TitlebarVisualizer } from '@/components/TitlebarVisualizer';
import { checkForUpdates, type UpdateCheckState } from '@/lib/updater';
import version from '../../package.json';

export default function SettingsPage() {
	useStoreVersion(useSettingsVersion);
	const [updateState, setUpdateState] = useState<UpdateCheckState>('idle');

	return (
		<div className="settings-page settings">
			<h1>Settings</h1>

			<div className="settings-container">
				<section className="settings-section">
					<h2>Interface</h2>

					<div className="setting-item">
						<label htmlFor="theme">Color Theme</label>
						<div className="select-wrapper">
							<select
								id="theme"
								value={settingsStore.theme}
								onChange={(e) => {
									settingsStore.theme = e.target.value as 'system' | 'dark' | 'light';
									settingsStore.notify();
								}}
							>
								<option value="system">System Default</option>
								<option value="dark">Dark</option>
								<option value="light">Light</option>
							</select>
						</div>
						<p className="description">
							Select the theme that Sonixy will use for the interface.
						</p>
					</div>

					<div className="setting-item">
						<div className="checkbox-setting">
							<label className="checkbox">
								<input
									type="checkbox"
									id="showCheckboxes"
									checked={settingsStore.showCheckboxes}
									onChange={(e) => {
										settingsStore.showCheckboxes = e.target.checked;
										settingsStore.notify();
									}}
								/>
								<span className="checkbox-mark" />
							</label>
							<label htmlFor="showCheckboxes" className="checkbox-label">
								Show Selection Checkboxes
							</label>
						</div>
						<p className="description">
							Show or hide the selection checkboxes in the file list.
						</p>
					</div>

					<div className="setting-item">
						<label htmlFor="titlebarStyle">Titlebar style</label>
						<div className="select-wrapper">
							<select
								id="titlebarStyle"
								value={settingsStore.titlebarStyle}
								onChange={(e) => {
									settingsStore.titlebarStyle = e.target.value as TitlebarStyleSetting;
									settingsStore.notify();
								}}
							>
								<option value="auto">Auto (match OS)</option>
								<option value="macos">macOS</option>
								<option value="windows">Windows</option>
								<option value="linux">Linux</option>
							</select>
						</div>
						<p className="description">
							Controls window buttons and the default layout preset. Auto uses macOS traffic lights
							on Mac, Windows controls on Windows, and GNOME-style header buttons on Linux.
						</p>
					</div>

					<div className="setting-item">
						<h3>Titlebar Layout</h3>
						<TitlebarVisualizer settings={settingsStore} />
						<button
							type="button"
							className="reset-btn"
							onClick={() => {
								settingsStore.titlebarLayout = getDefaultTitlebarLayout({
									styleSetting: settingsStore.titlebarStyle
								});
								settingsStore.notify();
							}}
						>
							Reset Titlebar Layout
						</button>
						<p className="description">
							Drag and drop elements to customize the titlebar layout. Window controls are always
							pinned (left on macOS, right on Windows and Linux) and are not movable.
						</p>
					</div>

					<div className="setting-item">
						<h3>Column Order</h3>
						<button
							type="button"
							className="reset-btn"
							onClick={() => {
								settingsStore.columnOrder = ['filename', 'format', 'length', 'size', 'tags'];
								settingsStore.notify();
							}}
						>
							Reset Column Order
						</button>
						<p className="description">
							Reset the file list columns to their default order.
						</p>
					</div>
				</section>

				<section className="settings-section">
					<h2>Playback</h2>

					<div className="setting-item">
						<label htmlFor="playbackDelay">Replay delay (ms)</label>
						<input
							type="range"
							id="playbackDelay"
							min={0}
							max={2000}
							step={100}
							value={settingsStore.playbackDelay}
							onChange={(e) => {
								settingsStore.playbackDelay = parseInt(e.target.value, 10);
								settingsStore.notify();
							}}
						/>
						<div className="range-value">{settingsStore.playbackDelay}ms</div>
						<p className="description">
							Pause before replaying clips shorter than 2 seconds. Longer clips replay immediately
							when they end.
						</p>
					</div>

					<div className="setting-item">
						<h3>Keyboard shortcuts</h3>
						<ul className="shortcut-list">
							<li>
								<kbd>Space</kbd> <kbd>K</kbd> Play / pause
							</li>
							<li>
								<kbd>I</kbd> <kbd>O</kbd> Set selection in / out
							</li>
							<li>
								<kbd>X</kbd> Clear selection
							</li>
							<li>
								<kbd>J</kbd> <kbd>L</kbd> Slower / faster (keeps pitch; needs FFmpeg)
							</li>
							<li>
								<kbd>←</kbd> <kbd>→</kbd> Previous / next file
							</li>
							<li>
								<kbd>M</kbd> Mute / unmute
							</li>
							<li>
								<kbd>Esc</kbd> Stop playback
							</li>
						</ul>
					</div>
				</section>

				<section className="settings-section">
					<h2>Collection</h2>

					{settingsStore.recentCollections.length > 0 && (
						<div className="setting-item">
							<h3>Recent libraries</h3>
							<ul className="recent-list">
								{settingsStore.recentCollections.map((path) => (
									<li key={path} className="recent-list-item">
										<button
											type="button"
											className="recent-open-btn"
											onClick={() => collectionStore.openCollectionByPath(path)}
										>
											{path}
										</button>
										<button
											type="button"
											className="recent-remove-btn"
											aria-label="Remove from recent"
											onClick={() => settingsStore.removeRecentCollection(path)}
										>
											×
										</button>
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="setting-item">
						<div className="checkbox-setting">
							<label className="checkbox">
								<input
									type="checkbox"
									id="normalizeOnImport"
									checked={settingsStore.normalizeOnImport}
									onChange={(e) => {
										settingsStore.normalizeOnImport = e.target.checked;
										settingsStore.notify();
									}}
								/>
								<span className="checkbox-mark" />
							</label>
							<label htmlFor="normalizeOnImport" className="checkbox-label">
								Normalize on Import
							</label>
						</div>
						<p className="description">
							Actually process and normalize audio files to target a consistent volume level (EBU
							R128).{' '}
							<strong>
								Warning: This is a destructive process that overwrites the original file on disk.
							</strong>
						</p>
					</div>

					<div className="setting-item">
						<h3>Waveforms</h3>
						<button
							type="button"
							className="reset-btn"
							onClick={() => collectionStore.regenerateWaveforms()}
						>
							Re-generate All Waveforms
						</button>
						<p className="description">
							Clears and re-processes all waveforms in the current collection. Useful if waveforms
							appear corrupted or missing.
						</p>
					</div>
				</section>

				<section className="settings-section">
					<h2>Updates</h2>
					<div className="setting-item">
						<p>Sonixy v{version.version}</p>
						<button
							type="button"
							className="reset-btn"
							disabled={updateState === 'checking'}
							onClick={() => {
								setUpdateState('checking');
								void checkForUpdates(false).then((state) => setUpdateState(state));
							}}
						>
							{updateState === 'checking' ? 'Checking…' : 'Check for updates'}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
