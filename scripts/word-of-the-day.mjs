#!/usr/bin/env node
// Daily "word of the day" push notification: a challenging vocabulary word,
// how to pronounce it, its definition, and an example sentence, delivered
// via ntfy.sh.
//
// Words come from the curated list in scripts/words.json and rotate one per
// day (America/Chicago date), so the whole list plays through before any
// word repeats.
//
// Runs via .github/workflows/word-of-the-day.yml.
//
// Local preview (prints without sending):
//   node scripts/word-of-the-day.mjs --dry-run
//   node scripts/word-of-the-day.mjs --dry-run --date 2026-12-25

import { readFile } from 'node:fs/promises';

const WORDS_URL = new URL('./words.json', import.meta.url);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const POS_ABBREVIATIONS = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
};

function formatChicagoDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseArgs(argv) {
  const args = { dryRun: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--date') args.date = argv[++i];
  }
  return args;
}

// Whole days since 1970-01-01 for a YYYY-MM-DD date string. Using the
// calendar date (not a timestamp) keeps the pick stable for the entire
// Chicago day no matter what time the workflow actually runs.
function dayNumber(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${isoDate}"`);
  }
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

function pickWord(words, isoDate) {
  return words[dayNumber(isoDate) % words.length];
}

// Best-effort lookup of a recorded pronunciation from the free Dictionary
// API (no key required). Coverage is incomplete, especially for rarer words
// and multi-word phrases, so any failure just means no audio button — the
// written pronunciation from words.json is always included.
async function findAudioUrl(word) {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const entries = await res.json();
    const audios = entries
      .flatMap((e) => e.phonetics || [])
      .map((p) => p.audio)
      .filter(Boolean);
    // Prefer a US recording when there's a choice.
    return audios.find((a) => a.includes('-us.')) || audios[0] || null;
  } catch {
    return null;
  }
}

async function sendNtfy({ title, message, tags, click, actions }) {
  const topic = process.env.WORD_NTFY_TOPIC;
  if (!topic) throw new Error('WORD_NTFY_TOPIC environment variable is required');
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';

  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: 3, tags, click, actions }),
  });
  if (!res.ok) {
    throw new Error(`ntfy publish failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const words = JSON.parse(await readFile(WORDS_URL, 'utf8'));
  const date = args.date || formatChicagoDate(new Date());
  const entry = pickWord(words, date);

  const pos = POS_ABBREVIATIONS[entry.pos] || entry.pos;
  const title = `Word of the Day: ${entry.word}`;
  const message = [
    `${entry.word} (${pos})`,
    `Say it: ${entry.pronunciation}`,
    '',
    entry.definition,
    '',
    `“${entry.example}”`,
  ].join('\n');
  // Tapping the notification opens the full dictionary entry
  // (pronunciation, etymology, more examples).
  const click = `https://www.merriam-webster.com/dictionary/${encodeURIComponent(entry.word)}`;

  const audioUrl = await findAudioUrl(entry.word);
  const actions = audioUrl ? [{ action: 'view', label: '🔊 Hear it', url: audioUrl }] : [];

  if (!args.dryRun) {
    await sendNtfy({ title, message, tags: ['books'], click, actions });
  }

  console.log(`${date}${args.dryRun ? ' (dry run, not sent)' : ''}`);
  console.log(title);
  console.log(message);
  console.log(`Audio: ${audioUrl || 'none found'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
