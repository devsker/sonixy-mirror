import { Bug, Folder, Loader2, Plus, Settings, Upload } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { debugSettingsAccess } from '@/lib/debug-settings-access';
import {
	collectionDisplayName,
	collectionPathsEqual,
	normalizeCollectionPath
} from '@/lib/collection-path';
import { showContextMenu } from '@/lib/context-menu';
import { collectionStore } from '@/lib/collection-store';
import { settingsStore } from '@/lib/settings-store';
import {
	useStoreVersion,
	useCollectionVersion,
	useSettingsVersion,
	useDebugAccessVersion
} from '@/lib/store-sync';

export default function Sidebar() {
	useStoreVersion(useCollectionVersion);
	useStoreVersion(useSettingsVersion);
	useStoreVersion(useDebugAccessVersion);
	const location = useLocation();
	const navigate = useNavigate();

	const paths = [...settingsStore.recentCollections];
	const current = collectionStore.collectionPath;
	if (current) {
		const normalized = normalizeCollectionPath(current);
		const exists = paths.some((p) => collectionPathsEqual(p, current));
		if (!exists) paths.push(normalized);
	}
	const collections = paths;

	const isLibraryView = location.pathname === '/';
	const isSettingsView = location.pathname === '/settings';
	const isDebugSettingsView = location.pathname === '/debug-settings';
	const showDebugSettings = debugSettingsAccess.visible;

	function onSettingsClick() {
		debugSettingsAccess.registerSettingsClick();
	}

	async function switchCollection(path: string) {
		if (collectionStore.switchingCollection) return;
		if (!isLibraryView) navigate('/');
		await collectionStore.openCollectionByPath(path);
	}

	async function addLibrary() {
		if (!isLibraryView) navigate('/');
		await collectionStore.openCollection();
	}

	async function importLibrary() {
		if (!isLibraryView) navigate('/');
		await collectionStore.importLibrary();
	}

	function onCollectionContextMenu(
		event: React.MouseEvent,
		collectionPath: string,
		isActive: boolean
	) {
		if (!isActive) return;
		event.preventDefault();
		const busy = collectionStore.switchingCollection;
		showContextMenu(event.clientX, event.clientY, [
			{
				label: 'Export library…',
				action: () => {
					void collectionStore.exportLibrary();
				},
				disabled: busy || !collectionStore.collectionPath || collectionStore.loading
			},
			{ separator: true },
			{
				label: 'Unload library',
				action: () => {
					void collectionStore.unloadLibrary();
				},
				disabled: busy || !collectionStore.collectionPath
			},
			{
				label: 'Delete library…',
				action: () => {
					void collectionStore.removeLibrary(collectionPath);
				},
				disabled: busy
			}
		]);
	}

	return (
		<aside className="sidebar">
			<header className="sidebar-header">
				<h2 className="sidebar-title">Library</h2>
				<div className="header-actions">
					<button
						type="button"
						className="add-btn"
						onClick={importLibrary}
						title="Import library"
						aria-label="Import library"
					>
						<Upload size={14} strokeWidth={2.5} />
						<span>Import</span>
					</button>
					<button
						type="button"
						className="add-btn"
						onClick={addLibrary}
						title="Add library"
						aria-label="Add library"
					>
						<Plus size={14} strokeWidth={2.5} />
						<span>Add</span>
					</button>
				</div>
			</header>

			<nav className="sidebar-nav" aria-label="Collections">
				{collections.length === 0 ? (
					<div className="sidebar-empty">
						<p>No libraries yet. Use Add to open a folder.</p>
					</div>
				) : (
					<ul className="collection-list">
						{collections.map((collectionPath) => {
							const isActive =
								isLibraryView &&
								collectionPathsEqual(collectionStore.collectionPath, collectionPath);
							const isLoading =
								collectionStore.showSwitchingUi &&
								collectionPathsEqual(collectionStore.switchingToPath, collectionPath);
							const fileCount =
								isActive && !collectionStore.showSwitchingUi ? collectionStore.files.length : null;
							return (
								<li key={collectionPath}>
									<button
										type="button"
										className={`collection-item${isActive ? ' active' : ''}${isLoading ? ' loading' : ''}`}
										title={collectionPath}
										disabled={collectionStore.switchingCollection}
										onClick={() => switchCollection(collectionPath)}
										onContextMenu={(e) =>
											onCollectionContextMenu(e, collectionPath, isActive)
										}
									>
										<span className="collection-icon" aria-hidden="true">
											{isLoading ? (
												<Loader2 size={16} className="animate-spin" />
											) : (
												<Folder size={16} />
											)}
										</span>
										<span className="collection-label">
											{collectionDisplayName(collectionPath)}
										</span>
										{fileCount !== null && (
											<span className="collection-count">{fileCount}</span>
										)}
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</nav>

			<footer className="sidebar-footer">
				{showDebugSettings && (
					<Link
						to="/debug-settings"
						className={`footer-link${isDebugSettingsView ? ' active' : ''}`}
						title="Debug"
						draggable={false}
					>
						<Bug size={18} strokeWidth={2} />
						<span>Debug</span>
					</Link>
				)}
				<Link
					to="/settings"
					className={`footer-link${isSettingsView ? ' active' : ''}`}
					title="Settings"
					draggable={false}
					onClick={onSettingsClick}
				>
					<Settings size={18} strokeWidth={2} />
					<span>Settings</span>
				</Link>
			</footer>
		</aside>
	);
}
