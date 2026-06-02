import { Bug, Folder, Loader2, Plus, Settings } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { debugSettingsAccess } from '@/lib/debug-settings-access';
import {
	collectionDisplayName,
	collectionPathsEqual,
	normalizeCollectionPath
} from '@/lib/collection-path';
import { collectionStore } from '@/lib/collection-store';
import { settingsStore } from '@/lib/settings-store';
import {
	useStoreVersion,
	useCollectionVersion,
	useSettingsVersion,
	useDebugAccessVersion
} from '@/lib/store-sync';
import styles from './Sidebar.module.css';

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

	return (
		<aside className={styles.sidebar}>
			<header className={styles.sidebarHeader}>
				<h2 className={styles.sidebarTitle}>Library</h2>
				<button
					type="button"
					className={styles.addBtn}
					onClick={addLibrary}
					title="Add library"
					aria-label="Add library"
				>
					<Plus size={14} strokeWidth={2.5} />
					<span>Add</span>
				</button>
			</header>

			<nav className={styles.sidebarNav} aria-label="Collections">
				{collections.length === 0 ? (
					<div className={styles.sidebarEmpty}>
						<p>No libraries yet. Use Add to open a folder.</p>
					</div>
				) : (
					<ul className={styles.collectionList}>
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
										className={`${styles.collectionItem} ${isActive ? styles.active : ''} ${isLoading ? styles.loading : ''}`}
										title={collectionPath}
										disabled={collectionStore.switchingCollection}
										onClick={() => switchCollection(collectionPath)}
									>
										<span className={styles.collectionIcon} aria-hidden="true">
											{isLoading ? (
												<Loader2 size={16} className="animate-spin" />
											) : (
												<Folder size={16} />
											)}
										</span>
										<span className={styles.collectionLabel}>
											{collectionDisplayName(collectionPath)}
										</span>
										{fileCount !== null && (
											<span className={styles.collectionCount}>{fileCount}</span>
										)}
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</nav>

			<footer className={styles.sidebarFooter}>
				{showDebugSettings && (
					<Link
						to="/debug-settings"
						className={`${styles.footerLink} ${isDebugSettingsView ? styles.active : ''}`}
						title="Debug"
						draggable={false}
					>
						<Bug size={18} strokeWidth={2} />
						<span>Debug</span>
					</Link>
				)}
				<Link
					to="/settings"
					className={`${styles.footerLink} ${isSettingsView ? styles.active : ''}`}
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
