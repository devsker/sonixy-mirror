import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	ChevronUp,
	ChevronDown,
	Filter,
	FolderOpen,
	FolderSearch,
	Loader2,
	AlertTriangle,
	Trash2,
	Circle,
	Plus,
	Upload,
	X
} from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { settingsStore } from '@/lib/settings-store';
import { collectionDisplayName } from '@/lib/collection-path';
import { showContextMenu } from '@/lib/context-menu';
import { collectionStore, type FileItem } from '@/lib/collection-store';
import { audioPlayer } from '@/lib/audio-player';
import {
	useStoreVersion,
	useCollectionVersion,
	useSettingsVersion,
	useAudioVersion,
	useWaveformProgressVersion
} from '@/lib/store-sync';
import { useExternalFileDrag } from '@/lib/use-external-file-drag';
import type { ExternalFileDragOptions } from '@/lib/file-drag';
import {
	filterExternalDropPaths,
	handleExternalFileDrop,
	isPhysicalPointInElement
} from '@/lib/external-drop';
import { promptPickTag, promptRemoveFile, promptTagName } from '@/lib/native-dialog';

const COLUMN_DRAG_THRESHOLD_PX = 5;

const columnConfigs: Record<
	string,
	{ label: string; sortable?: boolean; filterable?: 'format' | 'tags' }
> = {
	filename: { label: 'Filename', sortable: true },
	format: { label: 'Format', filterable: 'format' },
	length: { label: 'Length', sortable: true },
	size: { label: 'Size', sortable: true },
	tags: { label: 'Tags', filterable: 'tags' }
};

function getDisplayName(filename: string) {
	return filename.replace(/\.[^/.]+$/, '');
}

type FileListProps = {
	onSelectionChange?: (ids: string[]) => void;
};

function FileProcessingIndicatorActive({ fileId }: { fileId: string }) {
	useStoreVersion(useWaveformProgressVersion);

	const progress = collectionStore.waveformProgress[fileId] || 0;
	const processingPaused = collectionStore.processingPaused;

	return (
		<span
			className={`processing-icon${processingPaused ? ' processing-icon-paused' : ''}`}
			title="Processing..."
		>
			<svg className="progress-circle" viewBox="0 0 16 16">
				<circle className="bg" cx="8" cy="8" r="6" />
				<circle
					className="fg"
					cx="8"
					cy="8"
					r="6"
					strokeDasharray={2 * Math.PI * 6}
					strokeDashoffset={2 * Math.PI * 6 * (1 - progress)}
				/>
			</svg>
		</span>
	);
}

function FileProcessingIndicator({ fileId }: { fileId: string }) {
	useStoreVersion(useCollectionVersion);

	if (!collectionStore.processingFiles.has(fileId)) return null;

	if (collectionStore.currentlyProcessingIds.has(fileId)) {
		return <FileProcessingIndicatorActive fileId={fileId} />;
	}

	return (
		<span
			className={`processing-icon processing-icon-queued${collectionStore.processingPaused ? ' processing-icon-paused' : ''}`}
			title="Queued"
		>
			<Circle size={10} strokeWidth={3} />
		</span>
	);
}

type FileRowProps = {
	file: FileItem;
	index: number;
	showCheckboxes: boolean;
	columnOrder: string[];
	collectionPath: string | null;
	taggingFileId: string | null;
	newTagValue: string;
	onTagInputRef: (el: HTMLInputElement | null) => void;
	onNewTagValueChange: (value: string) => void;
	onSelection: (event: MouseEvent, index: number) => void;
	onContextMenu: (event: MouseEvent, file: FileItem) => void;
	onCloseTagDialog: () => void;
	onAddTag: () => void;
	onRemoveTag: (file: FileItem, tag: string) => void;
	onStartTagging: (file: FileItem) => void;
};

