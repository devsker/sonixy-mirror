import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
	Tag,
	Plus,
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
	useAudioVersion
} from '@/lib/store-sync';
import { useExternalFileDrag } from '@/lib/use-external-file-drag';
import type { ExternalFileDragOptions } from '@/lib/file-drag';
import styles from './FileList.module.css';

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

type FileRowProps = {
	file: FileItem;
	index: number;
	showCheckboxes: boolean;
	columnOrder: string[];
	collectionPath: string | null;
	files: FileItem[];
	taggingFileId: string | null;
	newTagValue: string;
	processingFiles: Set<string>;
	currentlyProcessingIds: Set<string>;
	waveformProgress: Record<string, number>;
	processingPaused: boolean;
	onTagInputRef: (el: HTMLInputElement | null) => void;
	onNewTagValueChange: (value: string) => void;
	onSelection: (event: MouseEvent, index: number) => void;
	onContextMenu: (event: MouseEvent, file: FileItem) => void;
	onCloseTagDialog: () => void;
	onAddTag: () => void;
	onRemoveTag: (file: FileItem, tag: string) => void;
	onStartTagging: (file: FileItem) => void;
};

function FileRow({
	file,
	index,
	showCheckboxes,
	columnOrder,
	collectionPath,
	files,
	taggingFileId,
	newTagValue,
	processingFiles,
	currentlyProcessingIds,
	waveformProgress,
	processingPaused,
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
			const selectedFiles = files.filter((f) => f.selected && !f.missing);
			if (file.selected) {
				return selectedFiles.map((f) => `${collectionPath}/${f.filepath}`.replace(/[/\\]+/g, '/'));
			}
			return [`${collectionPath}/${file.filepath}`.replace(/[/\\]+/g, '/')];
		}
	};

	const setRowRef = useExternalFileDrag(dragOptions);

	const isLocked = collectionStore.isLocked(file.id);
	const progress = waveformProgress[file.id] || 0;

	return (
		<tr
			ref={setRowRef}
			className={`${styles.fileRow} ${file.selected ? styles.fileRowSelected : ''} ${file.missing ? styles.fileRowMissing : ''} ${isLocked ? styles.fileRowLocked : ''}`}
			onClick={(e) => onSelection(e, index)}
			onKeyDown={(e) => e.key === 'Enter' && onSelection(e as unknown as MouseEvent, index)}
			onContextMenu={(e) => onContextMenu(e, file)}
			tabIndex={0}
		>
			{showCheckboxes && (
				<td className={styles.checkboxCol}>
					<label className={styles.customCheckbox}>
						<input
							type="checkbox"
							checked={file.selected}
							onChange={(e) => onSelection(e as unknown as MouseEvent, index)}
						/>
						<span className={styles.checkmark} />
					</label>
				</td>
			)}
			{columnOrder.map((columnId) => {
				if (columnId === 'filename') {
					return (
						<td key={columnId} className={styles.filenameCol} title={file.filename}>
							<div className={styles.nameWrapper}>
								{processingFiles.has(file.id) && (
									<span
										className={`${styles.processingIcon} ${!currentlyProcessingIds.has(file.id) ? styles.processingIconQueued : ''} ${processingPaused ? styles.processingIconPaused : ''}`}
										title={currentlyProcessingIds.has(file.id) ? 'Processing...' : 'Queued'}
									>
										{currentlyProcessingIds.has(file.id) ? (
											<svg className={styles.progressCircle} viewBox="0 0 16 16">
												<circle className={styles.bg} cx="8" cy="8" r="6" />
												<circle
													className={styles.fg}
													cx="8"
													cy="8"
													r="6"
													strokeDasharray={2 * Math.PI * 6}
													strokeDashoffset={2 * Math.PI * 6 * (1 - progress)}
												/>
											</svg>
										) : (
											<Circle size={10} strokeWidth={3} />
										)}
									</span>
								)}
								{file.missing && (
									<span className={styles.warningIcon} title="File not found">
										<AlertTriangle size={14} />
									</span>
								)}
								<span
									className={audioPlayer.currentFileId === file.id ? styles.playing : undefined}
								>
									{getDisplayName(file.filename)}
								</span>
							</div>
						</td>
					);
				}
				if (columnId === 'format') {
					return (
						<td key={columnId} className={styles.formatCol}>
							{file.missing ? (
								<div className={styles.missingActions}>
									<button
										type="button"
										className={styles.actionIcon}
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
										className={`${styles.actionIcon} ${styles.actionIconDanger}`}
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
						<td key={columnId} className={styles.lengthCol}>
							{file.missing ? '-' : file.length}
						</td>
					);
				}
				if (columnId === 'size') {
					return (
						<td key={columnId} className={styles.sizeCol}>
							{file.missing ? '-' : file.size}
						</td>
					);
				}
				if (columnId === 'tags') {
					return (
						<td key={columnId} className={styles.tagsCol}>
							{!file.missing && (
								<div className={styles.tagsWrapper}>
									{file.tags.map((tag) => (
										<span key={tag} className={styles.tag}>
											{tag}
											<button
												type="button"
												className={styles.tagRemove}
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
										<span className={`${styles.tag} ${styles.tagTagging}`}>
											<span className={styles.inputMirror}>{newTagValue || 'Tag...'}</span>
											<input
												type="text"
												className={styles.tagInputInline}
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
											className={styles.tagAddBtn}
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
}

export function FileList({ onSelectionChange }: FileListProps) {
	const collectionTick = useStoreVersion(useCollectionVersion);
	const settingsTick = useStoreVersion(useSettingsVersion);
	const audioTick = useStoreVersion(useAudioVersion);
	void settingsTick;

	const files = collectionStore.files;
	const loading = collectionStore.loading;
	const showSwitchingUi = collectionStore.showSwitchingUi;
	const switchingToPath = collectionStore.switchingToPath;
	const collectionPath = collectionStore.collectionPath;
	const processingFiles = collectionStore.processingFiles;
	const currentlyProcessingIds = collectionStore.currentlyProcessingIds;
	const waveformProgress = collectionStore.waveformProgress;
	const processingPaused = collectionStore.processingPaused;

	const showCheckboxes = settingsStore.showCheckboxes;
	const sortColumn = settingsStore.sortColumn;
	const sortDirection = settingsStore.sortDirection;
	const selectedFormats = settingsStore.selectedFormats;
	const selectedTags = settingsStore.selectedTags;
	const columnOrder = settingsStore.columnOrder;

	const displayedFiles = collectionStore.displayedFiles;
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

	const [fileToRemove, setFileToRemove] = useState<FileItem | null>(null);
	const [taggingFile, setTaggingFile] = useState<FileItem | null>(null);
	const [newTagValue, setNewTagValue] = useState('');
	const tagInputRef = useRef<HTMLInputElement | null>(null);
	const selectAllRef = useRef<HTMLInputElement | null>(null);

	const [batchTagMode, setBatchTagMode] = useState<'add' | 'remove' | null>(null);
	const [batchTagIds, setBatchTagIds] = useState<string[]>([]);
	const [batchRemoveTagOptions, setBatchRemoveTagOptions] = useState<string[]>([]);
	const [batchRemoveTagValue, setBatchRemoveTagValue] = useState('');

	useEffect(() => {
		onSelectionChange?.(selectedIds);
	}, [collectionTick, onSelectionChange, selectedIds]);

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

	const closeRemoveDialog = () => setFileToRemove(null);

	const closeTagDialog = () => {
		setTaggingFile(null);
		setNewTagValue('');
		setBatchTagMode(null);
		setBatchTagIds([]);
		setBatchRemoveTagOptions([]);
		setBatchRemoveTagValue('');
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
					action: () => {
						setBatchTagMode('add');
						setBatchTagIds(selectedFiles.map((f) => f.id));
						setNewTagValue('');
					}
				},
				{
					label: 'Remove tag from selection…',
					disabled: unionTags.length === 0,
					action: () => {
						setBatchTagMode('remove');
						setBatchTagIds(selectedFiles.map((f) => f.id));
						setBatchRemoveTagOptions(unionTags);
						setBatchRemoveTagValue(unionTags[0] ?? '');
					}
				},
				{ separator: true },
				{
					label: 'Remove',
					action: () => setFileToRemove(file)
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
				action: () => setFileToRemove(file)
			}
		]);
	};

	const handleDragStart = (event: React.DragEvent, id: string) => {
		setDraggingColumn(id);
		setDragOverColumn(null);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	};

	const handleDragOver = (event: React.DragEvent, targetId: string) => {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		setDragOverColumn(targetId);
	};

	const handleDrop = (event: React.DragEvent, targetId: string) => {
		event.preventDefault();
		if (!draggingColumn || draggingColumn === targetId) {
			setDragOverColumn(null);
			return;
		}

		const fromIndex = columnOrder.indexOf(draggingColumn);
		const toIndex = columnOrder.indexOf(targetId);
		if (fromIndex === -1 || toIndex === -1) {
			setDragOverColumn(null);
			return;
		}

		const newOrder = [...columnOrder];
		newOrder.splice(fromIndex, 1);
		newOrder.splice(toIndex, 0, draggingColumn);
		settingsStore.columnOrder = newOrder;
		settingsStore.notify();
		setDragOverColumn(null);
	};

	const handleDragEnd = () => {
		setDraggingColumn(null);
		setDragOverColumn(null);
	};

	const handleDragLeave = (event: React.DragEvent, columnId: string) => {
		const next = event.relatedTarget as Node | null;
		const current = event.currentTarget as Node | null;
		if (dragOverColumn === columnId && (!current || !next || !current.contains(next))) {
			setDragOverColumn(null);
		}
	};

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
		if (batchTagMode === 'add' && batchTagIds.length > 0) {
			await collectionStore.batchAddTag(batchTagIds, newTagValue);
			closeTagDialog();
			return;
		}
		if (taggingFile) {
			const tag = newTagValue.trim();
			if (tag && !taggingFile.tags.includes(tag)) {
				const newTags = [...taggingFile.tags, tag];
				await collectionStore.updateTags(taggingFile.id, newTags);
			}
			closeTagDialog();
		}
	};

	const handleBatchRemoveTag = async () => {
		if (batchTagMode === 'remove' && batchTagIds.length > 0 && batchRemoveTagValue) {
			await collectionStore.batchRemoveTag(batchTagIds, batchRemoveTagValue);
			closeTagDialog();
		}
	};

	useEffect(() => {
		const closePopovers = () => setActivePopover(null);
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeRemoveDialog();
				closeTagDialog();
			}
			if (e.key === 'Enter' && (taggingFile || batchTagMode === 'add')) {
				void handleAddTag();
			}
			if (e.key === 'Enter' && batchTagMode === 'remove') {
				void handleBatchRemoveTag();
			}
		};
		window.addEventListener('click', closePopovers);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('click', closePopovers);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [taggingFile, batchTagMode, batchTagIds, batchRemoveTagValue, newTagValue]);

	const removeTag = async (file: FileItem, tagToRemove: string) => {
		const newTags = file.tags.filter((t) => t !== tagToRemove);
		await collectionStore.updateTags(file.id, newTags);
	};

	const confirmRemoveFromCollection = async () => {
		if (fileToRemove) {
			audioPlayer.stopIfPlaying(fileToRemove.id);
			await collectionStore.removeFromCollectionOnly(fileToRemove.id);
			closeRemoveDialog();
		}
	};

	const confirmRemoveFromDisk = async () => {
		if (fileToRemove) {
			audioPlayer.stopIfPlaying(fileToRemove.id);
			await collectionStore.removeFileFromDisk(fileToRemove.id);
			closeRemoveDialog();
		}
	};

	const containerContextMenu = (e: React.MouseEvent) => {
		if (
			e.target === e.currentTarget ||
			(e.target as HTMLElement).classList.contains(styles.emptyState)
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
			{fileToRemove && (
				<div className={styles.modalBackdrop} onClick={closeRemoveDialog} role="presentation">
					<div
						className={styles.modalContent}
						onClick={(e) => e.stopPropagation()}
						role="presentation"
					>
						<div className={styles.modalHeader}>
							<AlertTriangle size={24} className={styles.warningIconLarge} />
							<h3>Remove File</h3>
						</div>
						<div className={styles.modalBody}>
							<p>
								How would you like to remove <strong>{fileToRemove.filename}</strong>?
							</p>
							<p className={styles.warningText}>
								&quot;Remove from Disk&quot; will permanently delete the file.
							</p>
						</div>
						<div className={styles.modalFooter}>
							<button
								type="button"
								className={`${styles.modalBtn} ${styles.modalBtnSecondary}`}
								onClick={closeRemoveDialog}
							>
								Cancel
							</button>
							<div className={styles.dangerGroup}>
								<button
									type="button"
									className={`${styles.modalBtn} ${styles.modalBtnDangerOutline}`}
									onClick={() => void confirmRemoveFromCollection()}
								>
									Remove from Collection
								</button>
								<button
									type="button"
									className={`${styles.modalBtn} ${styles.modalBtnDanger}`}
									onClick={() => void confirmRemoveFromDisk()}
								>
									Remove from Disk
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{batchTagMode === 'add' && (
				<div className={styles.modalBackdrop} onClick={closeTagDialog} role="presentation">
					<div
						className={styles.modalContent}
						onClick={(e) => e.stopPropagation()}
						role="presentation"
					>
						<div className={styles.modalHeader}>
							<Tag size={24} />
							<h3>Add tag to {batchTagIds.length} files</h3>
						</div>
						<div className={styles.modalBody}>
							<input
								type="text"
								className={styles.batchTagInput}
								value={newTagValue}
								onChange={(e) => setNewTagValue(e.target.value)}
								placeholder="Tag name"
								onKeyDown={(e) => e.key === 'Enter' && void handleAddTag()}
							/>
						</div>
						<div className={styles.modalFooter}>
							<button
								type="button"
								className={`${styles.modalBtn} ${styles.modalBtnSecondary}`}
								onClick={closeTagDialog}
							>
								Cancel
							</button>
							<button
								type="button"
								className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
								onClick={() => void handleAddTag()}
							>
								Add
							</button>
						</div>
					</div>
				</div>
			)}

			{batchTagMode === 'remove' && (
				<div className={styles.modalBackdrop} onClick={closeTagDialog} role="presentation">
					<div
						className={styles.modalContent}
						onClick={(e) => e.stopPropagation()}
						role="presentation"
					>
						<div className={styles.modalHeader}>
							<Tag size={24} />
							<h3>Remove tag from {batchTagIds.length} files</h3>
						</div>
						<div className={styles.modalBody}>
							<select
								className={styles.batchTagSelect}
								value={batchRemoveTagValue}
								onChange={(e) => setBatchRemoveTagValue(e.target.value)}
							>
								{batchRemoveTagOptions.map((tag) => (
									<option key={tag} value={tag}>
										{tag}
									</option>
								))}
							</select>
						</div>
						<div className={styles.modalFooter}>
							<button
								type="button"
								className={`${styles.modalBtn} ${styles.modalBtnSecondary}`}
								onClick={closeTagDialog}
							>
								Cancel
							</button>
							<button
								type="button"
								className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
								onClick={() => void handleBatchRemoveTag()}
							>
								Remove
							</button>
						</div>
					</div>
				</div>
			)}

			<div
				className={styles.fileListContainer}
				role="presentation"
				onContextMenu={containerContextMenu}
			>
				{!collectionPath ? (
					<div className={styles.emptyState}>
						<FolderOpen size={48} />
						<h2>No collection open</h2>
						<p>Select a folder to start managing your audio files</p>
						<button
							type="button"
							className={styles.openBtn}
							onClick={() => collectionStore.openCollection()}
						>
							Open Collection
						</button>
					</div>
				) : showSwitchingUi ? (
					<div className={styles.emptyState}>
						<Loader2 size={48} className={styles.animateSpin} />
						<h2>Opening library</h2>
						<p>{collectionDisplayName(switchingToPath ?? collectionPath)}</p>
					</div>
				) : loading && files.length === 0 ? (
					<div className={styles.emptyState}>
						<Loader2 size={48} className={styles.animateSpin} />
						<p>Scanning files…</p>
					</div>
				) : files.length === 0 ? (
					<div className={styles.emptyState}>
						<Filter size={48} />
						<h2>No audio files found</h2>
						<p>Try adding some audio files to the folder or drag them here</p>
					</div>
				) : (
					<>
						<div className={styles.fileListToolbar}>
							<input
								type="search"
								className={styles.filenameSearch}
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
						<table
							className={`${styles.fileTable} ${!showCheckboxes ? styles.fileTableNoCheckboxes : ''}`}
						>
							<thead>
								<tr>
									{showCheckboxes && (
										<th className={styles.checkboxCol}>
											<label className={styles.customCheckbox}>
												<input
													ref={selectAllRef}
													type="checkbox"
													checked={allSelected}
													onChange={toggleAll}
												/>
												<span className={styles.checkmark} />
											</label>
										</th>
									)}
									{columnOrder.map((columnId) => {
										const config = columnConfigs[columnId];
										return (
											<th
												key={columnId}
												className={`${styles[`${columnId}Col` as keyof typeof styles] ?? ''} ${config.sortable ? styles.sortableTh : ''} ${config.filterable ? styles.filterableTh : ''} ${draggingColumn === columnId ? styles.draggingTh : ''} ${dragOverColumn === columnId && draggingColumn !== columnId ? styles.dropTargetTh : ''}`}
												onClick={(e) => {
													if (config.sortable) toggleSort(columnId);
													else if (config.filterable) toggleFilterPopover(config.filterable, e);
												}}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														if (config.sortable) toggleSort(columnId);
														else if (config.filterable)
															toggleFilterPopover(config.filterable, e as unknown as MouseEvent);
													}
												}}
												draggable
												onDragStart={(e) => handleDragStart(e, columnId)}
												onDragOver={(e) => handleDragOver(e, columnId)}
												onDragEnter={(e) => e.preventDefault()}
												onDrop={(e) => handleDrop(e, columnId)}
												onDragLeave={(e) => handleDragLeave(e, columnId)}
												onDragEnd={handleDragEnd}
												role="button"
												tabIndex={0}
											>
												<div className={styles.headerContent}>
													<span>{config.label}</span>
													{config.sortable && sortColumn === columnId && (
														<span className={styles.statusIcon}>
															{sortDirection === 'asc' ? (
																<ChevronUp size={14} />
															) : (
																<ChevronDown size={14} />
															)}
														</span>
													)}
													{config.filterable === 'format' && selectedFormats.length > 0 && (
														<span className={`${styles.statusIcon} ${styles.statusIconActive}`}>
															<Filter size={12} />
														</span>
													)}
													{config.filterable === 'tags' && selectedTags.length > 0 && (
														<span className={`${styles.statusIcon} ${styles.statusIconActive}`}>
															<Filter size={12} />
														</span>
													)}

													{config.filterable === 'format' && activePopover === 'format' && (
														<div
															className={styles.popover}
															onClick={(e) => e.stopPropagation()}
															onKeyDown={(e) => e.stopPropagation()}
															role="presentation"
														>
															<div className={styles.popoverHeader}>Filter Formats</div>
															<div className={styles.popoverList}>
																{allFormats.map((format) => (
																	<label key={format} className={styles.popoverItem}>
																		<div className={styles.customCheckbox}>
																			<input
																				type="checkbox"
																				checked={selectedFormats.includes(format)}
																				onChange={() => toggleFormatFilter(format)}
																			/>
																			<span className={styles.checkmark} />
																		</div>
																		<span className={styles.itemLabel}>{format}</span>
																	</label>
																))}
															</div>
															{selectedFormats.length > 0 && (
																<button
																	type="button"
																	className={styles.clearBtn}
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
															className={styles.popover}
															onClick={(e) => e.stopPropagation()}
															onKeyDown={(e) => e.stopPropagation()}
															role="presentation"
														>
															<div className={styles.popoverHeader}>Filter Tags</div>
															<div className={styles.popoverList}>
																{allTags.map((tag) => (
																	<label key={tag} className={styles.popoverItem}>
																		<div className={styles.customCheckbox}>
																			<input
																				type="checkbox"
																				checked={selectedTags.includes(tag)}
																				onChange={() => toggleTagFilter(tag)}
																			/>
																			<span className={styles.checkmark} />
																		</div>
																		<span className={styles.itemLabel}>{tag}</span>
																	</label>
																))}
															</div>
															{selectedTags.length > 0 && (
																<button
																	type="button"
																	className={styles.clearBtn}
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
										files={files}
										taggingFileId={taggingFile?.id ?? null}
										newTagValue={newTagValue}
										processingFiles={processingFiles}
										currentlyProcessingIds={currentlyProcessingIds}
										waveformProgress={waveformProgress}
										processingPaused={processingPaused}
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
					</>
				)}
			</div>
		</>
	);
}
