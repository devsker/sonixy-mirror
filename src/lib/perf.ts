import { collectionStore } from './collection-store';
import { settingsStore } from './settings-store';

const PERF_QUERY_KEY = 'perf';

declare global {
	interface Window {
		__sonixyPerf?: PerfRecorder;
	}
}

type Sample = {
	label: string;
	durationMs: number;
	timestamp: number;
};

class PerfRecorder {
	enabled = false;
	samples: Sample[] = [];
	maxSamples = 500;

	constructor() {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(window.location.search);
		this.enabled = params.get(PERF_QUERY_KEY) === '1';
		if (!this.enabled) return;

		window.__sonixyPerf = this;
		console.info(
			'%c[perf] enabled — recording timings for computeDisplayedFiles, file re-renders, and search input.',
			'color:#7cc4ff'
		);

		this.observeFileChanges();
		this.observeSettingsChanges();
	}

	record(label: string, durationMs: number) {
		if (!this.enabled) return;
		this.samples.push({ label, durationMs, timestamp: performance.now() });
		if (this.samples.length > this.maxSamples) {
			this.samples.splice(0, this.samples.length - this.maxSamples);
		}
	}

	summary() {
		const grouped = new Map<string, number[]>();
		for (const s of this.samples) {
			const arr = grouped.get(s.label) ?? [];
			arr.push(s.durationMs);
			grouped.set(s.label, arr);
		}
		const lines: string[] = ['[perf] sample summary:'];
		for (const [label, values] of grouped) {
			const sorted = [...values].sort((a, b) => a - b);
			const sum = sorted.reduce((a, b) => a + b, 0);
			lines.push(
				`  ${label}: n=${sorted.length} avg=${(sum / sorted.length).toFixed(2)}ms p50=${sorted[Math.floor(sorted.length * 0.5)].toFixed(2)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)}ms max=${sorted[sorted.length - 1].toFixed(2)}ms`
			);
		}
		return lines.join('\n');
	}

	reset() {
		this.samples = [];
	}

	private observeFileChanges() {
		const original = collectionStore.notify.bind(collectionStore);
		collectionStore.notify = () => {
			const start = performance.now();
			original();
			const dt = performance.now() - start;
			if (dt > 0.5) this.record('notify', dt);
		};
	}

	private observeSettingsChanges() {
		const original = settingsStore.notify.bind(settingsStore);
		settingsStore.notify = () => {
			const start = performance.now();
			original();
			const dt = performance.now() - start;
			if (dt > 0.5) this.record('settingsNotify', dt);
		};
	}
}

export const perfRecorder = new PerfRecorder();

export function timeComputeDisplayed<T>(fn: () => T): T {
	if (!perfRecorder.enabled) return fn();
	const start = performance.now();
	const result = fn();
	const dt = performance.now() - start;
	perfRecorder.record('computeDisplayedFiles', dt);
	return result;
}

export function isPerfEnabled(): boolean {
	return perfRecorder.enabled;
}
