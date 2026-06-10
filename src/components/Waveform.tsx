import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioPlayer } from '@/lib/audio-player';
import { collectionStore } from '@/lib/collection-store';
import { useExternalFileDrag } from '@/lib/use-external-file-drag';
import { useStoreVersion, useWaveformProgressVersion, useAudioVersion } from '@/lib/store-sync';

type Props = {
	height?: number | string;
	color?: string;
	id?: string;
};

export default function Waveform({
	height = '100%',
	color = 'var(--icon-active)',
	id = ''
}: Props) {
	useStoreVersion(useWaveformProgressVersion);
	useStoreVersion(useAudioVersion);

	const svgRef = useRef<SVGSVGElement>(null);

	const [waveformData, setWaveformData] = useState<number[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [selectionStart, setSelectionStart] = useState<number | null>(null);
	const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
	const [dragStartPos, setDragStartPos] = useState<number | null>(null);
	const [currentPos, setCurrentPos] = useState<number | null>(null);
	const [hoverPos, setHoverPos] = useState<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [dragClipPath, setDragClipPath] = useState<string | null>(null);
	const [isPreparingClip, setIsPreparingClip] = useState(false);

	const progress = collectionStore.waveformProgress[id] || 0;
	const partialData = collectionStore.partialWaveforms[id] || null;
	const isLocked = collectionStore.isLocked(id);

	const fetchWaveform = useCallback(async () => {
		if (!id) {
			setWaveformData(null);
			setIsLoading(false);
			return;
		}
		try {
			const result = await invoke<number[] | null>('get_waveform', { id });
			if (result) {
				setWaveformData(result.map((v) => v / 255));
				setIsLoading(false);
			} else {
				setWaveformData(null);
				setIsLoading(true);
			}
		} catch (e) {
			console.error('Failed to fetch waveform:', e);
			setWaveformData(null);
			setIsLoading(false);
		}
	}, [id]);

	useEffect(() => {
		setIsLoading(true);
		setSelectionStart(null);
		setSelectionEnd(null);
		setDragClipPath(null);
		audioPlayer.clearAbLoop();
		void fetchWaveform();
	}, [id, fetchWaveform]);

	useEffect(() => {
		const unlistenStarted = listen<string>('waveform-started', (event) => {
			if (event.payload === id) {
				setWaveformData(null);
				setIsLoading(true);
			}
		});
		const unlistenGenerated = listen<{ id: string } | string>('waveform-generated', (event) => {
			const payloadId = typeof event.payload === 'string' ? event.payload : event.payload?.id;
			if (payloadId === id) void fetchWaveform();
		});
		return () => {
			unlistenStarted.then((f) => f());
			unlistenGenerated.then((f) => f());
		};
	}, [id, fetchWaveform]);

	const data = useMemo(
		() => waveformData || (partialData ? partialData.map((v) => v / 255) : Array(512).fill(0)),
		[waveformData, partialData]
	);
	const barsCount = data.length;

	const waveformPath = useMemo(() => {
		if (data.length === 0) return '';
		const spacing = 3;
		let lastIdx = data.length - 1;
		if (!waveformData && isLoading) {
			lastIdx = Math.min(data.length - 1, Math.floor(progress * data.length));
		}
		if (lastIdx < 0) return '';
		const topParts: string[] = [];
		const bottomParts: string[] = [];
		for (let i = 0; i <= lastIdx; i++) {
			const x = i * spacing;
			const h = getBarHeight(data[i]);
			topParts.push(`${i === 0 ? 'M' : 'L'} ${x},${50 - h / 2} `);
			bottomParts.push(`L ${x},${50 + h / 2} `);
		}
		return topParts.join('') + bottomParts.reverse().join('') + 'Z';
	}, [data, waveformData, isLoading, progress]);

	const currentSelection = useMemo(() => {
		if (isDragging && dragStartPos !== null && currentPos !== null && svgRef.current) {
			const rect = svgRef.current.getBoundingClientRect();
			const getPct = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
			const p1 = getPct(dragStartPos);
			const p2 = getPct(currentPos);
			return { start: Math.min(p1, p2), end: Math.max(p1, p2) };
		}
		if (selectionStart !== null && selectionEnd !== null) {
			return { start: selectionStart, end: selectionEnd };
		}
		return null;
	}, [isDragging, dragStartPos, currentPos, selectionStart, selectionEnd]);

	const setSelectionDragRef = useExternalFileDrag({
		disabled: () => !dragClipPath || isPreparingClip,
		getPaths: () => (dragClipPath ? [dragClipPath] : [])
	});

	function applySelectionAbLoop(start: number, end: number) {
		audioPlayer.setAbLoop(start, end);
		const file = collectionStore.files.find((f) => f.id === id);
		if (!file || file.missing) return;
		if (audioPlayer.currentFileId !== id) {
			void audioPlayer.play(file);
		} else {
			void audioPlayer.seek(start);
		}
	}

	function onMouseDown(e: React.MouseEvent) {
		if (e.button !== 0 || isLocked) return;
		if ((e.target as Element).closest('.selection-rect')) return;
		audioPlayer.clearAbLoop();
		setDragStartPos(e.clientX);
		setCurrentPos(e.clientX);
		setIsDragging(true);
		setSelectionStart(null);
		setSelectionEnd(null);
		setDragClipPath(null);
	}

	function onMouseMove(e: React.MouseEvent) {
		setHoverPos(e.clientX);
		if (isDragging) setCurrentPos(e.clientX);
	}

	function onMouseLeave() {
		setHoverPos(null);
	}

	async function onMouseUp(e: React.MouseEvent) {
		if (!isDragging) return;
		setIsDragging(false);
		const diff = Math.abs(e.clientX - (dragStartPos || 0));
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return;
		const getPct = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
		if (diff < 5) {
			if (audioPlayer.currentFileId === id) {
				await audioPlayer.seek(getPct(e.clientX));
			}
		} else {
			const p1 = getPct(dragStartPos!);
			const p2 = getPct(e.clientX);
			const start = Math.min(p1, p2);
			const end = Math.max(p1, p2);
			setSelectionStart(start);
			setSelectionEnd(end);
			if (end - start > 0.001) {
				applySelectionAbLoop(start, end);
				setIsPreparingClip(true);
				try {
					const clipPath = await invoke<string>('prepare_drag_clip', {
						id,
						startPct: start,
						endPct: end
					});
					setDragClipPath(clipPath);
				} catch (err) {
					console.error('Failed to prepare drag clip:', err);
				} finally {
					setIsPreparingClip(false);
				}
			}
		}
		setDragStartPos(null);
		setCurrentPos(null);
	}

	const heightStyle = typeof height === 'number' ? `${height}px` : height;
	const hoverPct =
		hoverPos && svgRef.current
			? Math.max(
					0,
					Math.min(
						1,
						(hoverPos - svgRef.current.getBoundingClientRect().left) /
							svgRef.current.getBoundingClientRect().width
					)
				)
			: null;

	return (
		<div
			className="waveform-container"
			style={{ height: heightStyle }}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
			onMouseLeave={() => {
				onMouseUp({ clientX: 0 } as React.MouseEvent);
				onMouseLeave();
			}}
		>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${barsCount * 3} 100`}
				preserveAspectRatio="none"
				className={`waveform-svg${!waveformData && !isLoading ? ' hidden' : ''}${isLocked ? ' locked' : ''}`}
				onMouseDown={onMouseDown}
				role="presentation"
			>
				<defs>
					<linearGradient id={`waveformGradient-${id}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity="0.15" />
						<stop offset="50%" stopColor={color} stopOpacity="0.3" />
						<stop offset="100%" stopColor={color} stopOpacity="0.15" />
					</linearGradient>
					<linearGradient id={`waveformPlayedGradient-${id}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity="0.7" />
						<stop offset="50%" stopColor={color} stopOpacity="1" />
						<stop offset="100%" stopColor={color} stopOpacity="0.7" />
					</linearGradient>
					<clipPath id={`progressClip-${id}`}>
						<rect
							x="0"
							y="0"
							width={audioPlayer.currentFileId === id ? audioPlayer.progress * barsCount * 3 : 0}
							height="100"
						/>
					</clipPath>
				</defs>

				{currentSelection && (
					<rect
						x={currentSelection.start * barsCount * 3}
						y="0"
						width={(currentSelection.end - currentSelection.start) * barsCount * 3}
						height="100"
						fill="var(--selection-color)"
						fillOpacity="0.1"
						pointerEvents="none"
					/>
				)}

				<g>
					<path
						d={waveformPath}
						fill={`url(#waveformGradient-${id})`}
						className={`waveform-path${!waveformData && isLoading ? ' no-transition' : ''}`}
					/>
				</g>

				<g clipPath={`url(#progressClip-${id})`}>
					<path
						d={waveformPath}
						fill={`url(#waveformPlayedGradient-${id})`}
						className={`waveform-path played${!waveformData && isLoading ? ' no-transition' : ''}`}
					/>
				</g>

				{hoverPct !== null && (
					<line
						x1={hoverPct * barsCount * 3}
						y1="0"
						x2={hoverPct * barsCount * 3}
						y2="100"
						stroke="var(--accent-color)"
						strokeWidth="1.5"
						pointerEvents="none"
						className="hover-line"
					/>
				)}

				{currentSelection && (
					<rect
						ref={setSelectionDragRef}
						x={currentSelection.start * barsCount * 3}
						y="0"
						width={(currentSelection.end - currentSelection.start) * barsCount * 3}
						height="100"
						fill="transparent"
						stroke="var(--selection-color)"
						strokeOpacity="0.8"
						strokeWidth="1"
						onMouseDown={(e) => e.stopPropagation()}
						className={`selection-rect${dragClipPath ? ' ready' : ''}${isPreparingClip ? ' preparing' : ''}`}
					/>
				)}
			</svg>
		</div>
	);
}

function getBarHeight(val: number) {
	const minHeight = 2;
	if (!val || isNaN(val) || val <= 0) return minHeight;
	const boosted = Math.pow(val, 0.8);
	const scaledHeight = boosted * 92;
	return Math.max(minHeight, scaledHeight);
}
