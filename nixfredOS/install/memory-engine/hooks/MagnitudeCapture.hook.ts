#!/usr/bin/env bun
/**
 * MagnitudeCapture.hook.ts — persist big facts the same turn, unasked (UserPromptSubmit)
 *
 * Some facts matter for months: a new person or project, a settled decision, a
 * standing rule, something shipped or shut down, a change in the user's
 * situation. Recognising them is not enough; they have to be written down. When
 * the prompt carries one of those signals, this hook reminds the assistant to
 * save a memory file this turn without asking permission first.
 *
 * Deliberately conservative: it only fires on strong phrases, so normal turns stay quiet.
 *
 * INPUT:  stdin JSON { prompt | user_prompt, ... }
 * OUTPUT: a <user-prompt-submit-hook> block when a magnitude signal appears.
 * EXIT:   always 0. Fail-open. No network.
 */

import { join } from 'path';

const HOME = process.env.HOME || '';
const MEMORY_DIR = process.env.NIXFREDOS_MEMORY_DIR || join(HOME, '.claude', 'MEMORY', 'AUTO');

const SIGNALS: [string, RegExp][] = [
  ['standing rule', /\b(from now on|going forward|always do|never do|new rule|as a rule)\b/i],
  ['settled decision', /\b(we decided|i decided|final decision|decision is|let'?s go with|we'?re going with)\b/i],
  ['shipped or killed', /\b(we shipped|just shipped|went live|is live now|launched|shut (it )?down|killed (the|it)|deprecated)\b/i],
  ['new entity', /\b(new (client|project|teammate|hire|repo|company|partner)|meet my|introduc(e|ing) you to)\b/i],
  ['life change', /\b(new job|got the job|laid off|moving to|we moved|got married|had a baby|diagnosed)\b/i],
];

try {
  const input = JSON.parse(await Bun.stdin.text() || '{}');
  const prompt: string = input.prompt || input.user_prompt || '';
  const hits = SIGNALS.filter(([, re]) => re.test(prompt)).map(([k]) => k);
  if (hits.length) {
    console.log(`<user-prompt-submit-hook>
MAGNITUDE SIGNAL (${hits.join(', ')}): if this is a fact that will still matter in a month,
write it to ${MEMORY_DIR}/<short-kebab-name>.md (one fact, with frontmatter) and add the
MEMORY.md pointer THIS turn. Do not ask whether to save it; save it and mention it in one line.
Skip only if it is trivial or already recorded.
</user-prompt-submit-hook>`);
  }
} catch { /* fail-open */ }
process.exit(0);
