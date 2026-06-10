import { useEffect, useMemo, useRef, useState } from 'react';
import {
	Minus,
	Square,
	X,
	RefreshCw,
	Play,
	Volume2,
	FolderOpen,
	GripVertical,
	SkipBack,
	SkipForward
} from 'lucide-react';
import type { SettingsStore } from '@/lib/settings-store';
import {
	TITLEBAR_WINDOW_CONTROLS_ID,
	resolveTitlebarStyle,
	usesLinuxWindowControls,
	usesMacTrafficLights,
	windowControlsPinLeft
} from '@/lib/platform';
import { useSettingsVersion, useStoreVersion } from '@/lib/store-sync';
import { MacTrafficLights } from './MacTrafficLights';
import { LinuxWindowControls } from './LinuxWindowControls';

const ALL_ELEMENTS = [
	{ id: 'title', label: 'App Title', icon: null as null },
	{ id: 'folder', label: 'Open Folder', icon: FolderOpen },
	{ id: 'playback', label: 'Playback Controls', icon: Play },
	{ id: 'volume', label: 'Volume Slider', icon: Volume2 },
	{ id: 'tasks', label: 'Background Tasks', icon: null as null },
	{ id: 'refresh', label: 'Refresh Button', icon: RefreshCw },
	{ id: 'spacer', label: 'Flexible Spacer', icon: GripVertical }
];

type SectionKey = 'left' | 'center' | 'right';

const TITLEBAR_DRAG_THRESHOLD_PX = 5;

type TitlebarVisualizerProps = {
	settings: SettingsStore;
};

