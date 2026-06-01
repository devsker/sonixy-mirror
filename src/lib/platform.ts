/** Resolved chrome style (never `auto`). */
export type TitlebarStyleId = 'macos' | 'windows' | 'linux';

/** User preference; `auto` follows the native OS. */
export type TitlebarStyleSetting = 'auto' | TitlebarStyleId;

export function isMacOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	return (
		navigator.platform?.toLowerCase().includes('mac') ||
		/Macintosh|Mac OS X/i.test(navigator.userAgent)
	);
}

export function isLinux(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (isMacOS()) return false;
	return /linux/i.test(navigator.platform) || /linux/i.test(navigator.userAgent);
}

export function getNativeTitlebarStyle(): TitlebarStyleId {
	if (isMacOS()) return 'macos';
	if (isLinux()) return 'linux';
	return 'windows';
}

export function resolveTitlebarStyle(setting: TitlebarStyleSetting): TitlebarStyleId {
	if (setting === 'auto') return getNativeTitlebarStyle();
	return setting;
}

export function usesMacTrafficLights(style: TitlebarStyleId): boolean {
	return style === 'macos';
}

export function usesLinuxWindowControls(style: TitlebarStyleId): boolean {
	return style === 'linux';
}

export const TITLEBAR_WINDOW_CONTROLS_ID = 'window-controls';

export function windowControlsPinLeft(style: TitlebarStyleId): boolean {
	return style === 'macos';
}

/** Layout sections with window controls omitted (they are pinned by platform). */
export function parseTitlebarLayout(layout: readonly string[]): {
	left: string[];
	center: string[];
	right: string[];
} {
	const result = { left: [] as string[], center: [] as string[], right: [] as string[] };
	let current: 'left' | 'center' | 'right' = 'left';

	for (const id of layout) {
		if (id === 'section:left') current = 'left';
		else if (id === 'section:center') current = 'center';
		else if (id === 'section:right') current = 'right';
		else if (id !== TITLEBAR_WINDOW_CONTROLS_ID) result[current].push(id);
	}

	return result;
}

export const DEFAULT_TITLEBAR_LAYOUT_MACOS = [
	'section:left',
	'window-controls',
	'title',
	'section:center',
	'playback',
	'volume',
	'section:right',
	'tasks'
] as const;

export const DEFAULT_TITLEBAR_LAYOUT_WINDOWS = [
	'section:left',
	'title',
	'section:center',
	'playback',
	'volume',
	'section:right',
	'tasks',
	'window-controls'
] as const;

/** Linux: title left, controls trailing (GNOME / KDE CSD convention). */
export const DEFAULT_TITLEBAR_LAYOUT_LINUX = [
	'section:left',
	'title',
	'section:center',
	'playback',
	'volume',
	'section:right',
	'tasks',
	'window-controls'
] as const;

const DEFAULT_LAYOUT_BY_STYLE: Record<TitlebarStyleId, readonly string[]> = {
	macos: DEFAULT_TITLEBAR_LAYOUT_MACOS,
	windows: DEFAULT_TITLEBAR_LAYOUT_WINDOWS,
	linux: DEFAULT_TITLEBAR_LAYOUT_LINUX
};

export function getDefaultTitlebarLayout(options?: {
	styleSetting?: TitlebarStyleSetting;
	style?: TitlebarStyleId;
}): string[] {
	const style =
		options?.style ??
		(options?.styleSetting != null
			? resolveTitlebarStyle(options.styleSetting)
			: getNativeTitlebarStyle());
	return [...DEFAULT_LAYOUT_BY_STYLE[style]];
}
