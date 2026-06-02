import { useState } from 'react';
import { FileList } from '@/components/FileList';
import Waveform from '@/components/Waveform';
import { collectionStore } from '@/lib/collection-store';
import { audioPlayer } from '@/lib/audio-player';
import { collectionDisplayName } from '@/lib/collection-path';
import { useStoreVersion, useCollectionVersion, useAudioVersion } from '@/lib/store-sync';
import styles from './HomePage.module.css';

export default function HomePage() {
	useStoreVersion(useCollectionVersion);
	useStoreVersion(useAudioVersion);

	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const collectionPath = collectionStore.collectionPath;

	const displayId = audioPlayer.currentFileId || (selectedIds.length === 1 ? selectedIds[0] : null);

	return (
		<div className={styles.pageContainer} key={collectionPath ?? 'none'}>
			{collectionPath && (
				<div className={styles.waveformSection}>
					{collectionStore.showSwitchingUi ? (
						<div className={`${styles.selectionMessage} ${styles.switching}`}>
							Opening{' '}
							{collectionDisplayName(
								collectionStore.switchingToPath ?? collectionStore.collectionPath
							)}
							…
						</div>
					) : displayId ? (
						<Waveform id={displayId} />
					) : selectedIds.length > 1 ? (
						<div className={styles.selectionMessage}>More than one file selected</div>
					) : (
						<div className={styles.selectionMessage}>No file selected</div>
					)}
				</div>
			)}
			<FileList onSelectionChange={setSelectedIds} />
		</div>
	);
}
