<script lang="ts">
    import { X } from 'lucide-svelte';

    let { onSelect, onCancel }: { 
        onSelect: (action: 'copy' | 'move') => void, 
        onCancel: () => void 
    } = $props();
</script>

<div 
    class="modal-backdrop" 
    onclick={onCancel} 
    onkeydown={(e) => e.key === 'Escape' && onCancel()}
    role="presentation"
>
    <div 
        class="modal-content" 
        onclick={(e) => e.stopPropagation()} 
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div class="modal-header">
            <h3>Add Files to Collection</h3>
            <button class="close-btn" onclick={onCancel}><X size={18} /></button>
        </div>
        <div class="modal-body">
            <p>How would you like to add these files to your collection?</p>
            <div class="actions">
                <button class="action-btn copy" onclick={() => onSelect('copy')}>
                    <strong>Copy</strong>
                    <span>Original files stay where they are</span>
                </button>
                <button class="action-btn move" onclick={() => onSelect('move')}>
                    <strong>Move</strong>
                    <span>Original files are moved to the collection</span>
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }

    .modal-content {
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        width: 400px;
        max-width: 90vw;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
    }

    .modal-header h3 {
        margin: 0;
        font-size: 16px;
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
    }

    .modal-body {
        padding: 24px 20px;
    }

    .modal-body p {
        margin: 0 0 20px;
        font-size: 14px;
        color: var(--text-muted);
    }

    .actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .action-btn {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 12px 16px;
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        background: transparent;
        color: var(--text-color);
        cursor: pointer;
        transition: all 0.1s;
        text-align: left;
    }

    .action-btn:hover {
        border-color: var(--icon-active);
        background: rgba(0, 122, 204, 0.05);
    }

    .action-btn strong {
        font-size: 14px;
        margin-bottom: 2px;
    }

    .action-btn span {
        font-size: 12px;
        color: var(--text-muted);
    }
</style>