const FileRow = memo(function FileRow({
	file,
	index,
	showCheckboxes,
	columnOrder,
	collectionPath,
	taggingFileId,
	newTagValue,
	onTagInputRef,
	onNewTagValueChange,
	onSelection,
	onContextMenu,
	onCloseTagDialog,
	onAddTag,
	onRemoveTag,
	onStartTagging
}: FileRowProps) {
	const dragOptions: ExternalFileDragOptions = {
		disabled: () => file.missing || !collectionPath,
		getPaths: () => {
			if (file.missing || !collectionPath) return [];
			const selectedFiles = collectionStore.files.filter((f) => f.selected && !f.missing);
			if (file.selected) {
				return selectedFiles.map((f) => `${collectionPath}/${f.filepath}`.replace(/[/\\]+/g, '/'));
			}
			return [`${collectionPath}/${file.filepath}`.replace(/[/\\]+/g, '/')];
		}
	};

	const setRowRef = useExternalFileDrag(dragOptions);

	const isLocked = collectionStore.isLocked(file.id);

	return (
		<tr
			ref={setRowRef}
			className={`file-row${file.selected ? ' file-row-selected' : ''}${file.missing ? ' file-row-missing' : ''}${isLocked ? ' file-row-locked' : ''}`}
			onClick={(e) => onSelection(e, index)}
			onKeyDown={(e) => e.key === 'Enter' && onSelection(e as unknown as MouseEvent, index)}
			onContextMenu={(e) => onContextMenu(e, file)}
			tabIndex={0}
		>
			{showCheckboxes && (
				<td className="checkbox-col">
					<label className="checkbox">
						<input
							type="checkbox"
							checked={file.selected}
							onChange={(e) => onSelection(e as unknown as MouseEvent, index)}
						/>
						<span className="checkbox-mark" />
					</label>
				</td>
			)}
			{columnOrder.map((columnId) => {
				if (columnId === 'filename') {
					return (
						<td key={columnId} className="filename-col" title={file.filename}>
							<div className="name-wrapper">
								<FileProcessingIndicator fileId={file.id} />
								{file.missing && (
									<span className="warning-icon" title="File not found">
										<AlertTriangle size={14} />
									</span>
								)}
								<span
									className={audioPlayer.currentFileId === file.id ? "playing" : undefined}
								>
									{getDisplayName(file.filename)}
								</span>
							</div>
						</td>
					);
				}
				if (columnId === 'format') {
					return (
						<td key={columnId} className="format-col">
							{file.missing ? (
								<div className="missing-actions">
									<button
										type="button"
										className="action-icon"
										onClick={(e) => {
											e.stopPropagation();
											collectionStore.relocateFile(file.id);
										}}
										title="Locate file"
									>
										<FolderSearch size={14} />
									</button>
									<button
										type="button"
										className="action-icon action-icon-danger"
										onClick={(e) => {
											e.stopPropagation();
											collectionStore.removeFile(file.id);
										}}
										title="Remove from collection"
									>
										<Trash2 size={14} />
									</button>
								</div>
							) : (
								file.format
							)}
						</td>
					);
				}
				if (columnId === 'length') {
					return (
						<td key={columnId} className="length-col">
							{file.missing ? '-' : file.length}
						</td>
					);
				}
				if (columnId === 'size') {
					return (
						<td key={columnId} className="size-col">
							{file.missing ? '-' : file.size}
						</td>
					);
				}
				if (columnId === 'tags') {
					return (
						<td key={columnId} className="tags-col">
							{!file.missing && (
								<div className="tags-wrapper">
									{file.tags.map((tag) => (
										<span key={tag} className="tag">
											{tag}
											<button
												type="button"
												className="tag-remove"
												onClick={(e) => {
													e.stopPropagation();
													onRemoveTag(file, tag);
												}}
												title="Remove tag"
											>
												<X size={10} />
											</button>
										</span>
									))}

									{taggingFileId === file.id ? (
										<span className="tag tag-tagging">
											<span className="input-mirror">{newTagValue || 'Tag...'}</span>
											<input
												type="text"
												className="tag-input-inline"
												ref={onTagInputRef}
												value={newTagValue}
												onChange={(e) => onNewTagValueChange(e.target.value)}
												size={1}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														e.stopPropagation();
														onAddTag();
													}
													if (e.key === 'Escape') {
														e.stopPropagation();
														onCloseTagDialog();
													}
												}}
												onBlur={() => {
													setTimeout(onCloseTagDialog, 100);
												}}
												onClick={(e) => e.stopPropagation()}
												placeholder="tag..."
											/>
										</span>
									) : (
										<button
											type="button"
											className="tag-add-btn"
											onClick={(e) => {
												e.stopPropagation();
												onStartTagging(file);
											}}
											title="Add tag"
										>
											<Plus size={12} />
										</button>
									)}
								</div>
							)}
						</td>
					);
				}
				return null;
			})}
		</tr>
	);
});

