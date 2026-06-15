interface LauncherProps {
  recording: boolean;
  onOpen: () => void;
}

export function Launcher({ recording, onOpen }: LauncherProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={recording ? 'Breathe — recording. Open notes' : 'Open Breathe notes'}
      className={`m-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 shadow-lg transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
        recording ? 'ring-2 ring-emerald-500' : 'ring-1 ring-zinc-800'
      }`}
    >
      <span className="h-3.5 w-3.5 rounded-full bg-emerald-500" aria-hidden="true" />
    </button>
  );
}