export function TitlebarVisualizer({ settings }: TitlebarVisualizerProps) {
	useStoreVersion(useSettingsVersion);

	const titlebarStyle = resolveTitlebarStyle(settings.titlebarStyle);
	const showMacTrafficLights = usesMacTrafficLights(titlebarStyle);
	const showLinuxWindowControls = usesLinuxWindowControls(titlebarStyle);
	const pinWindowControlsLeft = windowControlsPinLeft(titlebarStyle);

	const [dragOverSection, setDragOverSection] = useState<SectionKey | 'pool' | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const titlebarDragRef = useRef<{
		id: string;
		fromIndex: number | null;
		startX: number;
		startY: number;
		moved: boolean;
	} | null>(null);
	const dragOverRef = useRef<{
		section: SectionKey | 'pool' | null;
		index: number | null;
	}>({ section: null, index: null });

	const sections = useMemo(() => {
		const result: Record<SectionKey, { id: string; index: number }[]> = {
			left: [],
			center: [],
			right: []
		};
		let currentSection: SectionKey = 'left';

		settings.titlebarLayout.forEach((id, index) => {
			if (id === 'section:left') currentSection = 'left';
			else if (id === 'section:center') currentSection = 'center';
			else if (id === 'section:right') currentSection = 'right';
			else if (id !== TITLEBAR_WINDOW_CONTROLS_ID) {
				result[currentSection].push({ id, index });
			}
		});
		return result;
	}, [settings.titlebarLayout]);

	const availableElements = ALL_ELEMENTS.filter(
		(e) => e.id === 'spacer' || !settings.titlebarLayout.includes(e.id)
	);

	const resetDragState = () => {
		titlebarDragRef.current = null;
		dragOverRef.current = { section: null, index: null };
		setDragOverSection(null);
		setDragOverIndex(null);
	};

	const commitTitlebarDrop = (
		sourceId: string,
		sourceIndex: number | null,
		targetSection: SectionKey | 'pool',
		targetLocalIndex: number | null
	) => {
		const newLayout = [...settings.titlebarLayout];

		if (sourceIndex !== null) {
			newLayout.splice(sourceIndex, 1);
		}

		if (targetSection !== 'pool') {
			const sectionMarker = `section:${targetSection}`;
			const markerIndex = newLayout.indexOf(sectionMarker);

			let insertIndex: number;
			if (targetLocalIndex === null) {
				const nextMarkers = ['section:left', 'section:center', 'section:right'].filter(
					(m) => m !== sectionMarker
				);
				let nextMarkerIndex = newLayout.length;
				for (const m of nextMarkers) {
					const idx = newLayout.indexOf(m);
					if (idx > markerIndex && idx < nextMarkerIndex) {
						nextMarkerIndex = idx;
					}
				}
				insertIndex = nextMarkerIndex;
			} else {
				insertIndex = markerIndex + 1 + targetLocalIndex;
			}

			newLayout.splice(insertIndex, 0, sourceId);
		}

		settings.titlebarLayout = newLayout;
		settings.notify();
	};

	const beginTitlebarDrag = (id: string, fromIndex: number | null, clientX: number, clientY: number) => {
		titlebarDragRef.current = {
			id,
			fromIndex,
			startX: clientX,
			startY: clientY,
			moved: false
		};
		setDragOverSection(null);
		setDragOverIndex(null);
		dragOverRef.current = { section: null, index: null };
	};

	const updateTitlebarDropTarget = (clientX: number, clientY: number) => {
		const el = document.elementFromPoint(clientX, clientY);
		const dropTarget = el?.closest<HTMLElement>('[data-titlebar-drop]');
		if (!dropTarget) return;

		const section = dropTarget.dataset.titlebarSection as SectionKey | 'pool' | undefined;
		if (!section) return;

		const indexStr = dropTarget.dataset.titlebarIndex;
		const index =
			indexStr === undefined || indexStr === '' ? null : Number.parseInt(indexStr, 10);

		dragOverRef.current = { section, index };
		setDragOverSection(section);
		setDragOverIndex(index);
	};

	useEffect(() => {
		const onMouseMove = (e: globalThis.MouseEvent) => {
			const drag = titlebarDragRef.current;
			if (!drag) return;

			const dx = e.clientX - drag.startX;
			const dy = e.clientY - drag.startY;
			if (!drag.moved) {
				if (dx * dx + dy * dy < TITLEBAR_DRAG_THRESHOLD_PX * TITLEBAR_DRAG_THRESHOLD_PX) return;
				drag.moved = true;
			}

			updateTitlebarDropTarget(e.clientX, e.clientY);
		};

		const onMouseUp = () => {
			const drag = titlebarDragRef.current;
			if (!drag) return;

			if (drag.moved) {
				const { section, index } = dragOverRef.current;
				if (section) {
					commitTitlebarDrop(drag.id, drag.fromIndex, section, index);
				}
			}

			resetDragState();
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [settings.titlebarLayout]);

	const removeElement = (index: number) => {
		const newLayout = [...settings.titlebarLayout];
		newLayout.splice(index, 1);
		settings.titlebarLayout = newLayout;
		settings.notify();
	};

	const windowControls = (
		<div className="window-controls">
			{showMacTrafficLights ? (
				<MacTrafficLights preview />
			) : showLinuxWindowControls ? (
				<LinuxWindowControls preview />
			) : (
				<>
					<button type="button" className="control-btn" aria-label="Minimize">
						<Minus size={14} />
					</button>
					<button type="button" className="control-btn" aria-label="Maximize">
						<Square size={12} />
					</button>
					<button type="button" className="control-btn close-btn" aria-label="Close">
						<X size={14} />
					</button>
				</>
			)}
		</div>
	);

	const renderPreviewElement = (id: string) => {
		if (id === 'title') {
			return (
				<div className="title-container draggable-element">
					<span className="title">Sonixy</span>
				</div>
			);
		}
		if (id === 'folder') {
			return (
				<button type="button" className="folder-btn draggable-element" aria-label="Open Collection">
					<FolderOpen size={14} />
				</button>
			);
		}
		if (id === 'playback') {
			return (
				<div className="playback-controls draggable-element">
					<button type="button" className="playback-btn" aria-label="Previous">
						<SkipBack size={14} fill="currentColor" />
					</button>
					<button type="button" className="playback-btn play-pause" aria-label="Play">
						<Play size={16} fill="currentColor" />
					</button>
					<button type="button" className="playback-btn" aria-label="Next">
						<SkipForward size={14} fill="currentColor" />
					</button>
				</div>
			);
		}
		if (id === 'volume') {
			return (
				<div className="volume-control draggable-element">
					<button type="button" className="playback-btn">
						<Volume2 size={14} />
					</button>
					<div className="volume-slider-mock" />
				</div>
			);
		}
		if (id === 'tasks') {
			return (
				<div className="task-container draggable-element">
					<button type="button" className="control-btn task-btn" aria-label="Background Tasks">
						<svg width="18" height="18" viewBox="0 0 18 18">
							<circle
								cx="9"
								cy="9"
								r="7"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								opacity="0.2"
							/>
							<circle
								cx="9"
								cy="9"
								r="7"
								fill="none"
								stroke="var(--accent-color)"
								strokeWidth="2"
								strokeDasharray="44"
								strokeDashoffset="11"
								strokeLinecap="round"
								transform="rotate(-90 9 9)"
							/>
						</svg>
					</button>
				</div>
			);
		}
		if (id === 'refresh') {
			return (
				<button type="button" className="control-btn draggable-element" aria-label="Refresh">
					<RefreshCw size={14} />
				</button>
			);
		}
		if (id === 'spacer') {
			return (
				<div className="spacer draggable-element">
					<div className="spacer-handle">
						<GripVertical size={10} />
					</div>
				</div>
			);
		}
		return null;
	};

	const sectionKeys: SectionKey[] = ['left', 'center', 'right'];
	const sectionAreaClass: Record<SectionKey, string> = {
		left: 'titlebar-left',
		center: 'titlebar-center',
		right: 'titlebar-right'
	};

	return (
		<div className="titlebar-visualizer" role="presentation">
			<div className="titlebar-mock">
				{pinWindowControlsLeft && (
					<div className="titlebar-pinned titlebar-pinned-left">{windowControls}</div>
				)}

				{sectionKeys.map((section) => {
					const sectionData = sections[section];
					return (
						<div
							key={section}
							data-titlebar-drop
							data-titlebar-section={section}
							className={`titlebar-section ${sectionAreaClass[section]} droppable-section${dragOverSection === section && dragOverIndex === null ? ' droppable-section-drag-over' : ''}`}
							role="presentation"
						>
							{sectionData.map((item, i) => (
								<div
									key={`${item.index}-${item.id}`}
									data-titlebar-drop
									data-titlebar-section={section}
									data-titlebar-index={i}
									className={`element-wrapper${dragOverSection === section && dragOverIndex === i ? ' drop-target' : ''}`}
									role="presentation"
									onMouseDown={(e) => {
										if (e.button !== 0) return;
										beginTitlebarDrag(item.id, item.index, e.clientX, e.clientY);
									}}
								>
									{renderPreviewElement(item.id)}
									<button
										type="button"
										className="remove-btn"
										onClick={() => removeElement(item.index)}
										title="Remove"
									>
										<X size={8} />
									</button>
								</div>
							))}
							{sectionData.length === 0 && <div className="empty-placeholder">Empty</div>}
						</div>
					);
				})}

				{!pinWindowControlsLeft && (
					<div className="titlebar-pinned titlebar-pinned-right">{windowControls}</div>
				)}
			</div>

			<div className="pool-container">
				<div
					data-titlebar-drop
					data-titlebar-section="pool"
					className={`element-pool${dragOverSection === 'pool' ? ' element-pool-drag-over' : ''}`}
					role="presentation"
				>
					<div className="pool-label">Available:</div>
					{availableElements.map((el, i) => {
						const Icon = el.icon;
						return (
							<div
								key={`${el.id}-${i}`}
								className="pool-item"
								role="presentation"
								title={el.label}
								onMouseDown={(e) => {
									if (e.button !== 0) return;
									beginTitlebarDrag(el.id, null, e.clientX, e.clientY);
								}}
							>
								{Icon ? (
									<Icon size={14} />
								) : el.id === 'title' ? (
									<span className="pool-text-icon">T</span>
								) : el.id === 'tasks' ? (
									<div
										className="circle-mock"
										style={{ width: 10, height: 10, borderWidth: 1 }}
									/>
								) : (
									<span className="pool-text-icon">{el.label[0]}</span>
								)}
							</div>
						);
					})}
					{availableElements.length === 0 && <div className="empty-pool">None left</div>}
				</div>
			</div>
		</div>
	);
}
