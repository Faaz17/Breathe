import { useEffect, useState, useSyncExternalStore } from 'react';

import { capture } from '../capture';
import { Message } from '../../lib/messages';
import { Launcher } from './Launcher';
import { SidePanel } from './SidePanel';

type View = 'launcher' | 'panel';

function requestStop(): void {
  const message: Message = { type: 'STOP_RECORDING' };
  void chrome.runtime.sendMessage(message);
}

function requestSummarise(): void {
  const message: Message = { type: 'SUMMARISE' };
  void chrome.runtime.sendMessage(message);
}

function openOptions(): void {
  const message: Message = { type: 'OPEN_OPTIONS' };
  void chrome.runtime.sendMessage(message);
}

export function PanelApp() {
  const [view, setView] = useState<View>('launcher');
  const subscribe = (onChange: () => void) => capture.subscribe(onChange);
  const recording = useSyncExternalStore(subscribe, () => capture.isRecording());
  const transcript = useSyncExternalStore(subscribe, () => capture.getTranscript());
  const sttState = useSyncExternalStore(subscribe, () => capture.getSttState());
  const sttProgress = useSyncExternalStore(subscribe, () => capture.getSttProgress());
  const sttMessage = useSyncExternalStore(subscribe, () => capture.getSttMessage());
  const summaryState = useSyncExternalStore(subscribe, () => capture.getSummaryState());
  const summaryMarkdown = useSyncExternalStore(subscribe, () => capture.getSummaryMarkdown());
  const summaryError = useSyncExternalStore(subscribe, () => capture.getSummaryError());

  // Auto-expand the panel when recording starts, so the VU meter is visible.
  useEffect(() => {
    if (recording) setView('panel');
  }, [recording]);

  if (view === 'launcher') {
    return <Launcher recording={recording} onOpen={() => setView('panel')} />;
  }

  return (
    <SidePanel
      recording={recording}
      transcript={transcript}
      sttState={sttState}
      sttProgress={sttProgress}
      sttMessage={sttMessage}
      summaryState={summaryState}
      summaryMarkdown={summaryMarkdown}
      summaryError={summaryError}
      onStop={requestStop}
      onCollapse={() => setView('launcher')}
      onSummarise={requestSummarise}
      onOpenOptions={openOptions}
    />
  );
}
