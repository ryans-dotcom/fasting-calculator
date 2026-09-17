#!/usr/bin/env node
// Nightly check for adverse driving conditions during the 4-7am commute
// window between Chicago and Naperville, IL. Fetches free NOAA/NWS
// forecasts (no API key required) and pushes a summary via ntfy.sh.
//
// Runs via .github/workflows/commute-weather-alert.yml on a schedule.

const CONTACT = 'ryan.schusler@gmail.com';
// api.weather.gov requires an identifying User-Agent.
const USER_AGENT = `(commute-weather-alerts, ${CONTACT})`;

const LOCATIONS = [
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Oak Brook (I-88 corridor)', lat: 41.8399, lon: -87.9645 },
  { name: 'Naperville', lat: 41.7508, lon: -88.1535 },
];

const ADVERSE_KEYWORDS = [
  'rain', 'snow', 'sleet', 'freezing', 'ice', 'icy',
  'thunderstorm', 'fog', 'hail', 'wintry mix', 'blizzard',
];

const PRECIP_PROB_THRESHOLD = 40; // percent
const WIND_THRESHOLD_MPH = 25;
const FREEZING_F = 32;
const COMMUTE_START_HOUR = 4;
const COMMUTE_END_HOUR = 7;

// Rough delay estimate by condition severity. This isn't live traffic data
// (nothing free gives a weather-adjusted ETA) — it's a rule-of-thumb bucket
// based on how bad the reported conditions are, calibrated loosely against
// typical real-world commute impact (e.g. steady/heavy rain running ~20min
// over normal). Treat it as a ballpark, not a prediction.
const SEVERITY_LEVELS = [
  { level: 0, headline: 'Normal commute time', priority: 3, tags: ['white_check_mark', 'car'] },
  { level: 1, headline: 'Extra 5-10 min expected', priority: 3, tags: ['fog', 'car'] },
  { level: 2, headline: 'Extra 10-20 min expected', priority: 4, tags: ['cloud_with_rain', 'car'] },
  { level: 3, headline: 'Extra 20-35 min expected', priority: 4, tags: ['warning', 'car'] },
  { level: 4, headline: 'Extra 35-60+ min expected — leave early', priority: 5, tags: ['rotating_light', 'car'] },
];

function formatChicagoDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function chicagoHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      hour12: false,
    }).format(date),
  );
}

