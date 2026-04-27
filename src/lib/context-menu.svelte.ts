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

export const contextMenuState = $state<ContextMenuState>({
	visible: false,
	x: 0,
	y: 0,
	items: []
});

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]) {
	if (!items || items.length === 0) return;
	contextMenuState.x = x;
	contextMenuState.y = y;
	contextMenuState.items = items;
	contextMenuState.visible = true;
}

export function hideContextMenu() {
	contextMenuState.visible = false;
}
