import { getDefaultTitlebarLayout, type TitlebarStyleSetting } from './platform';
import { useSettingsVersion } from './store-sync';

export interface CollectionUiState {
	filenameQuery?: string;
	sortColumn?: string | null;
	sortDirection?: 'asc' | 'desc';
	selectedFormats?: string[];
	selectedTags?: string[];
}

export interface Settings {
	theme: 'system' | 'dark' | 'light';
	showCheckboxes: boolean;
	normalizeOnImport: boolean;
	columnOrder: string[];
	playbackDelay: number;
	titlebarLayout: string[];
	titlebarStyle: TitlebarStyleSetting;
	volume: number;
	sortColumn: string | null;
	sortDirection: 'asc' | 'desc';
	selectedFormats: string[];
	selectedTags: string[];
	filenameQuery: string;
	recentCollections: string[];
	collectionUiByPath: Record<string, CollectionUiState>;
}

const RECENT_COLLECTIONS_MAX = 8;

export class SettingsStore {
	theme: 'system' | 'dark' | 'light' = 'system';
	showCheckboxes = false;
	normalizeOnImport = true;
	columnOrder: string[] = ['filename', 'format', 'length', 'size', 'tags'];
	playbackDelay = 500;
	titlebarLayout: string[] = getDefaultTitlebarLayout();
	titlebarStyle: TitlebarStyleSetting = 'auto';
	volume = 1;
	sortColumn: string | null = null;
	sortDirection: 'asc' | 'desc' = 'asc';
	selectedFormats: string[] = [];
	selectedTags: string[] = [];
	filenameQuery = '';
	recentCollections: string[] = [];
	collectionUiByPath: Record<string, CollectionUiState> = {};

	constructor() {
		if (typeof window !== 'undefined') {
			const savedSettings = localStorage.getItem('settings');
			if (savedSettings) {
				try {
					const parsed = JSON.parse(savedSettings);
					this.theme = parsed.theme || 'system';
					this.showCheckboxes = parsed.showCheckboxes ?? false;
					this.normalizeOnImport = parsed.normalizeOnImport ?? true;
					this.columnOrder = parsed.columnOrder || ['filename', 'format', 'length', 'size', 'tags'];
					this.playbackDelay = parsed.playbackDelay ?? 500;
					this.volume = parsed.volume ?? 1;
					this.sortColumn = parsed.sortColumn ?? null;
					this.sortDirection = parsed.sortDirection ?? 'asc';
					this.selectedFormats = parsed.selectedFormats ?? [];
					this.selectedTags = parsed.selectedTags ?? [];
					this.filenameQuery = parsed.filenameQuery ?? '';
					this.recentCollections = parsed.recentCollections ?? [];
					this.collectionUiByPath = parsed.collectionUiByPath ?? {};

					if (
						parsed.titlebarStyle === 'macos' ||
						parsed.titlebarStyle === 'windows' ||
						parsed.titlebarStyle === 'linux'
					) {
						this.titlebarStyle = parsed.titlebarStyle;
					} else if (parsed.titlebarStyle === 'auto') {
						this.titlebarStyle = 'auto';
					} else if (parsed.forceWindowsTitlebar === true) {
						this.titlebarStyle = 'windows';
					}

					if (parsed.titlebarLayout) {
						if (!Array.isArray(parsed.titlebarLayout)) {
							const layout = parsed.titlebarLayout;
							this.titlebarLayout = [
								'section:left',
								...(layout.left || []),
								'section:center',
								...(layout.center || []),
								'section:right',
								...(layout.right || [])
							];
						} else {
							this.titlebarLayout = parsed.titlebarLayout.filter((id: string) => id !== 'loop');
						}
					}
				} catch (e) {
					console.error('Failed to parse settings', e);
				}
			}
		}
	}

	notify() {
		useSettingsVersion.getState().bump();
		this.persist();
	}

	private persist() {
		if (typeof window === 'undefined') return;
		localStorage.setItem(
			'settings',
			JSON.stringify({
				theme: this.theme,
				showCheckboxes: this.showCheckboxes,
				normalizeOnImport: this.normalizeOnImport,
				columnOrder: this.columnOrder,
				playbackDelay: this.playbackDelay,
				titlebarLayout: this.titlebarLayout,
				titlebarStyle: this.titlebarStyle,
				volume: this.volume,
				sortColumn: this.sortColumn,
				sortDirection: this.sortDirection,
				selectedFormats: this.selectedFormats,
				selectedTags: this.selectedTags,
				filenameQuery: this.filenameQuery,
				recentCollections: this.recentCollections,
				collectionUiByPath: this.collectionUiByPath
			})
		);
	}

	addRecentCollection(path: string) {
		const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
		const exists = this.recentCollections.some(
			(p) => p.replace(/\\/g, '/').replace(/\/+$/, '') === normalized
		);
		if (exists) return;

		this.recentCollections = [...this.recentCollections, normalized].slice(-RECENT_COLLECTIONS_MAX);
		this.notify();
	}

	removeRecentCollection(path: string) {
		const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
		this.recentCollections = this.recentCollections.filter(
			(p) => p.replace(/\\/g, '/').replace(/\/+$/, '') !== normalized
		);
		this.notify();
	}

	stashCollectionUi(path: string | null) {
		if (!path) return;
		const key = path.replace(/\\/g, '/').replace(/\/+$/, '');
		this.collectionUiByPath = {
			...this.collectionUiByPath,
			[key]: {
				filenameQuery: this.filenameQuery,
				sortColumn: this.sortColumn,
				sortDirection: this.sortDirection,
				selectedFormats: [...this.selectedFormats],
				selectedTags: [...this.selectedTags]
			}
		};
		this.notify();
	}

	applyCollectionUi(path: string) {
		const key = path.replace(/\\/g, '/').replace(/\/+$/, '');
		const ui = this.collectionUiByPath[key];
		this.filenameQuery = ui?.filenameQuery ?? '';
		this.sortColumn = ui?.sortColumn ?? null;
		this.sortDirection = ui?.sortDirection ?? 'asc';
		this.selectedFormats = ui?.selectedFormats ? [...ui.selectedFormats] : [];
		this.selectedTags = ui?.selectedTags ? [...ui.selectedTags] : [];
		this.notify();
	}
}

export const settingsStore = new SettingsStore();
