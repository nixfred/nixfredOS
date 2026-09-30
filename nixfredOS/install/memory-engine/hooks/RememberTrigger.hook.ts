#!/usr/bin/env bun
/**
 * RememberTrigger.hook.ts — "remember X" is a command, not a comment (UserPromptSubmit)
 *
 * When the prompt contains explicit retain-language ("remember ...", "don't
 * forget ...", "save this", "make a note ..."), inject a reminder that orders the
 * assistant to WRITE a memory file this turn, and hand it a short list of existing
 * memories that share words with the topic so the new fact gets linked, not filed flat.
 *
 * Memory lives in ~/.claude/MEMORY/AUTO/ (one fact per file) with an index at
 * ~/.claude/MEMORY/AUTO/MEMORY.md. Override with NIXFREDOS_MEMORY_DIR.
 *
 * INPUT:  stdin JSON { prompt | user_prompt, ... }
 * OUTPUT: a <user-prompt-submit-hook> block only when retain-language is present.
 * EXIT:   always 0. Fail-open: never blocks a prompt. No network.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME || '';
const MEMORY_DIR = process.env.NIXFREDOS_MEMORY_DIR || join(HOME, '.claude', 'MEMORY', 'AUTO');

const RETAIN: RegExp[] = [
  /\b(remember|don'?t forget|do not forget)\b[:,]?\s+(.*)/i,
  /\b(make a note|note this|save this|jot down|keep track of|file this under)\b[:,]?\s*(.*)/i,
];

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'about', 'from', 'remember', 'forget', 'save', 'note', 'please', 'just', 'what', 'when', 'have', 'will', 'your', 'our']);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []).filter(t => !STOP.has(t));
}

function related(topic: string): string[] {
  const want = new Set(tokens(topic));
  if (!want.size || !existsSync(MEMORY_DIR)) return [];
  const scored: [number, string][] = [];
  for (const f of readdirSync(MEMORY_DIR)) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    let text = f;
    try { text += ' ' + readFileSync(join(MEMORY_DIR, f), 'utf8').slice(0, 2000); } catch {}
    const have = new Set(tokens(text));
    let score = 0;
    for (const t of want) if (have.has(t)) score++;
    if (score) scored.push([score, f.replace(/\.md$/, '')]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, n]) => n);
}

try {
  const input = JSON.parse(await Bun.stdin.text() || '{}');
  const prompt: string = input.prompt || input.user_prompt || '';
  let topic: string | null = null;
  for (const re of RETAIN) {
    const m = prompt.match(re);
    if (m) { topic = (m[2] || '').trim().replace(/[.!?]+$/, ''); break; }
  }
  if (topic !== null) {
    const links = related(topic);
    console.log(`<user-prompt-submit-hook>
REMEMBER COMMAND: the user asked you to retain something${topic ? `: "${topic.slice(0, 200)}"` : ''}.
Write it THIS turn, before anything else:
  1. One fact per file in ${MEMORY_DIR}/<short-kebab-name>.md with frontmatter (name, description, metadata.type: user|feedback|project|reference).
  2. Add a one-line pointer to ${MEMORY_DIR}/MEMORY.md.
  3. Confirm in one line what you saved and where.
${links.length ? `Possibly related memories to link with [[name]]: ${links.join(', ')}` : 'No related memories found yet.'}
"I'll remember" with no file written is not remembering.
</user-prompt-submit-hook>`);
  }
} catch { /* fail-open */ }
process.exit(0);
