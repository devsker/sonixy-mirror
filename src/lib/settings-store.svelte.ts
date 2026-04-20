export interface Settings {
    theme: 'system' | 'dark' | 'light';
    showCheckboxes: boolean;
    normalizeOnImport: boolean;
    columnOrder: string[];
    playbackDelay: number; // in milliseconds
}

class SettingsStore {
    theme = $state<'system' | 'dark' | 'light'>('system');
    showCheckboxes = $state(false);
    normalizeOnImport = $state(true);
    columnOrder = $state(['filename', 'format', 'length', 'size', 'tags']);
    playbackDelay = $state(500); // Default to 500ms

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
                } catch (e) {
                    console.error('Failed to parse settings', e);
                }
            }
        }

        $effect.root(() => {
            $effect(() => {
                if (typeof window !== 'undefined') {
                    localStorage.setItem('settings', JSON.stringify({
                        theme: this.theme,
                        showCheckboxes: this.showCheckboxes,
                        normalizeOnImport: this.normalizeOnImport,
                        columnOrder: this.columnOrder,
                        playbackDelay: this.playbackDelay
                    }));
                }
            });
        });
    }
}

export const settingsStore = new SettingsStore();
