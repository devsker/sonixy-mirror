import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { contextMenuState, hideContextMenu } from '@/lib/context-menu';
import { useStoreVersion, useContextMenuVersion } from '@/lib/store-sync';
import styles from './ContextMenu.module.css';

export default function ContextMenu() {
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ x: contextMenuState.x, y: contextMenuState.y });

	const menuTick = useStoreVersion(useContextMenuVersion);

	useLayoutEffect(() => {
		if (!contextMenuState.visible) return;
		if (!menuRef.current) return;
		const { innerWidth, innerHeight } = window;
		const { offsetWidth, offsetHeight } = menuRef.current;
		let x = contextMenuState.x;
		let y = contextMenuState.y;
		if (x + offsetWidth > innerWidth) x = innerWidth - offsetWidth - 10;
		if (y + offsetHeight > innerHeight) y = innerHeight - offsetHeight - 10;
		setPos((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
	}, [menuTick, contextMenuState.visible, contextMenuState.x, contextMenuState.y]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				contextMenuState.visible &&
				menuRef.current &&
				!menuRef.current.contains(event.target as Node)
			) {
				hideContextMenu();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') hideContextMenu();
		};
		window.addEventListener('mousedown', handleClickOutside, true);
		window.addEventListener('keydown', handleKeyDown, true);
		return () => {
			window.removeEventListener('mousedown', handleClickOutside, true);
			window.removeEventListener('keydown', handleKeyDown, true);
		};
	}, []);

	if (!contextMenuState.visible) return null;

	function handleAction(action?: () => void) {
		if (action) action();
		hideContextMenu();
	}

	return (
		<div ref={menuRef} className={styles.contextMenu} style={{ left: pos.x, top: pos.y }}>
			{contextMenuState.items.map((item, i) =>
				item.separator ? (
					<div key={`sep-${i}`} className={styles.separator} />
				) : (
					<button
						key={item.label ?? i}
						type="button"
						className={styles.menuItem}
						disabled={item.disabled}
						onClick={() => handleAction(item.action)}
					>
						{item.label}
					</button>
				)
			)}
		</div>
	);
}
