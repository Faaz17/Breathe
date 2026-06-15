import { useState } from 'react';

import { Launcher } from './Launcher';
import { SidePanel } from './SidePanel';

type View = 'launcher' | 'panel';

export function PanelApp() {
  const [view, setView] = useState<View>('launcher');
  const [recording, setRecording] = useState(false);

  if (view === 'launcher') {
    return <Launcher onOpen={() => setView('panel')} />;
  }

  return (
    <SidePanel
      recording={recording}
      onToggleRecording={() => setRecording((prev) => !prev)}
      onCollapse={() => setView('launcher')}
    />
  );
}
