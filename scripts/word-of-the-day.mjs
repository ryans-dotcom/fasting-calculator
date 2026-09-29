#!/usr/bin/env node
// Daily "word of the day" push notification: a challenging vocabulary word,
// its definition, and an example sentence, delivered via ntfy.sh.
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

async function sendNtfy({ title, message, tags, click }) {
  const topic = process.env.WORD_NTFY_TOPIC;
  if (!topic) throw new Error('WORD_NTFY_TOPIC environment variable is required');
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';

  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: 3, tags, click }),
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
    entry.definition,
    '',
    `“${entry.example}”`,
  ].join('\n');
  // Tapping the notification opens the full dictionary entry
  // (pronunciation, etymology, more examples).
  const click = `https://www.merriam-webster.com/dictionary/${encodeURIComponent(entry.word)}`;

  if (!args.dryRun) {
    await sendNtfy({ title, message, tags: ['books'], click });
  }

  console.log(`${date}${args.dryRun ? ' (dry run, not sent)' : ''}`);
  console.log(title);
  console.log(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
