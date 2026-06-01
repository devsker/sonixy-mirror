<script lang="ts">
    import { Minus, Square, X, RefreshCw, Play, Volume2, FolderOpen, GripVertical, SkipBack, SkipForward } from 'lucide-svelte';
    import { type Settings } from '$lib/settings-store.svelte';
    import {
        TITLEBAR_WINDOW_CONTROLS_ID,
        resolveTitlebarStyle,
        usesLinuxWindowControls,
        usesMacTrafficLights,
        windowControlsPinLeft
    } from '$lib/platform';
    import MacTrafficLights from '$lib/components/MacTrafficLights.svelte';
    import LinuxWindowControls from '$lib/components/LinuxWindowControls.svelte';

    interface Props {
        settings: Settings;
    }

    let { settings }: Props = $props();

    const titlebarStyle = $derived(resolveTitlebarStyle(settings.titlebarStyle));
    const showMacTrafficLights = $derived(usesMacTrafficLights(titlebarStyle));
    const showLinuxWindowControls = $derived(usesLinuxWindowControls(titlebarStyle));
    const pinWindowControlsLeft = $derived(windowControlsPinLeft(titlebarStyle));

    const ALL_ELEMENTS = [
        { id: 'title', label: 'App Title', icon: null },
        { id: 'folder', label: 'Open Folder', icon: FolderOpen },
        { id: 'playback', label: 'Playback Controls', icon: Play },
        { id: 'volume', label: 'Volume Slider', icon: Volume2 },
        { id: 'tasks', label: 'Background Tasks', icon: null },
        { id: 'refresh', label: 'Refresh Button', icon: RefreshCw },
        { id: 'spacer', label: 'Flexible Spacer', icon: GripVertical }
    ];

    let sections = $derived.by(() => {
        const result = {
            left: [] as { id: string; index: number }[],
            center: [] as { id: string; index: number }[],
            right: [] as { id: string; index: number }[]
        };
        let currentSection: 'left' | 'center' | 'right' = 'left';

        settings.titlebarLayout.forEach((id, index) => {
            if (id === 'section:left') currentSection = 'left';
            else if (id === 'section:center') currentSection = 'center';
            else if (id === 'section:right') currentSection = 'right';
            else if (id !== TITLEBAR_WINDOW_CONTROLS_ID) {
                result[currentSection].push({ id, index });
            }
        });
        return result;
    });

    let draggedId = $state<string | null>(null);
    let draggedFromIndex = $state<number | null>(null);
    let dragOverSection = $state<'left' | 'center' | 'right' | 'pool' | null>(null);
    let dragOverIndex = $state<number | null>(null);

    function handleDragStart(e: DragEvent, id: string, index: number | null) {
        draggedId = id;
        draggedFromIndex = index;
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.effectAllowed = 'move';
            // Create a transparent drag image or just let it be default
        }
    }

    function handleDragOver(e: DragEvent, section: 'left' | 'center' | 'right' | 'pool', index: number | null = null) {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        dragOverSection = section;
        dragOverIndex = index;
    }

    function handleDragLeave(e: DragEvent) {
        // Only clear if we're actually leaving the container, not just moving between children
        const target = e.relatedTarget as HTMLElement;
        if (!target || !e.currentTarget || !(e.currentTarget as HTMLElement).contains(target)) {
            // dragOverSection = null;
            // dragOverIndex = null;
        }
    }

    function handleDrop(e: DragEvent, targetSection: 'left' | 'center' | 'right' | 'pool', targetLocalIndex: number | null = null) {
        e.preventDefault();
        if (!draggedId) return;

        let newLayout = [...settings.titlebarLayout];
        
        // 1. Remove from old position if it was in the layout
        // We do this by ID if it's not a spacer, or by index if we have it
        if (draggedFromIndex !== null) {
            newLayout.splice(draggedFromIndex, 1);
        }

        if (targetSection !== 'pool') {
            // 2. Find where to insert in the flat array
            const sectionMarker = `section:${targetSection}`;
            const markerIndex = newLayout.indexOf(sectionMarker);
            
            let insertIndex: number;
            if (targetLocalIndex === null) {
                // Drop at the end of the section
                const nextMarkers = ['section:left', 'section:center', 'section:right'].filter(m => m !== sectionMarker);
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
            
            newLayout.splice(insertIndex, 0, draggedId);
        }

        settings.titlebarLayout = newLayout;
        resetDragState();
    }

    function resetDragState() {
        draggedId = null;
        draggedFromIndex = null;
        dragOverSection = null;
        dragOverIndex = null;
    }

    function removeElement(index: number) {
        const newLayout = [...settings.titlebarLayout];
        newLayout.splice(index, 1);
        settings.titlebarLayout = newLayout;
    }

    let availableElements = $derived(
        ALL_ELEMENTS.filter(e => e.id === 'spacer' || !settings.titlebarLayout.includes(e.id))
    );
</script>

<div class="visualizer" role="presentation" ondragend={resetDragState}>
    <div class="titlebar mock">
        {#if pinWindowControlsLeft}
            <div class="titlebar-pinned titlebar-pinned-left">
                <div
                    class="window-controls"
                    class:macos={showMacTrafficLights}
                    class:linux={showLinuxWindowControls}
                >
                    {#if showMacTrafficLights}
                        <MacTrafficLights preview />
                    {:else if showLinuxWindowControls}
                        <LinuxWindowControls preview />
                    {:else}
                        <button class="control-btn" aria-label="Minimize">
                            <Minus size={14} />
                        </button>
                        <button class="control-btn" aria-label="Maximize">
                            <Square size={12} />
                        </button>
                        <button class="control-btn close-btn" aria-label="Close">
                            <X size={14} />
                        </button>
                    {/if}
                </div>
            </div>
        {/if}

        {#each ['left', 'center', 'right'] as section}
            {@const sectionData = sections[section as keyof typeof sections]}
            <div
                class="titlebar-section titlebar-{section} droppable-section"
                class:drag-over={dragOverSection === section && dragOverIndex === null}
                role="presentation"
                ondragover={(e) => handleDragOver(e, section as any)}
                ondrop={(e) => handleDrop(e, section as any)}
                ondragleave={handleDragLeave}
            >
                {#each sectionData as item, i (item.index + '-' + item.id)}
                    <div
                        class="element-wrapper"
                        class:drop-target={dragOverSection === section && dragOverIndex === i}
                        role="presentation"
                        draggable="true"
                        ondragstart={(e) => handleDragStart(e, item.id, item.index)}
                        ondragover={(e) => {
                            e.stopPropagation();
                            handleDragOver(e, section as any, i);
                        }}
                        ondrop={(e) => {
                            e.stopPropagation();
                            handleDrop(e, section as any, i);
                        }}
                    >
                        {#if item.id === 'title'}
                            <div class="title-container draggable-element">
                                <span class="title">Sonixy</span>
                            </div>
                        {:else if item.id === 'folder'}
                            <button class="folder-btn draggable-element" aria-label="Open Collection">
                                <FolderOpen size={14} />
                            </button>
                        {:else if item.id === 'playback'}
                            <div class="playback-controls draggable-element">
                                <button class="playback-btn" aria-label="Previous">
                                    <SkipBack size={14} fill="currentColor" />
                                </button>
                                <button class="playback-btn play-pause" aria-label="Play">
                                    <Play size={16} fill="currentColor" />
                                </button>
                                <button class="playback-btn" aria-label="Next">
                                    <SkipForward size={14} fill="currentColor" />
                                </button>
                            </div>
                        {:else if item.id === 'volume'}
                            <div class="volume-control draggable-element">
                                <button class="playback-btn volume-btn">
                                    <Volume2 size={14} />
                                </button>
                                <div class="volume-slider-mock"></div>
                            </div>
                        {:else if item.id === 'tasks'}
                            <div class="task-container draggable-element">
                                <button class="control-btn task-btn" aria-label="Background Tasks">
                                    <svg width="18" height="18" viewBox="0 0 18 18">
                                        <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" opacity="0.2"/>
                                        <circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent-color, #3b82f6)" stroke-width="2" stroke-dasharray="44" stroke-dashoffset="11" stroke-linecap="round" transform="rotate(-90 9 9)"/>
                                    </svg>
                                </button>
                            </div>
                        {:else if item.id === 'refresh'}
                            <button class="control-btn draggable-element" aria-label="Refresh">
                                <RefreshCw size={14} />
                            </button>
                        {:else if item.id === 'spacer'}
                            <div class="spacer draggable-element">
                                <div class="spacer-handle"><GripVertical size={10} /></div>
                            </div>
                        {/if}
                        
                        <button class="remove-btn" onclick={() => removeElement(item.index)} title="Remove">
                            <X size={8} />
                        </button>
                    </div>
                {/each}
                {#if sectionData.length === 0}
                    <div class="empty-placeholder">Empty</div>
                {/if}
            </div>
        {/each}

        {#if !pinWindowControlsLeft}
            <div class="titlebar-pinned titlebar-pinned-right">
                <div
                    class="window-controls"
                    class:macos={showMacTrafficLights}
                    class:linux={showLinuxWindowControls}
                >
                    {#if showMacTrafficLights}
                        <MacTrafficLights preview />
                    {:else if showLinuxWindowControls}
                        <LinuxWindowControls preview />
                    {:else}
                        <button class="control-btn" aria-label="Minimize">
                            <Minus size={14} />
                        </button>
                        <button class="control-btn" aria-label="Maximize">
                            <Square size={12} />
                        </button>
                        <button class="control-btn close-btn" aria-label="Close">
                            <X size={14} />
                        </button>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <div class="pool-container">
        <div
            class="element-pool"
            class:drag-over={dragOverSection === 'pool'}
            role="presentation"
            ondragover={(e) => handleDragOver(e, 'pool')}
            ondrop={(e) => handleDrop(e, 'pool')}
            ondragleave={handleDragLeave}
        >
            <div class="pool-label">Available:</div>
            {#each availableElements as el, i (el.id + '-' + i)}
                <div
                    class="pool-item"
                    role="presentation"
                    draggable="true"
                    title={el.label}
                    ondragstart={(e) => handleDragStart(e, el.id, null)}
                >
                    {#if el.icon}
                        <el.icon size={14} />
                    {:else if el.id === 'title'}
                        <span class="pool-text-icon">T</span>
                    {:else if el.id === 'tasks'}
                        <div class="circle-mock" style="width: 10px; height: 10px; border-width: 1px;"></div>
                    {:else}
                        <span class="pool-text-icon">{el.label[0]}</span>
                    {/if}
                </div>
            {/each}
            {#if availableElements.length === 0}
                <div class="empty-pool">None left</div>
            {/if}
        </div>
    </div>
</div>

<style>
    .visualizer {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-bottom: 8px;
        user-select: none;
        width: 100%;
        max-width: 800px;
    }

    /* Shared Titlebar Styles - Exact copy from Titlebar.svelte but scoped */
	.titlebar.mock {
		height: 30px;
		width: 100%;
		background: var(--sidebar-bg);
		display: flex !important;
		flex-direction: row !important;
		flex-wrap: nowrap !important;
		justify-content: space-between !important;
		align-items: center !important;
		border: 1px solid var(--border-color);
        border-radius: 4px;
		box-sizing: border-box;
        position: relative;
        overflow: visible; /* Allow drop target indicators to be visible */
        cursor: default;
	}

    .titlebar-section {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        height: 100% !important;
        min-width: 20px;
        flex-wrap: nowrap !important;
    }

    .titlebar-left {
        flex: 1;
        justify-content: flex-start;
    }

    .titlebar-center {
        flex: 0 1 auto;
        justify-content: center;
    }

    .titlebar-right {
        flex: 1;
        justify-content: flex-end;
    }

    .spacer {
        width: 24px;
        height: 100%;
        position: relative;
    }

    .spacer-handle {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        opacity: 0.2;
        color: var(--text-muted);
    }

	.title-container {
		display: flex;
		align-items: center;
		height: 100%;
		min-width: 0;
		padding: 0 12px;
	}

	.title {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

    .folder-btn {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--icon-color);
        border-radius: 4px;
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
        border-radius: 4px;
    }

    .playback-btn.play-pause {
        color: var(--text-main);
    }

    .volume-control {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 12px;
        height: 100%;
    }

    .volume-slider-mock {
        width: 60px;
        height: 3px;
        background: rgba(0, 0, 0, 0.1);
        border-radius: 2px;
        position: relative;
    }

    :global(html.dark) .volume-slider-mock {
        background: rgba(255, 255, 255, 0.1);
    }

    .volume-slider-mock::after {
        content: '';
        position: absolute;
        left: 30%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 8px;
        height: 8px;
        background: var(--text-muted);
        border-radius: 50%;
    }

    .window-controls {
        display: flex;
        height: 100%;
    }

    .titlebar-pinned {
        display: flex;
        align-items: center;
        height: 100%;
        flex-shrink: 0;
    }

    .titlebar-pinned-right {
        margin-left: auto;
    }

    .window-controls.macos,
    .window-controls.linux {
        display: flex;
        height: 100%;
    }

    .task-container {
        display: flex;
        height: 100%;
    }

    .task-btn {
        color: var(--text-muted);
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
        background: transparent;
        border: none;
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
		box-sizing: border-box;
	}

	.close-btn {
		color: var(--icon-color);
	}

    /* Visualizer Interaction Styles */
    .droppable-section {
        transition: background-color 0.2s;
        border: 1px transparent dashed;
    }

    .droppable-section.drag-over {
        background: rgba(var(--accent-color-rgb, 59, 130, 246), 0.1) !important;
        border-color: var(--accent-color, #3b82f6) !important;
    }

    .element-wrapper {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        height: 100%;
        position: relative;
        cursor: grab;
    }

    .element-wrapper:active {
        cursor: grabbing;
    }

    .draggable-element {
        pointer-events: none;
    }

    .element-wrapper:hover {
        background: rgba(0,0,0,0.05);
    }

    :global(html.dark) .element-wrapper:hover {
        background: rgba(255,255,255,0.05);
    }

    .drop-target::before {
        content: '';
        position: absolute;
        left: -1px;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--accent-color, #3b82f6);
        z-index: 200;
        box-shadow: 0 0 8px var(--accent-color, #3b82f6);
    }

    .remove-btn {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 14px;
        height: 14px;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s;
        z-index: 30;
        padding: 0;
        font-size: 8px;
    }

    .element-wrapper:hover .remove-btn {
        opacity: 1;
    }

    .empty-placeholder {
        font-size: 8px;
        color: var(--text-muted);
        opacity: 0.3;
        padding: 0 4px;
        font-style: italic;
    }

    /* Pool Styles */
    .pool-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
    }

    .element-pool {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: rgba(0, 0, 0, 0.02);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        min-height: 36px;
        transition: background-color 0.2s, border-color 0.2s;
    }

    :global(html.dark) .element-pool {
        background: rgba(255, 255, 255, 0.02);
    }

    .pool-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        margin-right: 4px;
    }

    .pool-item {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: var(--sidebar-bg);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: grab;
        transition: transform 0.1s, border-color 0.2s, background-color 0.2s;
        color: var(--icon-color);
    }

    .pool-item:hover {
        border-color: var(--icon-active);
        background-color: rgba(var(--accent-color-rgb, 59, 130, 246), 0.05);
        color: var(--icon-active);
    }

    .pool-text-icon {
        font-size: 10px;
        font-weight: 700;
    }

    .element-pool.drag-over {
        background: rgba(239, 68, 68, 0.05);
        border-color: #ef4444;
        border-style: dashed;
    }

    .circle-mock {
        width: 12px;
        height: 12px;
        border: 2px solid currentColor;
        border-radius: 50%;
    }

    .empty-pool {
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
    }
</style>
