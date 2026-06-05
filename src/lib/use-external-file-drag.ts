import { useCallback, useEffect, useRef } from 'react';
import { externalFileDrag, type ExternalFileDragOptions } from '@/lib/file-drag';

/**
 * Attach pointer-driven OS file drag to a DOM node. Uses a callback ref so listeners
 * are registered when the node mounts (e.g. conditional waveform selection rect).
 */
export function useExternalFileDrag(options: ExternalFileDragOptions) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const handleRef = useRef<ReturnType<typeof externalFileDrag> | null>(null);

	const setNodeRef = useCallback((node: Element | null) => {
		handleRef.current?.destroy();
		handleRef.current = null;
		if (!node) return;
		handleRef.current = externalFileDrag(node, {
			getPaths: () => optionsRef.current.getPaths(),
			disabled: () => optionsRef.current.disabled?.() ?? false
		});
	}, []);

	useEffect(() => {
		handleRef.current?.update({
			getPaths: () => optionsRef.current.getPaths(),
			disabled: () => optionsRef.current.disabled?.() ?? false
		});
	});

	return setNodeRef;
}
