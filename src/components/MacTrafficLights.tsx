import styles from './MacTrafficLights.module.css';

type MacTrafficLightsProps = {
	preview?: boolean;
	onClose?: () => void;
	onMinimize?: () => void;
	onZoom?: () => void;
};

export function MacTrafficLights({
	preview = false,
	onClose,
	onMinimize,
	onZoom
}: MacTrafficLightsProps) {
	return (
		<div className={`${styles.macTrafficLights} ${preview ? styles.preview : ''}`}>
			<button
				type="button"
				className={`${styles.trafficLight} ${styles.close}`}
				onClick={onClose}
				aria-label="Close"
			>
				<svg className={styles.trafficIcon} viewBox="0 0 8 8" aria-hidden="true">
					<path className="stroke" d="M2.35 2.35 5.65 5.65M5.65 2.35 2.35 5.65" />
				</svg>
			</button>
			<button
				type="button"
				className={`${styles.trafficLight} ${styles.minimize}`}
				onClick={onMinimize}
				aria-label="Minimize"
			>
				<svg className={styles.trafficIcon} viewBox="0 0 8 8" aria-hidden="true">
					<path className="stroke" d="M2.15 4h3.7" />
				</svg>
			</button>
			<button
				type="button"
				className={`${styles.trafficLight} ${styles.maximize}`}
				onClick={onZoom}
				aria-label="Zoom"
			>
				<svg
					className={`${styles.trafficIcon} ${styles.zoom}`}
					viewBox="0 0 8 8"
					aria-hidden="true"
				>
					<path className="stroke" d="M2.35 5.65V3.6" />
					<path className="stroke" d="M2.35 5.65H4.4" />
					<path className="stroke" d="M5.65 2.35H3.6" />
					<path className="stroke" d="M5.65 2.35V4.4" />
				</svg>
			</button>
		</div>
	);
}
