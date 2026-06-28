import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
	const audioVersion = useStoreVersion(useAudioVersion);

	const svgRef = useRef<SVGSVGElement>(null);
	const fullProgressRectRef = useRef<SVGRectElement>(null);
	const hoverLineRef = useRef<SVGLineElement>(null);
	const containerRectRef = useRef<{ left: number; width: number }>({ left: 0, width: 1 });
	const viewBoxWidthRef = useRef(1);

	const [waveformData, setWaveformData] = useState<number[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [dragStartPos, setDragStartPos] = useState<number | null>(null);
	const [currentPos, setCurrentPos] = useState<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [dragClipPath, setDragClipPath] = useState<string | null>(null);
	const [isPreparingClip, setIsPreparingClip] = useState(false);
	const [staticPlayProgress, setStaticPlayProgress] = useState(0);

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
		audioPlayer.setWaveformFileId(id || null);
		return () => {
			if (audioPlayer.waveformFileId === id) {
				audioPlayer.setWaveformFileId(null);
			}
		};
	}, [id]);

	useEffect(() => {
		setIsLoading(true);
		setDragClipPath(null);
		setStaticPlayProgress(0);
		audioPlayer.clearSelection();
		void fetchWaveform();
	}, [id, fetchWaveform]);

	// Keep the static `staticPlayProgress` React state in sync with the audio player
	// only when paused / not the active file. The hot rAF path writes directly to
	// the SVG rect via a ref and bypasses React entirely.
	useEffect(() => {
		const isActive = audioPlayer.currentFileId === id;
		if (!isActive) {
			setStaticPlayProgress(0);
			updateProgressRef(0, false);
			return;
		}

		if (!audioPlayer.isPlaying) {
			const p = audioPlayer.smoothProgress;
			setStaticPlayProgress(p);
			updateProgressRef(p, true);
			return;
		}

		let raf = 0;
		const tick = () => {
			updateProgressRef(audioPlayer.smoothProgress, true);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [id, audioVersion]);

	function updateProgressRef(p: number, active: boolean) {
		const px = p * viewBoxWidthRef.current;
		if (fullProgressRectRef.current) {
			fullProgressRectRef.current.setAttribute('width', String(active ? px : 0));
		}
	}

	useLayoutEffect(() => {
		if (!svgRef.current) return;
		const update = () => {
			const r = svgRef.current!.getBoundingClientRect();
			containerRectRef.current = { left: r.left, width: r.width };
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(svgRef.current);
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, []);

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
	const viewBoxWidth = barsCount * 3;
	viewBoxWidthRef.current = viewBoxWidth;

	// Full waveform path — built ONCE from `data` only.
	const waveformPath = useMemo(() => {
		if (data.length === 0) return '';
		const spacing = 3;
		const topParts: string[] = [];
		const bottomParts: string[] = [];
		for (let i = 0; i < data.length; i++) {
			const x = i * spacing;
			const h = getBarHeight(data[i]);
			topParts.push(`${i === 0 ? 'M' : 'L'} ${x},${50 - h / 2} `);
			bottomParts.push(`L ${x},${50 + h / 2} `);
		}
		return topParts.join('') + bottomParts.reverse().join('') + 'Z';
	}, [data]);

	// Partial waveform path — shown while loading. Independent of `progress` re-renders
	// because we use it as a static overlay rect width via a ref. React state here is
	// only updated on generation completion.
	const partialPath = useMemo(() => {
		if (waveformData || !isLoading) return '';
		if (data.length === 0) return '';
		const lastIdx = Math.min(data.length - 1, Math.floor(progress * data.length));
		if (lastIdx < 0) return '';
		const spacing = 3;
		const topParts: string[] = [];
		const bottomParts: string[] = [];
		for (let i = 0; i <= lastIdx; i++) {
			const x = i * spacing;
			const h = getBarHeight(data[i]);
			topParts.push(`${i === 0 ? 'M' : 'L'} ${x},${50 - h / 2} `);
			bottomParts.push(`L ${x},${50 + h / 2} `);
		}
		return topParts.join('') + bottomParts.reverse().join('') + 'Z';
		// progress is intentionally NOT a dep — we update via setPartialPath on progress
		// changes in a separate effect, but for the load-overlay we just sample it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data, waveformData, isLoading]);

	const selectionMarkers = useMemo(() => {
		if (audioPlayer.selectionFileId !== id) {
			return { in: null as number | null, out: null as number | null };
		}
		return { in: audioPlayer.selectionIn, out: audioPlayer.selectionOut };
		// audioVersion bumps when the audio player state changes — we want the memo
		// to re-run then even though we read live fields from audioPlayer directly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id, audioVersion]);

	const currentSelection = useMemo(() => {
		if (isDragging && dragStartPos !== null && currentPos !== null) {
			const rect = containerRectRef.current;
			const getPct = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
			const p1 = getPct(dragStartPos);
			const p2 = getPct(currentPos);
			return { start: Math.min(p1, p2), end: Math.max(p1, p2) };
		}
		if (audioPlayer.selectionFileId === id && audioPlayer.selectionRange) {
			return audioPlayer.selectionRange;
		}
		return null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isDragging, dragStartPos, currentPos, id, audioVersion]);

	const selectionRange = audioPlayer.selectionFileId === id ? audioPlayer.selectionRange : null;
	const selectionKey = selectionRange ? `${selectionRange.start}:${selectionRange.end}` : null;

	const setSelectionDragRef = useExternalFileDrag({
		disabled: () => !dragClipPath || isPreparingClip,
		getPaths: () => (dragClipPath ? [dragClipPath] : [])
	});

	useEffect(() => {
		if (!selectionKey) {
			setDragClipPath(null);
			return;
		}

		let cancelled = false;
		setIsPreparingClip(true);
		invoke<string>('prepare_drag_clip', {
			id,
			startPct: selectionRange!.start,
			endPct: selectionRange!.end
		})
			.then((clipPath) => {
				if (!cancelled) setDragClipPath(clipPath);
			})
			.catch((err) => {
				console.error('Failed to prepare drag clip:', err);
			})
			.finally(() => {
				if (!cancelled) setIsPreparingClip(false);
			});

		return () => {
			cancelled = true;
		};
	}, [id, selectionKey]);

	function onMouseDown(e: React.MouseEvent) {
		if (e.button !== 0 || isLocked) return;
		if ((e.target as Element).closest('.selection-rect')) return;
		audioPlayer.clearSelection();
		setDragStartPos(e.clientX);
		setCurrentPos(e.clientX);
		setIsDragging(true);
		setDragClipPath(null);
	}

	const hoverLineXRef = useRef<number | null>(null);

	function onMouseMove(e: React.MouseEvent) {
		const rect = containerRectRef.current;
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const xPx = pct * viewBoxWidth;
		if (hoverLineRef.current) {
			hoverLineRef.current.setAttribute('x1', String(xPx));
			hoverLineRef.current.setAttribute('x2', String(xPx));
			hoverLineRef.current.style.opacity = '1';
		}
		hoverLineXRef.current = xPx;
		if (isDragging) setCurrentPos(e.clientX);
	}

	function onMouseLeave() {
		if (hoverLineRef.current) hoverLineRef.current.style.opacity = '0';
		hoverLineXRef.current = null;
	}

	async function onMouseUp(e: React.MouseEvent) {
		if (!isDragging) return;
		setIsDragging(false);
		const diff = Math.abs(e.clientX - (dragStartPos || 0));
		const rect = containerRectRef.current;
		if (rect.width <= 0) return;
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
			if (end - start > 0.001) {
				audioPlayer.setSelection(start, end, id);
			}
		}
		setDragStartPos(null);
		setCurrentPos(null);
	}

	const heightStyle = typeof height === 'number' ? `${height}px` : height;
	const showFullProgress = !!waveformData && staticPlayProgress > 0;

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
				viewBox={`0 0 ${viewBoxWidth} 100`}
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
					<clipPath id={`waveformShapeClip-${id}`}>
						<path d={waveformPath} />
					</clipPath>
				</defs>

				{currentSelection && (
					<rect
						x={currentSelection.start * viewBoxWidth}
						y="0"
						width={(currentSelection.end - currentSelection.start) * viewBoxWidth}
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

				{/* Full waveform "played" overlay: rect width is updated by ref, no React re-render.
				    Clipped to the waveform shape so it only fills the silhouette, not the empty
				    space above/below the waveform bars. */}
				<g clipPath={`url(#waveformShapeClip-${id})`}>
					<rect
						ref={fullProgressRectRef}
						x="0"
						y="0"
						width={showFullProgress ? staticPlayProgress * viewBoxWidth : 0}
						height="100"
						fill={`url(#waveformPlayedGradient-${id})`}
						className={`waveform-path played${!waveformData && isLoading ? ' no-transition' : ''}`}
						style={{ pointerEvents: 'none' }}
					/>
				</g>

				{/* Partial waveform overlay (shown while loading). */}
				{!waveformData && isLoading && partialPath && (
					<path
						d={partialPath}
						fill={`url(#waveformPlayedGradient-${id})`}
						className="waveform-path played no-transition"
					/>
				)}

				{selectionMarkers.in !== null && selectionMarkers.out === null && (
					<line
						x1={selectionMarkers.in * viewBoxWidth}
						y1="0"
						x2={selectionMarkers.in * viewBoxWidth}
						y2="100"
						stroke="var(--selection-color)"
						strokeWidth="2"
						pointerEvents="none"
						className="selection-marker selection-marker-in"
					/>
				)}
				{selectionMarkers.out !== null && selectionMarkers.in === null && (
					<line
						x1={selectionMarkers.out * viewBoxWidth}
						y1="0"
						x2={selectionMarkers.out * viewBoxWidth}
						y2="100"
						stroke="var(--selection-color)"
						strokeWidth="2"
						strokeDasharray="4 3"
						pointerEvents="none"
						className="selection-marker selection-marker-out"
					/>
				)}

				<line
					ref={hoverLineRef}
					x1="0"
					y1="0"
					x2="0"
					y2="100"
					stroke="var(--accent-color)"
					strokeWidth="1.5"
					pointerEvents="none"
					className="hover-line"
					style={{ opacity: 0, transition: 'opacity 0.15s' }}
				/>

				{currentSelection && (
					<rect
						ref={setSelectionDragRef}
						x={currentSelection.start * viewBoxWidth}
						y="0"
						width={(currentSelection.end - currentSelection.start) * viewBoxWidth}
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