function chicagoDateHour(isoString) {
  const d = new Date(isoString);
  return { date: formatChicagoDate(d), hour: chicagoHour(d) };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!res.ok) {
    throw new Error(`Request to ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function evaluatePeriod(period) {
  const flags = [];
  const shortForecast = (period.shortForecast || '').toLowerCase();
  const precipProb = period.probabilityOfPrecipitation?.value ?? 0;
  const tempF = period.temperature;
  const windNums = (period.windSpeed || '').match(/\d+/g)?.map(Number) ?? [];
  const maxWind = windNums.length ? Math.max(...windNums) : 0;

  if (ADVERSE_KEYWORDS.some((k) => shortForecast.includes(k))) {
    flags.push(period.shortForecast);
  }
  if (precipProb >= PRECIP_PROB_THRESHOLD) {
    flags.push(`${precipProb}% chance of precipitation`);
  }
  if (tempF <= FREEZING_F && precipProb > 0) {
    flags.push(`${tempF}°F with precip risk — possible ice`);
  }
  if (maxWind >= WIND_THRESHOLD_MPH) {
    flags.push(`high wind (${period.windSpeed})`);
  }
  return flags;
}

function severityOfPeriod(period) {
  const shortForecast = (period.shortForecast || '').toLowerCase();
  const precipProb = period.probabilityOfPrecipitation?.value ?? 0;
  const tempF = period.temperature;
  const windNums = (period.windSpeed || '').match(/\d+/g)?.map(Number) ?? [];
  const maxWind = windNums.length ? Math.max(...windNums) : 0;

  // Freezing rain/drizzle risks invisible ice and is worse than plain snow,
  // which already has its own tier below — don't let snow forecasts (which
  // are almost always at/below freezing) get swept into this branch.
  const iceRisk =
    tempF <= FREEZING_F && precipProb > 0 && !shortForecast.includes('snow') && !shortForecast.includes('flurries');
  const severeKeywords = ['blizzard', 'ice storm', 'freezing rain', 'sleet', 'freezing'];
  const significantKeywords = ['heavy rain', 'heavy snow', 'thunderstorm', 'snow'];
  const moderateKeywords = ['rain', 'showers', 'drizzle'];
  const minorKeywords = ['fog', 'mist', 'flurries'];

  if (iceRisk || severeKeywords.some((k) => shortForecast.includes(k))) {
    return 4;
  }
  if (significantKeywords.some((k) => shortForecast.includes(k)) || precipProb >= 70 || maxWind >= 35) {
    return 3;
  }
  if (moderateKeywords.some((k) => shortForecast.includes(k)) || precipProb >= PRECIP_PROB_THRESHOLD || maxWind >= WIND_THRESHOLD_MPH) {
    return 2;
  }
  if (minorKeywords.some((k) => shortForecast.includes(k)) || precipProb >= 20) {
    return 1;
  }
  return 0;
}

async function checkLocation(loc, targetDate) {
  const points = await fetchJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  const hourlyUrl = points.properties.forecastHourly;
  const hourly = await fetchJson(hourlyUrl);

  const periods = hourly.properties.periods.filter((p) => {
    const { date, hour } = chicagoDateHour(p.startTime);
    return date === targetDate && hour >= COMMUTE_START_HOUR && hour <= COMMUTE_END_HOUR;
  });

  const flags = new Set();
  const forecasts = new Set();
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let severity = 0;

  for (const p of periods) {
    evaluatePeriod(p).forEach((f) => flags.add(f));
    forecasts.add(p.shortForecast);
    minTemp = Math.min(minTemp, p.temperature);
    maxTemp = Math.max(maxTemp, p.temperature);
    severity = Math.max(severity, severityOfPeriod(p));
  }

  return {
    name: loc.name,
    flags: [...flags],
    forecasts: [...forecasts],
    tempRange: periods.length ? `${minTemp}–${maxTemp}°F` : 'no data',
    severity,
  };
}

async function sendNtfy({ title, message, priority, tags }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) throw new Error('NTFY_TOPIC environment variable is required');
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';

  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority, tags }),
  });
  if (!res.ok) {
    throw new Error(`ntfy publish failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  // GitHub's schedule trigger is best-effort and can run hours late. Rather
  // than gate on "is it exactly 10pm right now" (which silently skips a
  // delayed run and produces no notification at all), always send, and pick
  // the target commute date relative to whichever day it actually runs on:
  // before local noon means a late run has slipped past midnight and the
  // 4-7am window is still later *today*; otherwise it's tomorrow.
  const daysAhead = chicagoHour() < 12 ? 0 : 1;
  const targetDate = formatChicagoDate(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));
  const results = await Promise.all(LOCATIONS.map((loc) => checkLocation(loc, targetDate)));

  const overallSeverity = Math.max(...results.map((r) => r.severity));
  const { headline, priority, tags } = SEVERITY_LEVELS[overallSeverity];
  const lines = results.map((r) => {
    const status = r.flags.length ? `⚠️ ${r.flags.join('; ')}` : '✓ no issues flagged';
    return `${r.name}: ${r.tempRange}, ${r.forecasts.join('/') || 'no data'} — ${status}`;
  });

  const message = [
    `${headline} (estimate, not live traffic)`,
    '',
    `Chicago <-> Naperville commute, ${targetDate}, 4-7am:`,
    '',
    ...lines,
  ].join('\n');

  await sendNtfy({ title: headline, message, priority, tags });

  console.log(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