export function FileList({ onSelectionChange }: FileListProps) {
	const collectionTick = useStoreVersion(useCollectionVersion);
	const settingsTick = useStoreVersion(useSettingsVersion);
	const audioTick = useStoreVersion(useAudioVersion);

	const files = collectionStore.files;
	const deferredFiles = useDeferredValue(files);
	const loading = collectionStore.loading;
	const showSwitchingUi = collectionStore.showSwitchingUi;
	const switchingToPath = collectionStore.switchingToPath;
	const collectionPath = collectionStore.collectionPath;
	const showCheckboxes = settingsStore.showCheckboxes;
	const sortColumn = settingsStore.sortColumn;
	const sortDirection = settingsStore.sortDirection;
	const selectedFormats = settingsStore.selectedFormats;
	const selectedTags = settingsStore.selectedTags;
	const columnOrder = settingsStore.columnOrder;

	const displayedFiles = useMemo(
		() => collectionStore.computeDisplayedFiles(deferredFiles),
		[deferredFiles, collectionTick, settingsTick]
	);
	const selectedIds = useMemo(
		() => collectionStore.files.filter((f) => f.selected).map((f) => f.id),
		[collectionTick]
	);

	const allFormats = [...new Set(files.map((f) => f.format))].sort();
	const allTags = [...new Set(files.flatMap((f) => f.tags))].sort();

	const allSelected = displayedFiles.length > 0 && displayedFiles.every((f) => f.selected);
	const someSelected = displayedFiles.some((f) => f.selected) && !allSelected;

	const [activePopover, setActivePopover] = useState<'format' | 'tags' | null>(null);
	const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
	const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
	const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
	const columnDragRef = useRef<{
		sourceId: string;
		startX: number;
		startY: number;
		moved: boolean;
	} | null>(null);
	const columnDidDragRef = useRef(false);
	const dragOverColumnRef = useRef<string | null>(null);

	const [taggingFile, setTaggingFile] = useState<FileItem | null>(null);
	const [newTagValue, setNewTagValue] = useState('');
	const tagInputRef = useRef<HTMLInputElement | null>(null);
	const selectAllRef = useRef<HTMLInputElement | null>(null);
	const dropTargetRef = useRef<HTMLDivElement | null>(null);
	const externalDragActiveRef = useRef(false);
	const [dropHover, setDropHover] = useState(false);

	useEffect(() => {
		onSelectionChange?.(selectedIds);
	}, [collectionTick, onSelectionChange, selectedIds]);

	useEffect(() => {
		if (!collectionPath || showSwitchingUi) {
			externalDragActiveRef.current = false;
			setDropHover(false);
			return;
		}

		const appWindow = getCurrentWindow();
		const unlistenPromise = appWindow.onDragDropEvent((event) => {
			if (collectionStore.isDraggingFromApp) return;

			const dropTarget = dropTargetRef.current;
			if (!dropTarget) return;

			const { payload } = event;

			if (payload.type === 'leave') {
				externalDragActiveRef.current = false;
				setDropHover(false);
				return;
			}

			if (payload.type === 'drop') {
				externalDragActiveRef.current = false;
				setDropHover(false);
				void handleExternalFileDrop(payload.paths);
				return;
			}

			if (payload.type === 'enter') {
				const paths = filterExternalDropPaths(payload.paths, collectionPath);
				externalDragActiveRef.current = paths.length > 0;
				if (!externalDragActiveRef.current) {
					setDropHover(false);
					return;
				}
			} else if (payload.type !== 'over' || !externalDragActiveRef.current) {
				return;
			}

			setDropHover(
				isPhysicalPointInElement(dropTarget, payload.position.x, payload.position.y)
			);
		});

		return () => {
			void unlistenPromise.then((unlisten) => unlisten());
		};
	}, [collectionPath, showSwitchingUi]);

	useEffect(() => {
		const currentFileId = audioPlayer.currentFileId;
		if (!currentFileId) return;
		const playingFile = collectionStore.files.find((f) => f.id === currentFileId);
		if (!playingFile) return;
		const index = collectionStore.displayedFiles.indexOf(playingFile);
		if (index === -1) return;
		setLastSelectedIndex((prev) => (prev === index ? prev : index));
	}, [audioTick, collectionTick]);

	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate = someSelected;
		}
	}, [someSelected, allSelected]);

	useEffect(() => {
		if (!taggingFile || !tagInputRef.current) return;
		const id = requestAnimationFrame(() => {
			tagInputRef.current?.focus();
			tagInputRef.current?.select();
		});
		return () => cancelAnimationFrame(id);
	}, [taggingFile]);

	const closeTagDialog = () => {
		setTaggingFile(null);
		setNewTagValue('');
	};

	const handleRemoveFile = async (file: FileItem) => {
		const choice = await promptRemoveFile(file.filename);
		if (!choice) return;
		audioPlayer.stopIfPlaying(file.id);
		if (choice === 'collection') {
			await collectionStore.removeFromCollectionOnly(file.id);
		} else {
			await collectionStore.removeFileFromDisk(file.id);
		}
	};

	const toggleAll = () => {
		const newState = !allSelected;
		displayedFiles.forEach((f) => {
			f.selected = newState;
		});
		collectionStore.notify();
	};

	const handleSelection = (event: MouseEvent, index: number) => {
		const isShift = event.shiftKey;
		const isCtrl = event.ctrlKey || event.metaKey;
		const file = displayedFiles[index];

		if (isShift && lastSelectedIndex !== -1) {
			const start = Math.min(lastSelectedIndex, index);
			const end = Math.max(lastSelectedIndex, index);
			for (let i = start; i <= end; i++) {
				displayedFiles[i].selected = true;
			}
		} else if (isCtrl) {
			displayedFiles[index].selected = !displayedFiles[index].selected;
			setLastSelectedIndex(index);
		} else {
			if (displayedFiles[index].selected && !displayedFiles[index].missing) {
				if (!collectionStore.isLocked(file.id)) {
					audioPlayer.toggle(displayedFiles[index]);
				}
			} else {
				files.forEach((f) => {
					f.selected = false;
				});
				displayedFiles[index].selected = true;
				setLastSelectedIndex(index);
				if (!displayedFiles[index].missing && !collectionStore.isLocked(file.id)) {
					audioPlayer.play(displayedFiles[index]);
				}
			}
		}
		collectionStore.notify();
	};

	const handleContextMenu = (event: MouseEvent, file: FileItem) => {
		event.preventDefault();
		event.stopPropagation();

		if (!file.selected) {
			files.forEach((f) => {
				f.selected = false;
			});
			file.selected = true;
			collectionStore.notify();
		}

		const selectedFiles = files.filter((f) => f.selected && !f.missing);
		if (selectedFiles.length > 1) {
			const unionTags = [...new Set(selectedFiles.flatMap((f) => f.tags))].sort();
			showContextMenu(event.clientX, event.clientY, [
				{
					label: `Add tag to ${selectedFiles.length} files…`,
					action: async () => {
						const tag = await promptTagName(`Add tag to ${selectedFiles.length} files:`);
						if (!tag) return;
						await collectionStore.batchAddTag(
							selectedFiles.map((f) => f.id),
							tag
						);
					}
				},
				{
					label: 'Remove tag from selection…',
					disabled: unionTags.length === 0,
					action: async () => {
						const tag = await promptPickTag(unionTags, selectedFiles.length);
						if (!tag) return;
						await collectionStore.batchRemoveTag(
							selectedFiles.map((f) => f.id),
							tag
						);
					}
				},
				{ separator: true },
				{
					label: 'Remove',
					action: () => void handleRemoveFile(file)
				}
			]);
			return;
		}

		const isLocked = collectionStore.isLocked(file.id);

		showContextMenu(event.clientX, event.clientY, [
			{
				label: audioPlayer.currentFileId === file.id && audioPlayer.isPlaying ? 'Pause' : 'Play',
				disabled: file.missing || isLocked,
				action: () => audioPlayer.toggle(file)
			},
			{ separator: true },
			{
				label: 'Add Tag...',
				disabled: file.missing || isLocked,
				action: () => {
					setTaggingFile(file);
					setNewTagValue('');
				}
			},
			{ separator: true },
			{
				label: 'Show in Folder',
				disabled: file.missing,
				action: async () => {
					const fullPath = `${collectionPath}/${file.filepath}`.replace(/[\\/]+/g, '/');
					await revealItemInDir(fullPath);
				}
			},
			{
				label: 'Copy Path',
				action: async () => {
					const fullPath = `${collectionPath}/${file.filepath}`.replace(/[\\/]+/g, '/');
					await navigator.clipboard.writeText(fullPath);
				}
			},
			{ separator: true },
			...(file.missing
				? [
						{
							label: 'Locate File...',
							disabled: isLocked,
							action: () => collectionStore.relocateFile(file.id)
						}
					]
				: []),
			{
				label: 'Remove',
				disabled: isLocked,
				action: () => void handleRemoveFile(file)
			}
		]);
	};

	const reorderColumns = (sourceId: string, targetId: string) => {
		const fromIndex = columnOrder.indexOf(sourceId);
		const toIndex = columnOrder.indexOf(targetId);
		if (fromIndex === -1 || toIndex === -1 || sourceId === targetId) return;

		const newOrder = [...columnOrder];
		newOrder.splice(fromIndex, 1);
		newOrder.splice(toIndex, 0, sourceId);
		settingsStore.columnOrder = newOrder;
		settingsStore.notify();
	};

	const beginColumnDrag = (columnId: string, clientX: number, clientY: number) => {
		columnDragRef.current = {
			sourceId: columnId,
			startX: clientX,
			startY: clientY,
			moved: false
		};
		setDraggingColumn(columnId);
		setDragOverColumn(null);
		dragOverColumnRef.current = null;
	};

	useEffect(() => {
		dragOverColumnRef.current = dragOverColumn;
	}, [dragOverColumn]);

	useEffect(() => {
		const onMouseMove = (e: globalThis.MouseEvent) => {
			const drag = columnDragRef.current;
			if (!drag) return;

			const dx = e.clientX - drag.startX;
			const dy = e.clientY - drag.startY;
			if (!drag.moved) {
				if (dx * dx + dy * dy < COLUMN_DRAG_THRESHOLD_PX * COLUMN_DRAG_THRESHOLD_PX) return;
				drag.moved = true;
			}

			const el = document.elementFromPoint(e.clientX, e.clientY);
			const th = el?.closest<HTMLElement>('th[data-column-id]');
			const targetId = th?.dataset.columnId;
			if (targetId) {
				setDragOverColumn((prev) => (prev === targetId ? prev : targetId));
			}
		};

		const onMouseUp = () => {
			const drag = columnDragRef.current;
			if (!drag) return;

			if (drag.moved) {
				columnDidDragRef.current = true;
				const targetId = dragOverColumnRef.current;
				if (targetId) {
					reorderColumns(drag.sourceId, targetId);
				}
			}

			columnDragRef.current = null;
			setDraggingColumn(null);
			setDragOverColumn(null);
			dragOverColumnRef.current = null;
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [columnOrder]);

	const toggleSort = (col: string) => {
		if (settingsStore.sortColumn === col) {
			if (settingsStore.sortDirection === 'asc') {
				settingsStore.sortDirection = 'desc';
			} else {
				settingsStore.sortColumn = null;
				settingsStore.sortDirection = 'asc';
			}
		} else {
			settingsStore.sortColumn = col;
			settingsStore.sortDirection = 'asc';
		}
		settingsStore.notify();
	};

	const toggleFilterPopover = (type: 'format' | 'tags', event: MouseEvent) => {
		event.stopPropagation();
		setActivePopover((prev) => (prev === type ? null : type));
	};

	const toggleFormatFilter = (format: string) => {
		if (settingsStore.selectedFormats.includes(format)) {
			settingsStore.selectedFormats = settingsStore.selectedFormats.filter((f) => f !== format);
		} else {
			settingsStore.selectedFormats = [...settingsStore.selectedFormats, format];
		}
		settingsStore.notify();
	};

	const toggleTagFilter = (tag: string) => {
		if (settingsStore.selectedTags.includes(tag)) {
			settingsStore.selectedTags = settingsStore.selectedTags.filter((t) => t !== tag);
		} else {
			settingsStore.selectedTags = [...settingsStore.selectedTags, tag];
		}
		settingsStore.notify();
	};

	const handleAddTag = async () => {
		if (!taggingFile) return;
		const tag = newTagValue.trim();
		if (tag && !taggingFile.tags.includes(tag)) {
			const newTags = [...taggingFile.tags, tag];
			await collectionStore.updateTags(taggingFile.id, newTags);
		}
		closeTagDialog();
	};

	useEffect(() => {
		const closePopovers = () => setActivePopover(null);
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeTagDialog();
			}
			if (e.key === 'Enter' && taggingFile) {
				void handleAddTag();
			}
		};
		window.addEventListener('click', closePopovers);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('click', closePopovers);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [taggingFile, newTagValue]);

	const removeTag = async (file: FileItem, tagToRemove: string) => {
		const newTags = file.tags.filter((t) => t !== tagToRemove);
		await collectionStore.updateTags(file.id, newTags);
	};

	const containerContextMenu = (e: React.MouseEvent) => {
		if (
			e.target === e.currentTarget ||
			(e.target as HTMLElement).classList.contains("empty-state")
		) {
			e.preventDefault();
			showContextMenu(e.clientX, e.clientY, [
				{ label: 'Open Collection...', action: () => collectionStore.openCollection() },
				{ separator: true },
				{ label: 'Refresh', action: () => collectionStore.refresh() }
			]);
		}
	};

	return (
		<>
			<div className="file-list-container" role="presentation" onContextMenu={containerContextMenu}>
				{collectionPath &&
					!showSwitchingUi &&
					!(loading && files.length === 0) &&
					files.length > 0 && (
						<div className="file-list-toolbar">
							<input
								type="search"
								className="filename-search"
								placeholder="Filter by filename…"
								value={settingsStore.filenameQuery}
								onInput={(e) => {
									settingsStore.filenameQuery = e.currentTarget.value;
									settingsStore.notify();
								}}
								onKeyDown={(e) => {
									if (e.key === 'Escape') {
										settingsStore.filenameQuery = '';
										settingsStore.notify();
										e.currentTarget.blur();
									}
								}}
							/>
						</div>
					)}
				<div
					ref={dropTargetRef}
					className={`file-list-drop-target${dropHover ? ' file-list-drop-hover' : ''}`}
				>
					{dropHover && (
						<div className="file-list-drop-overlay" aria-hidden>
							<Upload size={40} strokeWidth={1.5} />
							<strong>Drop to add files</strong>
							<span>Files will be copied or moved into this collection</span>
						</div>
					)}
					{!collectionPath ? (
					<div className="empty-state">
						<FolderOpen size={48} />
						<h2>No collection open</h2>
						<p>Select a folder to start managing your audio files</p>
						<button
							type="button"
							className="open-btn"
							onClick={() => collectionStore.openCollection()}
						>
							Open Collection
						</button>
					</div>
				) : showSwitchingUi ? (
					<div className="empty-state">
						<Loader2 size={48} className="animate-spin" />
						<h2>Opening library</h2>
						<p>{collectionDisplayName(switchingToPath ?? collectionPath)}</p>
					</div>
				) : loading && files.length === 0 ? (
					<div className="empty-state">
						<Loader2 size={48} className="animate-spin" />
						<p>Scanning files…</p>
					</div>
				) : files.length === 0 ? (
					<div className="empty-state">
						<Filter size={48} />
						<h2>No audio files found</h2>
						<p>Try adding some audio files to the folder or drag them here</p>
					</div>
				) : (
					<table
							className={`file-table${!showCheckboxes ? ' file-table-no-checkboxes' : ''}`}
						>
							<thead>
								<tr>
									{showCheckboxes && (
										<th className="checkbox-col">
											<label className="checkbox">
												<input
													ref={selectAllRef}
													type="checkbox"
													checked={allSelected}
													onChange={toggleAll}
												/>
												<span className="checkbox-mark" />
											</label>
										</th>
									)}
									{columnOrder.map((columnId) => {
										const config = columnConfigs[columnId];
										return (
											<th
												key={columnId}
												data-column-id={columnId}
												className={`${columnId}-col${config.sortable ? ' sortable-th' : ''}${config.filterable ? ' filterable-th' : ''}${draggingColumn === columnId ? ' dragging-th' : ''}${dragOverColumn === columnId && draggingColumn !== columnId ? ' drop-target-th' : ''}`}
												onClick={(e) => {
													if (columnDidDragRef.current) {
														columnDidDragRef.current = false;
														return;
													}
													if (config.sortable) toggleSort(columnId);
													else if (config.filterable) toggleFilterPopover(config.filterable, e);
												}}
												onMouseDown={(e) => {
													if (e.button !== 0) return;
													beginColumnDrag(columnId, e.clientX, e.clientY);
												}}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														if (config.sortable) toggleSort(columnId);
														else if (config.filterable)
															toggleFilterPopover(config.filterable, e as unknown as MouseEvent);
													}
												}}
												role="button"
												tabIndex={0}
											>
												<div className="header-content">
													<span>{config.label}</span>
													{config.sortable && sortColumn === columnId && (
														<span className="status-icon">
															{sortDirection === 'asc' ? (
																<ChevronUp size={14} />
															) : (
																<ChevronDown size={14} />
															)}
														</span>
													)}
													{config.filterable === 'format' && selectedFormats.length > 0 && (
														<span className="status-icon status-icon-active">
															<Filter size={12} />
														</span>
													)}
													{config.filterable === 'tags' && selectedTags.length > 0 && (
														<span className="status-icon status-icon-active">
															<Filter size={12} />
														</span>
													)}

													{config.filterable === 'format' && activePopover === 'format' && (
														<div
															className="filter-popover"
															onClick={(e) => e.stopPropagation()}
															onKeyDown={(e) => e.stopPropagation()}
															role="presentation"
														>
															<div className="filter-popover-header">Filter Formats</div>
															<div className="filter-popover-list">
																{allFormats.map((format) => (
																	<label key={format} className="filter-popover-item">
																		<div className="checkbox">
																			<input
																				type="checkbox"
																				checked={selectedFormats.includes(format)}
																				onChange={() => toggleFormatFilter(format)}
																			/>
																			<span className="checkbox-mark" />
																		</div>
																		<span className="item-label">{format}</span>
																	</label>
																))}
															</div>
															{selectedFormats.length > 0 && (
																<button
																	type="button"
																	className="clear-btn"
																	onClick={() => {
																		settingsStore.selectedFormats = [];
																		settingsStore.notify();
																	}}
																>
																	Clear All
																</button>
															)}
														</div>
													)}
													{config.filterable === 'tags' && activePopover === 'tags' && (
														<div
															className="filter-popover"
															onClick={(e) => e.stopPropagation()}
															onKeyDown={(e) => e.stopPropagation()}
															role="presentation"
														>
															<div className="filter-popover-header">Filter Tags</div>
															<div className="filter-popover-list">
																{allTags.map((tag) => (
																	<label key={tag} className="filter-popover-item">
																		<div className="checkbox">
																			<input
																				type="checkbox"
																				checked={selectedTags.includes(tag)}
																				onChange={() => toggleTagFilter(tag)}
																			/>
																			<span className="checkbox-mark" />
																		</div>
																		<span className="item-label">{tag}</span>
																	</label>
																))}
															</div>
															{selectedTags.length > 0 && (
																<button
																	type="button"
																	className="clear-btn"
																	onClick={() => {
																		settingsStore.selectedTags = [];
																		settingsStore.notify();
																	}}
																>
																	Clear All
																</button>
															)}
														</div>
													)}
												</div>
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{displayedFiles.map((file, i) => (
									<FileRow
										key={file.id}
										file={file}
										index={i}
										showCheckboxes={showCheckboxes}
										columnOrder={columnOrder}
										collectionPath={collectionPath}
										taggingFileId={taggingFile?.id ?? null}
										newTagValue={newTagValue}
										onTagInputRef={(el) => {
											tagInputRef.current = el;
										}}
										onNewTagValueChange={setNewTagValue}
										onSelection={handleSelection}
										onContextMenu={handleContextMenu}
										onCloseTagDialog={closeTagDialog}
										onAddTag={() => void handleAddTag()}
										onRemoveTag={(f, tag) => void removeTag(f, tag)}
										onStartTagging={(f) => {
											setTaggingFile(f);
											setNewTagValue('');
										}}
									/>
								))}
							</tbody>
					</table>
				)}
				</div>
			</div>
		</>
	);
}
