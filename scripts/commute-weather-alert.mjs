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

  for (const p of periods) {
    evaluatePeriod(p).forEach((f) => flags.add(f));
    forecasts.add(p.shortForecast);
    minTemp = Math.min(minTemp, p.temperature);
    maxTemp = Math.max(maxTemp, p.temperature);
  }

  return {
    name: loc.name,
    flags: [...flags],
    forecasts: [...forecasts],
    tempRange: periods.length ? `${minTemp}–${maxTemp}°F` : 'no data',
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
  const isManualRun = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const hour = chicagoHour();

  // The workflow schedules two crons (one per DST offset) so that one of
  // them always lands at 10pm America/Chicago. Skip the one that doesn't.
  if (!isManualRun && hour !== 22) {
    console.log(`Skipping: current America/Chicago hour is ${hour}, not 22.`);
    return;
  }

  const targetDate = formatChicagoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const results = await Promise.all(LOCATIONS.map((loc) => checkLocation(loc, targetDate)));

  const anyAdverse = results.some((r) => r.flags.length > 0);
  const lines = results.map((r) => {
    const status = r.flags.length ? `⚠️ ${r.flags.join('; ')}` : '✓ no issues flagged';
    return `${r.name}: ${r.tempRange}, ${r.forecasts.join('/') || 'no data'} — ${status}`;
  });

  const title = anyAdverse
    ? 'Adverse driving conditions 4-7am tomorrow'
    : 'Commute weather looks clear (4-7am)';
  const message = [`Chicago <-> Naperville commute, ${targetDate}, 4-7am:`, '', ...lines].join('\n');

  await sendNtfy({
    title,
    message,
    priority: anyAdverse ? 4 : 3,
    tags: anyAdverse ? ['warning', 'car'] : ['white_check_mark', 'car'],
  });

  console.log(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
