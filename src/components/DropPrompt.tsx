import { X } from 'lucide-react';

type Props = {
	onSelect: (action: 'copy' | 'move') => void;
	onCancel: () => void;
};

export default function DropPrompt({ onSelect, onCancel }: Props) {
	return (
		<div
			className="modal-backdrop"
			onClick={onCancel}
			onKeyDown={(e) => e.key === 'Escape' && onCancel()}
			role="presentation"
		>
			<div
				className="modal-content modal-content--compact"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabIndex={-1}
			>
				<div className="modal-header modal-header--bordered">
					<h3>Add Files to Collection</h3>
					<button type="button" className="modal-close-btn" onClick={onCancel}>
						<X size={18} />
					</button>
				</div>
				<div className="modal-body modal-body--padded">
					<p>How would you like to add these files to your collection?</p>
					<div className="drop-actions">
						<button type="button" className="drop-action-btn" onClick={() => onSelect('copy')}>
							<strong>Copy</strong>
							<span>Original files stay where they are</span>
						</button>
						<button type="button" className="drop-action-btn" onClick={() => onSelect('move')}>
							<strong>Move</strong>
							<span>Original files are moved to the collection</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
