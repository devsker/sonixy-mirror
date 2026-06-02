import { useContextMenuVersion } from './store-sync';

export interface ContextMenuItem {
	label?: string;
	action?: () => void;
	disabled?: boolean;
	separator?: boolean;
}

interface ContextMenuState {
	visible: boolean;
	x: number;
	y: number;
	items: ContextMenuItem[];
}

export const contextMenuState: ContextMenuState = {
	visible: false,
	x: 0,
	y: 0,
	items: []
};

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]) {
	if (!items || items.length === 0) return;
	contextMenuState.x = x;
	contextMenuState.y = y;
	contextMenuState.items = items;
	contextMenuState.visible = true;
	useContextMenuVersion.getState().bump();
}

export function hideContextMenu() {
	contextMenuState.visible = false;
	useContextMenuVersion.getState().bump();
}
