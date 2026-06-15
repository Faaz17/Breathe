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

export function PanelApp() {
  const [view, setView] = useState<View>('launcher');
  const recording = useSyncExternalStore(
    (onChange) => capture.subscribe(onChange),
    () => capture.isRecording(),
  );

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
      onStop={requestStop}
      onCollapse={() => setView('launcher')}
    />
  );
}
