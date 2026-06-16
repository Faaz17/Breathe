import { z } from 'zod';

import type { SummaryError } from './messages';

/**
 * Groq client — the ONLY outbound network call in Breathe, and only when the user
 * clicks Summarise. OpenAI-compatible chat-completions endpoint. The transcript
 * never leaves the browser otherwise.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// llama-3.1-8b-instant has a large context; a long meeting still fits. Guard against
// pathological transcripts so we don't send a megabyte. ~48k chars ≈ ~12k tokens.
const MAX_TRANSCRIPT_CHARS = 48_000;
const RATE_LIMIT_RETRY_MS = 1_500;

const SYSTEM_PROMPT = `You turn a raw meeting transcript into concise notes.
Output GitHub-flavored Markdown with EXACTLY these three sections, in this order:

## Decisions
## Action Items
## Open Questions

Use "- " bullet points under each heading. For action items, name the owner if the
transcript makes it clear. If a section has nothing, write "- None". Be faithful to
the transcript — never invent decisions, owners, or facts. Keep it tight.`;

const GroqResponse = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export type SummariseResult =
  | { ok: true; markdown: string }
  | { ok: false; error: SummaryError };

function buildBody(transcript: string, model: string): string {
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
      : transcript;
  return JSON.stringify({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Transcript:\n\n${clipped}` },
    ],
  });
}

async function postOnce(body: string, apiKey: string): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });
}

export async function summarise(
  transcript: string,
  apiKey: string,
  model: string,
): Promise<SummariseResult> {
  if (!apiKey.trim()) return { ok: false, error: 'no-key' };
  if (!transcript.trim()) return { ok: false, error: 'empty' };

  const body = buildBody(transcript, model);

  let response: Response;
  try {
    response = await postOnce(body, apiKey);
    // Rate-limited: back off once, then retry (tech_defaults).
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
      response = await postOnce(body, apiKey);
    }
  } catch (error) {
    console.error('Breathe groq: request failed', error);
    return { ok: false, error: 'network' };
  }

  if (response.status === 401) return { ok: false, error: 'auth' };
  if (response.status === 429) return { ok: false, error: 'rate-limit' };
  if (!response.ok) return { ok: false, error: 'network' };

  const parsed = GroqResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: 'bad-response' };

  const markdown = parsed.data.choices[0]?.message.content.trim() ?? '';
  if (!markdown) return { ok: false, error: 'bad-response' };
  return { ok: true, markdown };
}
