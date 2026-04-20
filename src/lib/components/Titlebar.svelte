<script lang="ts">
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { Minus, Square, X, RefreshCw, CheckCircle2, AlertCircle, Loader2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1 } from 'lucide-svelte';
	import { collectionStore } from '$lib/collection-store.svelte';
	import { audioPlayer } from '$lib/audio-player.svelte';

	const appWindow = getCurrentWindow();
    let loading = $derived(collectionStore.loading);
    let collectionPath = $derived(collectionStore.collectionPath);
    let tasks = $derived(collectionStore.tasks);
    let showTasks = $state(false);

    let activeTasksCount = $derived(tasks.filter(t => t.status === 'running' || t.status === 'pending').length);
    let overallProgress = $derived(
        tasks.length > 0 
            ? tasks.reduce((acc, t) => acc + t.progress, 0) / tasks.length 
            : 0
    );

    let isPlaying = $derived(audioPlayer.isPlaying);
    let isWaitingToReplay = $derived(audioPlayer.isWaitingToReplay);
    let replayProgress = $derived(audioPlayer.replayProgress);
    let volume = $derived(audioPlayer.volume);
    let currentFileId = $derived(audioPlayer.currentFileId);

	async function minimize() {
		await appWindow.minimize();
	}

	async function toggleMaximize() {
		if (await appWindow.isMaximized()) {
			await appWindow.unmaximize();
		} else {
			await appWindow.maximize();
		}
	}

	async function close() {
		await appWindow.close();
	}

    function toggleTasks(e: MouseEvent) {
        e.stopPropagation();
        showTasks = !showTasks;
    }

    function closeTasks() {
        showTasks = false;
    }

    function handleVolumeWheel(e: WheelEvent) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        audioPlayer.setVolume(audioPlayer.volume + delta);
    }

    function blur(e: MouseEvent) {
        (e.currentTarget as HTMLElement).blur();
    }
</script>

<svelte:window onclick={closeTasks} />

