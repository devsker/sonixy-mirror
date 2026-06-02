type LinuxWindowControlsProps = {
	preview?: boolean;
	onClose?: () => void;
	onMinimize?: () => void;
	onZoom?: () => void;
};

export function LinuxWindowControls({
	preview = false,
	onClose,
	onMinimize,
	onZoom
}: LinuxWindowControlsProps) {
	return (
		<div className={`linux-window-controls${preview ? ' preview' : ''}`}>
			<button
				type="button"
				className="linux-control minimize"
				onClick={onMinimize}
				aria-label="Minimize"
			>
				<svg className="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
					<path className="stroke" d="M4 8.25h8" />
				</svg>
			</button>
			<button
				type="button"
				className="linux-control maximize"
				onClick={onZoom}
				aria-label="Maximize"
			>
				<svg className="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
					<path className="stroke" d="M4.75 4.75h6.5v6.5H4.75z" />
				</svg>
			</button>
			<button type="button" className="linux-control close" onClick={onClose} aria-label="Close">
				<svg className="linux-icon" viewBox="0 0 16 16" aria-hidden="true">
					<path className="stroke" d="M5.25 5.25l5.5 5.5M10.75 5.25l-5.5 5.5" />
				</svg>
			</button>
		</div>
	);
}
