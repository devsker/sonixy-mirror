import { X } from 'lucide-react';
import styles from './DropPrompt.module.css';

type Props = {
	onSelect: (action: 'copy' | 'move') => void;
	onCancel: () => void;
};

export default function DropPrompt({ onSelect, onCancel }: Props) {
	return (
		<div
			className={styles.modalBackdrop}
			onClick={onCancel}
			onKeyDown={(e) => e.key === 'Escape' && onCancel()}
			role="presentation"
		>
			<div
				className={styles.modalContent}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabIndex={-1}
			>
				<div className={styles.modalHeader}>
					<h3>Add Files to Collection</h3>
					<button type="button" className={styles.closeBtn} onClick={onCancel}>
						<X size={18} />
					</button>
				</div>
				<div className={styles.modalBody}>
					<p>How would you like to add these files to your collection?</p>
					<div className={styles.actions}>
						<button
							type="button"
							className={`${styles.actionBtn} ${styles.copy}`}
							onClick={() => onSelect('copy')}
						>
							<strong>Copy</strong>
							<span>Original files stay where they are</span>
						</button>
						<button
							type="button"
							className={`${styles.actionBtn} ${styles.move}`}
							onClick={() => onSelect('move')}
						>
							<strong>Move</strong>
							<span>Original files are moved to the collection</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