<div data-tauri-drag-region class="titlebar">
	<div data-tauri-drag-region class="title-section">
		<span class="title">Sonixy</span>
	</div>

    <div class="playback-controls">
        <button class="playback-btn" onclick={(e) => { audioPlayer.previous(); blur(e); }} aria-label="Previous">
            <SkipBack size={14} fill="currentColor" />
        </button>
        <button class="playback-btn play-pause" onclick={(e) => { audioPlayer.toggle(); blur(e); }} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {#if isWaitingToReplay}
                <svg width="18" height="18" viewBox="0 0 18 18">
                    <circle 
                        cx="9" cy="9" r="7" 
                        fill="none" 
                        stroke="currentColor" 
                        stroke-width="2" 
                        opacity="0.2"
                    />
                    <circle 
                        cx="9" cy="9" r="7" 
                        fill="none" 
                        stroke="currentColor" 
                        stroke-width="2" 
                        stroke-dasharray="44" 
                        stroke-dashoffset={44 - (44 * replayProgress)}
                        stroke-linecap="round"
                        transform="rotate(-90 9 9)"
                    />
                </svg>
            {:else if isPlaying}
                <Pause size={16} fill="currentColor" />
            {:else}
                <Play size={16} fill="currentColor" />
            {/if}
        </button>
        <button class="playback-btn" onclick={(e) => { audioPlayer.next(); blur(e); }} aria-label="Next">
            <SkipForward size={14} fill="currentColor" />
        </button>

        <div class="volume-control" onwheel={handleVolumeWheel}>
            <button class="playback-btn volume-btn" onclick={(e) => { audioPlayer.toggleMute(); blur(e); }}>
                {#if volume === 0}
                    <VolumeX size={14} />
                {:else if volume < 0.5}
                    <Volume1 size={14} />
                {:else}
                    <Volume2 size={14} />
                {/if}
            </button>
            <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={volume} 
                oninput={(e) => audioPlayer.setVolume(parseFloat(e.currentTarget.value))}
                class="volume-slider"
            />
        </div>
    </div>

	<div class="controls">
        {#if collectionPath}
            <div class="task-container" onclick={(e) => e.stopPropagation()}>
                <button 
                    class="control-btn task-btn" 
                    onclick={toggleTasks} 
                    aria-label="Tasks"
                    class:active={activeTasksCount > 0}
                >
                    <svg width="18" height="18" viewBox="0 0 18 18">
                        <circle 
                            cx="9" cy="9" r="7" 
                            fill="none" 
                            stroke="currentColor" 
                            stroke-width="2" 
                            opacity="0.2"
                        />
                        <circle 
                            cx="9" cy="9" r="7" 
                            fill="none" 
                            stroke="var(--accent-color, #3b82f6)" 
                            stroke-width="2" 
                            stroke-dasharray="44" 
                            stroke-dashoffset={44 - (44 * overallProgress / 100)}
                            stroke-linecap="round"
                            transform="rotate(-90 9) "
                        />
                    </svg>
                </button>

                {#if showTasks}
                    <div class="tasks-popover">
                        <div class="popover-header">
                            <span>Background Tasks</span>
                        </div>
                        <div class="tasks-list">
                            {#if tasks.length === 0}
                                <div class="no-tasks">No active tasks</div>
                            {:else}
                                {#each tasks as task (task.id)}
                                    <div class="task-item">
                                        <div class="task-info">
                                            <span class="task-name">{task.name}</span>
                                            <div class="task-status">
                                                {#if task.status === 'running'}
                                                    <Loader2 size={12} class="animate-spin" />
                                                {:else if task.status === 'completed'}
                                                    <CheckCircle2 size={12} color="var(--success-color, #22c55e)" />
                                                {:else if task.status === 'failed'}
                                                    <AlertCircle size={12} color="var(--error-color, #ef4444)" />
                                                {/if}
                                                <span>{Math.round(task.progress)}%</span>
                                            </div>
                                        </div>
                                        <div class="task-progress-bar">
                                            <div 
                                                class="progress-fill" 
                                                style="width: {task.progress}%"
                                                class:completed={task.status === 'completed'}
                                                class:failed={task.status === 'failed'}
                                            ></div>
                                        </div>
                                        {#if task.message}
                                            <span class="task-message">{task.message}</span>
                                        {/if}
                                    </div>
                                {/each}
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>

            <button class="control-btn" onclick={() => collectionStore.refresh()} aria-label="Refresh" disabled={loading}>
                <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
            </button>
        {/if}
		<button class="control-btn" onclick={minimize} aria-label="Minimize">
			<Minus size={14} />
		</button>
		<button class="control-btn" onclick={toggleMaximize} aria-label="Maximize">
			<Square size={12} />
		</button>
		<button class="control-btn close-btn" onclick={close} aria-label="Close">
			<X size={14} />
		</button>
	</div>
</div>

<style>
	.titlebar {
		height: 30px;
		width: 100%;
		flex-shrink: 0;
		background: var(--sidebar-bg);
		user-select: none;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		justify-content: flex-start;
		align-items: center;
		border-bottom: 1px solid var(--border-color);
		z-index: 1000;
		box-sizing: border-box;
	}

	.title-section {
		flex: 1;
		display: flex;
		align-items: center;
		height: 100%;
		min-width: 0;
		padding-left: 12px;
	}

	.title {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

    .playback-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        height: 100%;
    }

    .playback-btn {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--icon-color);
        cursor: default;
        border-radius: 4px;
        transition: background-color 0.1s, color 0.1s;
    }

    .playback-btn:hover {
        background: rgba(0, 0, 0, 0.05);
        color: var(--icon-hover);
    }

    :global(html.dark) .playback-btn:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .playback-btn.play-pause {
        color: var(--text-main);
    }

    .volume-control {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 12px;
        padding-left: 12px;
        border-left: 1px solid var(--border-color);
        height: 16px;
    }

    .volume-slider {
        width: 60px;
        height: 3px;
        -webkit-appearance: none;
        background: rgba(0, 0, 0, 0.1);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
    }

    :global(html.dark) .volume-slider {
        background: rgba(255, 255, 255, 0.1);
    }

    .volume-slider::-webkit-slider-runnable-track {
        height: 3px;
    }

    .volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px;
        height: 10px;
        margin-top: -3.5px;
        background: var(--text-muted);
        border-radius: 50%;
        cursor: pointer;
        transition: background 0.1s, transform 0.1s;
        border: none;
    }

    .volume-slider:hover::-webkit-slider-thumb {
        background: var(--accent-color, #3b82f6);
        transform: scale(1.2);
    }

	.controls {
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		height: 100%;
		flex-shrink: 0;
	}

    .task-container {
        position: relative;
        display: flex;
        height: 100%;
    }

    .task-btn {
        position: relative;
        color: var(--text-muted);
    }

    .task-btn.active {
        color: var(--accent-color, #3b82f6);
    }

    .tasks-popover {
        position: absolute;
        top: 30px;
        right: 0;
        width: 250px;
        background: var(--sidebar-bg);
        border: 1px solid var(--border-color);
        border-top: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        max-height: 400px;
    }

    .popover-header {
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        background: rgba(0, 0, 0, 0.02);
    }

    .tasks-list {
        padding: 4px 0;
        overflow-y: auto;
    }

    .no-tasks {
        padding: 20px;
        text-align: center;
        font-size: 11px;
        color: var(--text-muted);
    }

    .task-item {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    :global(html.dark) .task-item {
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .task-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }

    .task-name {
        font-size: 11px;
        font-weight: 500;
        color: var(--text-main);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .task-status {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--text-muted);
    }

    .task-progress-bar {
        height: 3px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 2px;
        overflow: hidden;
    }

    :global(html.dark) .task-progress-bar {
        background: rgba(255, 255, 255, 0.1);
    }

    .progress-fill {
        height: 100%;
        background: var(--accent-color, #3b82f6);
        transition: width 0.3s ease;
    }

    .progress-fill.completed {
        background: var(--success-color, #22c55e);
    }

    .progress-fill.failed {
        background: var(--error-color, #ef4444);
    }

    .task-message {
        font-size: 9px;
        color: var(--text-muted);
        font-style: italic;
    }

	.control-btn {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 45px;
		height: 100%;
		border: none;
		background: transparent;
		color: var(--icon-color);
		cursor: default;
		transition: background-color 0.1s, color 0.1s;
		box-sizing: border-box;
	}

	.control-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--icon-hover);
	}

    .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

	:global(html.dark) .control-btn:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.close-btn:hover {
		background-color: #e81123 !important;
		color: white !important;
	}

    :global(.animate-spin) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
