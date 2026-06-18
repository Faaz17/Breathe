import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, XSS-safe Markdown → React for the structured summary (headings +
 * bullets + **bold**). React escapes all text, so no dangerouslySetInnerHTML.
 * Shared by the in-meeting panel (SummaryView) and the History page.
 */

function renderInline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className="font-semibold text-zinc-100">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export function renderMarkdown(markdown: string): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-0.5 marker:text-zinc-600">
        {items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      flushBullets();
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="mt-2 text-sm font-semibold text-zinc-100">
          {renderInline(line.replace(/^#{1,6}\s+/, ''))}
        </h3>,
      );
    } else if (/^[-*]\s/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''));
    } else if (line === '') {
      flushBullets();
    } else {
      flushBullets();
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
    }
  }
  flushBullets();

  return <div className="flex flex-col gap-1">{blocks}</div>;
}
