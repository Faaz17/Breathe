import { useEffect, useState, useSyncExternalStore } from 'react';

import { capture } from '../capture';
import { dismissConsent, isConsentDismissed } from '../consent';
import { notifyChat, type NotifyResult } from '../notifyChat';
import { Message } from '../../lib/messages';
import { Launcher } from './Launcher';
import { SidePanel } from './SidePanel';

type View = 'launcher' | 'panel';
type NotifyState = 'idle' | 'pending' | NotifyResult;

function requestStop(): void {
  const message: Message = { type: 'STOP_RECORDING' };
  void chrome.runtime.sendMessage(message);
}

function requestSummarise(): void {
  // The service worker emits 'loading' once its checks pass and dedupes concurrent
  // calls with an in-flight guard, so a stray double-click is harmless here.
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
  const stopReason = useSyncExternalStore(subscribe, () => capture.getStopReason());
  const transcript = useSyncExternalStore(subscribe, () => capture.getTranscript());
  const sttState = useSyncExternalStore(subscribe, () => capture.getSttState());
  const sttProgress = useSyncExternalStore(subscribe, () => capture.getSttProgress());
  const sttMessage = useSyncExternalStore(subscribe, () => capture.getSttMessage());
  const summaryState = useSyncExternalStore(subscribe, () => capture.getSummaryState());
  const summaryMarkdown = useSyncExternalStore(subscribe, () => capture.getSummaryMarkdown());
  const summaryError = useSyncExternalStore(subscribe, () => capture.getSummaryError());

  // Consent notice: shown once per meeting URL until dismissed (loaded on mount).
  const [showConsent, setShowConsent] = useState(false);
  const [notifyState, setNotifyState] = useState<NotifyState>('idle');

  useEffect(() => {
    let active = true;
    void isConsentDismissed().then((dismissed) => {
      if (active) setShowConsent(!dismissed);
    });
    return () => {
      active = false;
    };
  }, []);

  // Auto-expand the panel when recording starts, so the VU meter is visible.
  useEffect(() => {
    if (recording) setView('panel');
  }, [recording]);

  // An unexpected stop must be visible (design rule: capture loss shows a
  // state) — a collapsed launcher would hide the interruption notice.
  useEffect(() => {
    if (stopReason === 'capture-lost' || stopReason === 'error') setView('panel');
  }, [stopReason]);

  async function handleNotify(): Promise<void> {
    setNotifyState('pending');
    setNotifyState(await notifyChat());
  }

  function handleDismissConsent(): void {
    setShowConsent(false);
    void dismissConsent();
  }

  if (view === 'launcher') {
    return <Launcher recording={recording} onOpen={() => setView('panel')} />;
  }

  return (
    <SidePanel
      recording={recording}
      stopReason={stopReason}
      transcript={transcript}
      sttState={sttState}
      sttProgress={sttProgress}
      sttMessage={sttMessage}
      summaryState={summaryState}
      summaryMarkdown={summaryMarkdown}
      summaryError={summaryError}
      showConsent={showConsent}
      notifyState={notifyState}
      onNotify={() => void handleNotify()}
      onDismissConsent={handleDismissConsent}
      onStop={requestStop}
      onCollapse={() => setView('launcher')}
      onSummarise={requestSummarise}
      onOpenOptions={openOptions}
    />
  );
}
