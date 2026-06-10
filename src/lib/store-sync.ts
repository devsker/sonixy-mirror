import { create } from 'zustand';
import { useSyncExternalStore } from 'react';

export const useSettingsVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

export const useCollectionVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

export const useWaveformProgressVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

export const useAudioVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

export const useContextMenuVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

export const useDebugAccessVersion = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 }))
}));

type VersionStore = {
	getState: () => { version: number };
	subscribe: (listener: () => void) => () => void;
};

export function useStoreVersion(store: VersionStore) {
	return useSyncExternalStore(
		(cb) => store.subscribe(cb),
		() => store.getState().version,
		() => store.getState().version
	);
}
