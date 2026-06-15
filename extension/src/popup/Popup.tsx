export function Popup() {
  return (
    <main className="flex w-80 flex-col gap-3 bg-zinc-950 p-5 font-sans text-zinc-50">
      <header className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
        <h1 className="text-base font-semibold tracking-tight">Breathe</h1>
      </header>

      <p className="text-lg font-medium">Hello Breathe</p>

      <p className="text-sm leading-relaxed text-zinc-400">
        Private, local meeting notes. Nothing records until you press Start.
      </p>

      <span className="self-start rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-zinc-400">
        Local-only · Phase 0
      </span>
    </main>
  );
}
