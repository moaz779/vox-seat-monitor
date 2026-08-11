#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

loadDotEnv(path.join(__dirname, '.env'));

const CONFIG = {
  baseUrl: env('VOX_BASE_URL', 'https://egy.voxcinemas.com'),
  city: env('VOX_CITY', 'city-centre-almaza'),
  movie: env('VOX_MOVIE', 'the-odyssey'),
  experience: env('VOX_EXPERIENCE', 'IMAX'),
  lookaheadDays: numberEnv('VOX_LOOKAHEAD_DAYS', 30),
  startDate: env('VOX_START_DATE', ''),
  endDate: env('VOX_END_DATE', ''),
  pollMinutes: numberEnv('VOX_POLL_MINUTES', 5),
  pageWaitMs: numberEnv('VOX_PAGE_WAIT_MS', 10000),
  bookingWaitMs: numberEnv('VOX_BOOKING_WAIT_MS', 20000),
  httpTimeoutMs: numberEnv('VOX_HTTP_TIMEOUT_MS', 10000),
  httpRetries: numberEnv('VOX_HTTP_RETRIES', 0, { allowZero: true }),
  httpRetryDelayMs: numberEnv('VOX_HTTP_RETRY_DELAY_MS', 1000),
  abortDateScanOnFirstFailure: boolEnv('VOX_ABORT_SCAN_ON_FIRST_DATE_FAILURE', false),
  showtimeFetchMode: env('VOX_SHOWTIME_FETCH_MODE', 'http').toLowerCase(),
  showtimeBrowserFetchTimeoutMs: numberEnv('VOX_SHOWTIME_BROWSER_FETCH_TIMEOUT_MS', 15000),
  parallelDateScans: numberEnv('VOX_PARALLEL_DATE_SCANS', 6),
  domWaitIntervalMs: numberEnv('VOX_DOM_WAIT_INTERVAL_MS', 250),
  cdpTimeoutMs: numberEnv('VOX_CDP_TIMEOUT_MS', 45000),
  stateFile: env('VOX_STATE_FILE', path.join(__dirname, 'state.json')),
  telegramOffsetFile: env('VOX_TELEGRAM_OFFSET_FILE', path.join(__dirname, 'telegram-offset.json')),
  networkMeasurementFile: env('VOX_NETWORK_MEASUREMENT_FILE', path.join(__dirname, 'network-measurements.jsonl')),
  interestedRows: parseSeatRows(env('VOX_INTERESTED_ROWS', 'E,F,G,H,J,K,L')),
  interestedMinSeat: numberEnv('VOX_INTERESTED_MIN_SEAT', 7),
  interestedMaxSeat: numberEnv('VOX_INTERESTED_MAX_SEAT', 18),
  prioritySeatKeys: parsePrioritySeats(env('VOX_PRIORITY_SEATS', 'H:16,15,14,13,12;J:16,15,14,13,12;K:16,15,14,13,12')),
  chromePath: env('VOX_CHROME_PATH', findBrowserPath()),
  telegramToken: env('TELEGRAM_BOT_TOKEN', ''),
  telegramChatId: env('TELEGRAM_CHAT_ID', ''),
  disableTelegram: boolEnv('VOX_DISABLE_TELEGRAM', false) || process.argv.includes('--disable-telegram'),
  telegramCommands: boolEnv('VOX_TELEGRAM_COMMANDS', true),
  telegramCommandTimeoutSeconds: numberEnv('VOX_TELEGRAM_COMMAND_TIMEOUT_SECONDS', 25),
  sendEveryCheck: boolEnv('VOX_SEND_EVERY_CHECK', false),
  notifySeatChanges: boolEnv('VOX_NOTIFY_SEAT_CHANGES', true),
  autoSeatCheckMode: env('VOX_AUTO_SEAT_CHECK_MODE', 'release').toLowerCase(),
  fullSeatCheckEveryMinutes: numberEnv('VOX_FULL_SEAT_CHECK_EVERY_MINUTES', 0, { allowZero: true }),
  skipUnavailableListings: boolEnv('VOX_SKIP_UNAVAILABLE_LISTINGS', false),
  headless: boolEnv('VOX_HEADLESS', true),
  chromeNoSandbox: boolEnv('VOX_CHROME_NO_SANDBOX', process.platform === 'linux'),
  blockAssets: boolEnv('VOX_BLOCK_ASSETS', true),
  measureNetwork: boolEnv('VOX_MEASURE_NETWORK', false) || process.argv.includes('--measure-network'),
  persistLastRun: boolEnv('VOX_PERSIST_LAST_RUN', true),
  persistSeenTimestamps: boolEnv('VOX_PERSIST_SEEN_TIMESTAMPS', true),
  debug: boolEnv('VOX_DEBUG', false),
};

const ONCE = process.argv.includes('--once');
const NO_SEATS = process.argv.includes('--no-seats');
const CHECK_DATE_INPUT = getCheckDateInput();
const CHECK_DATE = CHECK_DATE_INPUT ? parseCommandDate(CHECK_DATE_INPUT) : '';
const NETWORK_MEASURE = createNetworkMeasure();

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function numberEnv(name, fallback, options = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  if (value > 0) return value;
  if (options.allowZero && value === 0) return value;
  return fallback;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function createNetworkMeasure() {
  return {
    enabled: !!CONFIG.measureNetwork,
    context: '',
    startedAt: '',
    totalBytes: 0,
    requestCount: 0,
    sources: {},
    labels: {},
  };
}

function resetNetworkMeasure(context) {
  if (!NETWORK_MEASURE.enabled) return;
  NETWORK_MEASURE.context = context;
  NETWORK_MEASURE.startedAt = new Date().toISOString();
  NETWORK_MEASURE.totalBytes = 0;
  NETWORK_MEASURE.requestCount = 0;
  NETWORK_MEASURE.sources = {};
  NETWORK_MEASURE.labels = {};
}

function recordNetworkBytes(source, label, bytes, url = '') {
  if (!NETWORK_MEASURE.enabled) return;
  const measuredBytes = Number(bytes);
  if (!Number.isFinite(measuredBytes) || measuredBytes <= 0) return;

  NETWORK_MEASURE.totalBytes += measuredBytes;
  NETWORK_MEASURE.requestCount++;

  const sourceKey = source || 'unknown';
  const labelKey = label || 'unlabeled';
  NETWORK_MEASURE.sources[sourceKey] = NETWORK_MEASURE.sources[sourceKey] || { bytes: 0, requests: 0 };
  NETWORK_MEASURE.sources[sourceKey].bytes += measuredBytes;
  NETWORK_MEASURE.sources[sourceKey].requests++;

  const key = `${sourceKey}: ${labelKey}`;
  NETWORK_MEASURE.labels[key] = NETWORK_MEASURE.labels[key] || { source: sourceKey, label: labelKey, bytes: 0, requests: 0, sampleUrl: url };
  NETWORK_MEASURE.labels[key].bytes += measuredBytes;
  NETWORK_MEASURE.labels[key].requests++;
  if (!NETWORK_MEASURE.labels[key].sampleUrl && url) NETWORK_MEASURE.labels[key].sampleUrl = url;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value.toFixed(0)} B`;
}

function formatNetworkMeasureSummary() {
  if (!NETWORK_MEASURE.enabled) return '';
  const lines = [];
  lines.push(`Network measurement (${NETWORK_MEASURE.context})`);
  lines.push(`Total: ${formatBytes(NETWORK_MEASURE.totalBytes)} across ${NETWORK_MEASURE.requestCount} measured response(s)`);
  for (const [source, stats] of Object.entries(NETWORK_MEASURE.sources).sort()) {
    lines.push(`- ${source}: ${formatBytes(stats.bytes)} across ${stats.requests} response(s)`);
  }
  const topLabels = Object.values(NETWORK_MEASURE.labels)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);
  if (topLabels.length) {
    lines.push('Top labels:');
    for (const item of topLabels) {
      lines.push(`- ${item.label}: ${formatBytes(item.bytes)} across ${item.requests} response(s)`);
    }
  }
  return lines.join('\n');
}

function saveNetworkMeasure(extra = {}) {
  if (!NETWORK_MEASURE.enabled) return;
  const record = {
    ...extra,
    context: NETWORK_MEASURE.context,
    startedAt: NETWORK_MEASURE.startedAt,
    finishedAt: new Date().toISOString(),
    totalBytes: NETWORK_MEASURE.totalBytes,
    totalFormatted: formatBytes(NETWORK_MEASURE.totalBytes),
    requestCount: NETWORK_MEASURE.requestCount,
    sources: NETWORK_MEASURE.sources,
    labels: NETWORK_MEASURE.labels,
  };
  fs.appendFileSync(CONFIG.networkMeasurementFile, `${JSON.stringify(record)}\n`);
}

function parseSeatRows(value) {
  return String(value || '')
    .split(/[,\s/]+/)
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
}

function parsePrioritySeats(value) {
  const seats = new Set();
  for (const group of String(value || '').split(';')) {
    const [rowPart, numbersPart] = group.split(':');
    const row = String(rowPart || '').trim().toUpperCase();
    if (!row || !numbersPart) continue;
    for (const number of numbersPart.split(/[,\s/]+/)) {
      const parsed = Number(number);
      if (Number.isFinite(parsed)) seats.add(`${row}-${parsed}`);
    }
  }
  return seats;
}

function findBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function parseYmd(value, label) {
  if (!value) return null;
  if (!/^\d{8}$/.test(value)) throw new Error(`${label} must use YYYYMMDD format, for example 20260820.`);
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`);
}

function scanStartDate() {
  const configured = parseYmd(CONFIG.startDate, 'VOX_START_DATE');
  if (configured) return configured;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildTargetDates() {
  const start = scanStartDate();
  const end = parseYmd(CONFIG.endDate, 'VOX_END_DATE');
  const dates = [];

  if (end) {
    if (end < start) throw new Error('VOX_END_DATE must be the same as or after VOX_START_DATE/today.');
    for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
      dates.push(formatDateYmd(date));
    }
    return dates;
  }

  for (let offset = 0; offset < CONFIG.lookaheadDays; offset++) {
    dates.push(formatDateYmd(addDays(start, offset)));
  }
  return dates;
}

function showtimesUrl(dateYmd) {
  const params = new URLSearchParams({ c: CONFIG.city, m: CONFIG.movie, d: dateYmd });
  return `${CONFIG.baseUrl}/showtimes?${params.toString()}`;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function decodeHtml(text) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (entities[lower]) return entities[lower];
    if (lower.startsWith('#x')) {
      const parsed = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    if (lower.startsWith('#')) {
      const parsed = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    return entity;
  });
}

function stripHtml(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function htmlAttribute(source, name) {
  const match = String(source || '').match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeHtml(match[2] || match[3] || match[4] || '') : '';
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= CONFIG.httpRetries; attempt++) {
    try {
      return await fetchTextAttempt(url);
    } catch (error) {
      lastError = normalizeFetchError(error);
      if (attempt >= CONFIG.httpRetries || !isRetryableFetchError(lastError)) throw lastError;
      const waitMs = CONFIG.httpRetryDelayMs * (attempt + 1);
      log(`Retrying ${url} after ${lastError.message}; attempt ${attempt + 2}/${CONFIG.httpRetries + 1} in ${waitMs}ms.`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function fetchTextAttempt(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.httpTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    const text = await response.text();
    const contentLength = Number(response.headers.get('content-length'));
    const measuredBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : Buffer.byteLength(text, 'utf8');
    recordNetworkBytes('node-fetch', 'showtime-date-html', measuredBytes, response.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${normalize(stripHtml(text)).slice(0, 180)}`);
    return { url: response.url, text };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`HTTP request timed out after ${CONFIG.httpTimeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFetchError(error) {
  if (error.name === 'AbortError') return new Error(`HTTP request timed out after ${CONFIG.httpTimeoutMs}ms`);
  return error;
}

function isRetryableFetchError(error) {
  const message = String(error && error.message || error || '');
  return /timed out|fetch failed|ECONN|ETIMEDOUT|ECONNRESET|ENOTFOUND|HTTP 429|HTTP 5\d\d/i.test(message);
}

function parseShowtimesHtml(html, dateYmd, sourceUrl) {
  const wantedExperience = CONFIG.experience.toLowerCase();
  const showtimes = [];
  const source = String(html || '');
  const showtimesMatch = source.match(/<ol\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bshowtimes\b)[^>]*>/i);
  const afterShowtimes = showtimesMatch ? source.slice(showtimesMatch.index) : source;
  const sectionEnd = afterShowtimes.search(/<\/main>|<footer\b/i);
  const section = sectionEnd >= 0 ? afterShowtimes.slice(0, sectionEnd) : afterShowtimes;

  const experiencePattern = /<strong\b[^>]*>([\s\S]*?)<\/strong>\s*<ol\b[^>]*>([\s\S]*?)<\/ol>/gi;
  for (const experienceMatch of section.matchAll(experiencePattern)) {
    const experience = normalize(stripHtml(experienceMatch[1]));
    if (experience.toLowerCase() !== wantedExperience) continue;

    const timePattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
    for (const timeMatch of experienceMatch[2].matchAll(timePattern)) {
      const attrs = timeMatch[1] || '';
      const body = timeMatch[2] || '';
      const text = normalize(stripHtml(body));
      const parsedTime = text.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm))\b/i);
      if (!parsedTime) continue;

      const href = htmlAttribute(body, 'href');
      const bookingId = htmlAttribute(attrs, 'data-id') || htmlAttribute(body, 'data-id') || (href.match(/\/booking\/([^/?#]+)/) || [])[1] || '';
      const absoluteHref = href ? new URL(href, CONFIG.baseUrl).href : (bookingId ? `${CONFIG.baseUrl}/booking/${bookingId}` : '');
      const unavailable = /\bunavailable\b/i.test(`${attrs} ${body}`);

      showtimes.push({
        key: [dateYmd, experience.toUpperCase(), parsedTime[1].replace(/\s+/g, '').toLowerCase()].join('|'),
        date: dateYmd,
        time: parsedTime[1].replace(/\s+/g, ''),
        experience: experience.toUpperCase(),
        href: absoluteHref,
        bookingId,
        listingStatus: unavailable ? 'listed-unavailable' : 'bookable',
      });
    }
  }

  return {
    url: sourceUrl,
    title: '',
    pageText: normalize(stripHtml(html)).slice(0, 500),
    showtimes,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit), items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: cappedLimit }, worker));
  return results;
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    return {
      showtimes: state.showtimes || {},
      seatSnapshots: state.seatSnapshots || {},
      prioritySnapshots: state.prioritySnapshots || {},
      releasedDates: state.releasedDates || {},
      lastRunAt: state.lastRunAt || null,
      lastFullSeatCheckAt: state.lastFullSeatCheckAt || null,
      lastDateScanFailureSignature: state.lastDateScanFailureSignature || null,
      hasSentBaseline: !!state.hasSentBaseline,
    };
  } catch {
    return { showtimes: {}, seatSnapshots: {}, prioritySnapshots: {}, releasedDates: {}, lastRunAt: null, lastFullSeatCheckAt: null, lastDateScanFailureSignature: null, hasSentBaseline: false };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(CONFIG.stateFile), { recursive: true });
  const tmpFile = `${CONFIG.stateFile}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpFile, CONFIG.stateFile);
}

function loadTelegramOffset() {
  try {
    const state = JSON.parse(fs.readFileSync(CONFIG.telegramOffsetFile, 'utf8'));
    return Number.isFinite(state.offset) ? state.offset : null;
  } catch {
    return null;
  }
}

function saveTelegramOffset(offset) {
  const tmpFile = `${CONFIG.telegramOffsetFile}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify({ offset }, null, 2)}\n`);
  fs.renameSync(tmpFile, CONFIG.telegramOffsetFile);
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function debug(...args) {
  if (CONFIG.debug) console.error(new Date().toISOString(), '[debug]', ...args);
}

class ChromeSession {
  constructor() {
    if (!CONFIG.chromePath) throw new Error('Chrome or Edge was not found. Set VOX_CHROME_PATH to your browser executable.');
    this.port = 12000 + Math.floor(Math.random() * 20000);
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-seat-monitor-'));
    this.requestId = 0;
    this.pending = new Map();
    this.networkRequests = new Map();
    this.currentNetworkLabel = 'chrome';
    this.websocket = null;
    this.process = null;
  }

  async start() {
    const args = [
      CONFIG.headless ? '--headless=new' : '',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-sync',
      '--disable-component-update',
      '--disable-default-apps',
      '--metrics-recording-only',
      '--mute-audio',
      CONFIG.chromeNoSandbox ? '--no-sandbox' : '',
      '--disable-blink-features=AutomationControlled',
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--window-size=1400,1000',
      'about:blank',
    ].filter(Boolean);

    this.process = spawn(CONFIG.chromePath, args, { stdio: 'ignore' });
    await this.waitForChrome();
    const tab = await this.createTab();
    this.websocket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.websocket.onopen = resolve;
      this.websocket.onerror = reject;
      this.websocket.onmessage = (event) => this.onMessage(event.data);
    });

    await this.send('Network.enable');
    await this.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (CONFIG.blockAssets) {
      await this.send('Network.setBlockedURLs', {
        urls: [
          '*.png',
          '*.jpg',
          '*.jpeg',
          '*.gif',
          '*.webp',
          '*.svg',
          '*.ico',
          '*.woff',
          '*.woff2',
          '*.ttf',
          '*.otf',
          '*googletagmanager.com*',
          '*google-analytics.com*',
          '*doubleclick.net*',
          '*facebook.net*',
          '*snapchat.com*',
          '*tiktok.com*',
          '*qualtrics.com*',
          '*newrelic.com*',
          '*nr-data.net*',
          '*go-mpulse.net*',
          '*appboycdn.com*',
        ],
      });
    }
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      platform: 'Windows',
    });
  }

  async stop() {
    try {
      if (this.websocket) this.websocket.close();
    } catch {}
    try {
      if (this.process) this.process.kill();
    } catch {}
    await sleep(1000);
    try {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {}
  }

  onMessage(data) {
    const message = JSON.parse(data);
    if (message.method) this.onEvent(message);
    if (!message.id || !this.pending.has(message.id)) return;
    const { resolve, reject } = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }

  onEvent(message) {
    const params = message.params || {};
    if (message.method === 'Network.requestWillBeSent') {
      this.networkRequests.set(params.requestId, {
        label: this.currentNetworkLabel || 'chrome',
        url: params.request && params.request.url || '',
      });
      return;
    }

    if (message.method === 'Network.loadingFinished') {
      const request = this.networkRequests.get(params.requestId) || {};
      recordNetworkBytes('headless-chrome', request.label || this.currentNetworkLabel || 'chrome', params.encodedDataLength || 0, request.url || '');
      this.networkRequests.delete(params.requestId);
      return;
    }

    if (message.method === 'Network.loadingFailed') {
      this.networkRequests.delete(params.requestId);
    }
  }

  send(method, params = {}) {
    const id = ++this.requestId;
    this.websocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${CONFIG.cdpTimeoutMs}ms`));
      }, CONFIG.cdpTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  async navigate(url, waitMs) {
    this.currentNetworkLabel = url;
    await this.send('Page.navigate', { url });
    await sleep(waitMs);
  }

  async navigateAndWait(url, waitMs, expression, label) {
    this.currentNetworkLabel = label || url;
    await this.send('Page.navigate', { url });
    if (!expression) {
      await sleep(waitMs);
      return false;
    }
    return this.waitFor(expression, waitMs, label || url);
  }

  async waitFor(expression, timeoutMs, label) {
    const started = Date.now();
    let lastError = null;

    while (Date.now() - started < timeoutMs) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) {
          debug(`Ready: ${label || expression} in ${Date.now() - started}ms`);
          return true;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(CONFIG.domWaitIntervalMs);
    }

    debug(`Timed out waiting for ${label || expression}${lastError ? `: ${lastError.message}` : ''}`);
    return false;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(description);
    }
    return result.result.value;
  }

  async evaluateAsync(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(description);
    }
    return result.result.value;
  }

  async waitForChrome() {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        return await this.getJson('/json/version');
      } catch {
        await sleep(250);
      }
    }
    throw new Error('Chrome did not start in time.');
  }

  async createTab() {
    return new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: this.port, path: '/json/new?about:blank', method: 'PUT' }, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end();
    });
  }

  async getJson(requestPath) {
    return new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: this.port, path: requestPath }, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.setTimeout(2000, () => request.destroy(new Error('timeout')));
    });
  }
}

async function discoverShowtimes(dateYmd) {
  const url = showtimesUrl(dateYmd);
  const response = await fetchText(url);
  return parseShowtimesHtml(response.text, dateYmd, response.url || url);
}

async function discoverShowtimesWithBrowser(browser, dateYmds) {
  const requests = dateYmds.map((dateYmd) => ({ dateYmd, url: showtimesUrl(dateYmd) }));
  if (!requests.length) return [];

  await browser.navigateAndWait(
    CONFIG.baseUrl,
    CONFIG.pageWaitMs,
    'document.body',
    'showtime browser origin',
  );

  const script = `(() => {
    const requests = ${JSON.stringify(requests)};
    const timeoutMs = ${JSON.stringify(CONFIG.showtimeBrowserFetchTimeoutMs)};
    const limit = ${JSON.stringify(Math.max(1, CONFIG.parallelDateScans))};

    async function fetchOne(item) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(item.url, {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'include',
          redirect: 'follow',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
          }
        });
        const text = await response.text();
        return {
          dateYmd: item.dateYmd,
          url: response.url || item.url,
          ok: response.ok,
          status: response.status,
          text
        };
      } catch (error) {
        return {
          dateYmd: item.dateYmd,
          url: item.url,
          ok: false,
          status: 0,
          error: error && error.name === 'AbortError' ? 'Browser fetch timed out after ' + timeoutMs + 'ms' : String(error && error.message || error)
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    return new Promise((resolve) => {
      const results = new Array(requests.length);
      let index = 0;
      let active = 0;

      function pump() {
        while (active < limit && index < requests.length) {
          const current = index++;
          active++;
          fetchOne(requests[current])
            .then((result) => {
              results[current] = result;
            })
            .catch((error) => {
              results[current] = {
                dateYmd: requests[current].dateYmd,
                url: requests[current].url,
                ok: false,
                status: 0,
                error: String(error && error.message || error)
              };
            })
            .finally(() => {
              active--;
              if (index >= requests.length && active === 0) resolve(results);
              else pump();
            });
        }
      }

      pump();
    });
  })()`;

  const results = await browser.evaluateAsync(script);
  return results.map((result, index) => {
    const dateYmd = result?.dateYmd || requests[index]?.dateYmd || '';
    if (!result || result.error) return { dateYmd, error: result?.error || 'Browser showtime fetch failed.' };
    if (!result.ok) return { dateYmd, error: `Browser showtime fetch HTTP ${result.status}: ${normalize(stripHtml(result.text)).slice(0, 180)}` };
    const page = parseShowtimesHtml(result.text, dateYmd, result.url);
    return { dateYmd, page };
  });
}

async function inspectSeats(browser, showtime) {
  if (!showtime.bookingId) {
    return { ...showtime, seatCount: 0, available: 0, unavailable: 0, availableSeats: [], seatTypeCounts: {}, soldOut: true };
  }

  const bookingPath = `/booking/${showtime.bookingId}`;
  const bookingId = JSON.stringify(showtime.bookingId);
  await browser.navigateAndWait(
    `${CONFIG.baseUrl}${bookingPath}`,
    CONFIG.bookingWaitMs,
    `location.href.includes(${bookingId}) && document.body && (document.querySelector('input[name="seat"]') || /Continue As Guest|showtime has now sold out|sold out|unavailable|MISSING_ORDER/i.test(document.body.innerText || ''))`,
    `booking page ${showtime.bookingId}`,
  );
  const guest = await browser.evaluate(`(() => {
    const clean = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({ text: clean(anchor.innerText || anchor.textContent), href: anchor.href }))
      .find((anchor) => /Continue As Guest/i.test(anchor.text)) || null;
  })()`);

  if (guest && guest.href) {
    await browser.navigateAndWait(
      guest.href,
      CONFIG.bookingWaitMs,
      `location.href.includes(${bookingId}) && document.body && (document.querySelector('input[name="seat"]') || /showtime has now sold out|sold out|unavailable|MISSING_ORDER/i.test(document.body.innerText || ''))`,
      `seat map ${showtime.bookingId}`,
    );
  }

  const seatMap = await browser.evaluate(`(() => {
    const clean = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
    const rawText = document.body && document.body.innerText || '';
    const lines = rawText.split(/\\n+/).map(clean).filter(Boolean);
    const when = (lines.find((line) => line.startsWith('When: ')) || '').replace('When: ', '');
    const experience = (lines.find((line) => line.startsWith('Experience: ')) || '').replace('Experience: ', '');
    const screen = (lines.find((line) => line.startsWith('Screen: ')) || '').replace('Screen: ', '');
    const soldOut = /showtime has now sold out|sold out|unavailable|MISSING_ORDER/i.test(rawText);

    const seats = [...document.querySelectorAll('input[name="seat"]')].map((input) => {
      const label = input.id ? document.querySelector('label[for="' + CSS.escape(input.id) + '"]') : null;
      const container = input.closest('[class]') || input.parentElement;
      const parent = input.closest('label, li, div, span') || input.parentElement;
      const seat = clean((label && label.innerText) || (parent && parent.innerText) || input.getAttribute('aria-label') || input.value);
      let classChain = '';
      for (let node = input, i = 0; node && i < 5; node = node.parentElement, i++) {
        classChain += ' ' + String(node.className || '');
      }
      const classLower = classChain.toLowerCase();
      const type =
        classLower.includes('premium') ? 'Premium' :
        classLower.includes('standard') || classLower.includes('regular') || classLower.includes('normal') ? 'Standard' :
        'Unknown';
      const match = seat.match(/^([A-Z]+)-(\\d+)$/);
      return {
        seat,
        row: match ? match[1] : '?',
        number: match ? Number(match[2]) : null,
        type,
        available: !input.disabled,
      };
    });

    const availableSeats = seats
      .filter((seat) => seat.available)
      .sort((a, b) => a.row.localeCompare(b.row) || b.number - a.number)
      .map((seat) => ({ seat: seat.seat, row: seat.row, number: seat.number, type: seat.type }));

    const rows = {};
    const seatTypeCounts = {};
    for (const seat of seats) {
      if (!rows[seat.row]) rows[seat.row] = { total: 0, available: [] };
      rows[seat.row].total++;
      seatTypeCounts[seat.type] = (seatTypeCounts[seat.type] || 0) + 1;
      if (seat.available) rows[seat.row].available.push({ seat: seat.seat, row: seat.row, number: seat.number, type: seat.type });
    }

    for (const row of Object.values(rows)) {
      row.available.sort((a, b) => Number(b.seat.split('-')[1]) - Number(a.seat.split('-')[1]));
    }

    return {
      url: location.href,
      when,
      experience,
      screen,
      soldOut,
      seatCount: seats.length,
      available: availableSeats.length,
      unavailable: seats.length - availableSeats.length,
      availableSeats,
      availableRows: Object.fromEntries(Object.entries(rows).filter(([, row]) => row.available.length)),
      seatTypeCounts,
      pageText: clean(rawText).slice(0, 500),
    };
  })()`);

  if (seatMap.seatCount === 0 && !seatMap.soldOut && showtime.listingStatus === 'bookable') {
    throw new Error(`Seat map did not load for ${showtime.bookingId}; keeping the previous snapshot.`);
  }

  return { ...showtime, ...seatMap };
}

async function runCycle() {
  const cycleStartedMs = Date.now();
  const startedAt = new Date().toISOString();
  resetNetworkMeasure(`cycle ${startedAt}`);
  const state = loadState();
  let browser = null;
  const targetDates = buildTargetDates();

  const discovered = [];
  const checked = [];
  const alerts = [];
  const dateFailures = [];
  const seatCheckReasons = new Map();
  const markSeatCheck = (showtime, reason) => {
    if (!showtime.bookingId) return;
    const entry = seatCheckReasons.get(showtime.key) || { showtime, reasons: new Set() };
    entry.showtime = showtime;
    entry.reasons.add(reason);
    seatCheckReasons.set(showtime.key, entry);
  };

  try {
    const scanDatePage = async (dateYmd) => {
      try {
        log(`Scanning showtimes for ${displayDate(dateYmd)}...`);
        const page = await discoverShowtimes(dateYmd);
        debug('discovered', dateYmd, page.showtimes);
        log(`Found ${page.showtimes.length} ${CONFIG.experience} showtime(s) for ${displayDate(dateYmd)}.`);
        return page;
      } catch (error) {
        dateFailures.push({ dateYmd, message: error.message });
        log(`Showtime scan failed for ${displayDate(dateYmd)}: ${error.message}`);
        return null;
      }
    };

    let abortedDateScan = false;
    let datePages = [];
    if (normalizeShowtimeFetchMode(CONFIG.showtimeFetchMode) === 'browser') {
      browser = new ChromeSession();
      await browser.start();

      const scanBrowserDatePages = async (dates) => {
        if (!dates.length) return [];
        log(`Browser-backed showtime scan for ${dates.length} date(s)...`);
        try {
          const results = await discoverShowtimesWithBrowser(browser, dates);
          const pages = [];
          for (const result of results) {
            if (result.error) {
              dateFailures.push({ dateYmd: result.dateYmd, message: result.error });
              log(`Browser-backed showtime scan failed for ${displayDate(result.dateYmd)}: ${result.error}`);
              continue;
            }
            pages.push(result.page);
            debug('browser-discovered', result.dateYmd, result.page.showtimes);
            log(`Found ${result.page.showtimes.length} ${CONFIG.experience} showtime(s) for ${displayDate(result.dateYmd)}.`);
          }
          return pages;
        } catch (error) {
          for (const dateYmd of dates) dateFailures.push({ dateYmd, message: error.message });
          log(`Browser-backed showtime scan failed for ${dates.length} date(s): ${error.message}`);
          return [];
        }
      };

      if (CONFIG.abortDateScanOnFirstFailure && targetDates.length) {
        const [firstDate, ...remainingDates] = targetDates;
        const firstPages = await scanBrowserDatePages([firstDate]);
        if (!firstPages.length) {
          abortedDateScan = true;
          log(`Aborting remaining ${remainingDates.length} date scan(s) after first-date browser failure.`);
        } else {
          datePages.push(...firstPages);
          datePages.push(...await scanBrowserDatePages(remainingDates));
        }
      } else {
        datePages = await scanBrowserDatePages(targetDates);
      }
    } else if (CONFIG.abortDateScanOnFirstFailure && targetDates.length) {
      const [firstDate, ...remainingDates] = targetDates;
      const firstPage = await scanDatePage(firstDate);
      if (!firstPage) {
        abortedDateScan = true;
        log(`Aborting remaining ${remainingDates.length} date scan(s) after first-date failure.`);
      } else {
        datePages.push(firstPage);
        datePages.push(...await mapWithConcurrency(remainingDates, CONFIG.parallelDateScans, scanDatePage));
      }
    } else {
      datePages = await mapWithConcurrency(targetDates, CONFIG.parallelDateScans, scanDatePage);
    }

    appendDateFailureAlerts(alerts, dateFailures, targetDates.length, state, { abortedDateScan });

    for (const page of datePages.filter(Boolean)) {
      discovered.push(...page.showtimes);
    }

    const uniqueShowtimes = dedupeShowtimes(discovered);
    const showtimesByDate = uniqueShowtimes.reduce((dates, showtime) => {
      if (!dates[showtime.date]) dates[showtime.date] = [];
      dates[showtime.date].push(showtime);
      return dates;
    }, {});
    const newDates = new Set();
    const newDateMessages = [];

    for (const [date, dayShowtimes] of Object.entries(showtimesByDate).sort()) {
      const previousReleasedDate = state.releasedDates[date];
      if (!state.releasedDates[date]) {
        newDates.add(date);
        const message = formatNewDateMessage(date, dayShowtimes);
        newDateMessages.push({ date, message });
        if (!canSendTelegram()) alerts.push(message.replace(/\n/g, ' | '));
        for (const showtime of dayShowtimes) markSeatCheck(showtime, 'new date');
      }
      state.releasedDates[date] = {
        date,
        firstSeenAt: state.releasedDates[date]?.firstSeenAt || startedAt,
        lastSeenAt: CONFIG.persistSeenTimestamps ? startedAt : (previousReleasedDate?.lastSeenAt || previousReleasedDate?.firstSeenAt || startedAt),
        showtimeCount: dayShowtimes.length,
      };
    }

    for (const showtime of uniqueShowtimes) {
      const previous = state.showtimes[showtime.key];
      if (!previous) {
        if (!newDates.has(showtime.date)) {
          alerts.push(`NEW ${showtime.experience} showtime: ${displayDate(showtime.date)} ${showtime.time}${showtime.bookingId ? ` | Booking: ${bookingUrl(showtime)}` : ' (listed, no booking link yet)'}`);
          markSeatCheck(showtime, 'new showtime');
        }
      } else if (!previous.bookingId && showtime.bookingId) {
        alerts.push(`BOOKING LINK LIVE: ${showtime.experience} ${displayDate(showtime.date)} ${showtime.time} | Booking: ${bookingUrl(showtime)}`);
        markSeatCheck(showtime, 'booking link live');
      } else if (previous.listingStatus && previous.listingStatus !== 'bookable' && showtime.listingStatus === 'bookable') {
        alerts.push(`SHOWTIME BOOKABLE: ${showtime.experience} ${displayDate(showtime.date)} ${showtime.time} | Booking: ${bookingUrl(showtime)}`);
        markSeatCheck(showtime, 'showtime bookable');
      }
      state.showtimes[showtime.key] = {
        ...previous,
        ...showtime,
        firstSeenAt: previous?.firstSeenAt || startedAt,
        lastSeenAt: CONFIG.persistSeenTimestamps ? startedAt : (previous?.lastSeenAt || startedAt),
      };
    }

    if (newDateMessages.length && canSendTelegram()) {
      for (const { date, message } of newDateMessages) {
        await sendTelegram(message);
        state.hasSentBaseline = true;
        log(`Sent new-date alert for ${displayDate(date)} to Telegram.`);
      }
      saveState(state);
    }

    if (alerts.length && canSendTelegram()) {
      const immediateAlerts = alerts.splice(0, alerts.length);
      const immediateSummary = formatSummary(startedAt, targetDates, [], uniqueShowtimes, immediateAlerts);
      await sendTelegram(immediateSummary);
      state.hasSentBaseline = true;
      saveState(state);
      log(`Sent ${immediateAlerts.length} immediate showtime alert(s) to Telegram.`);
    }

    if (!NO_SEATS) {
      const autoSeatCheckMode = normalizeAutoSeatCheckMode(CONFIG.autoSeatCheckMode);
      const periodicFullSeatCheck = shouldRunPeriodicFullSeatCheck(state, startedAt);
      const seatShowtimeEntries = buildSeatCheckEntries(uniqueShowtimes, seatCheckReasons, autoSeatCheckMode, periodicFullSeatCheck);
      const seatShowtimes = seatShowtimeEntries
        .map((entry) => entry.showtime)
        .filter((item) => item.bookingId && (!CONFIG.skipUnavailableListings || item.listingStatus === 'bookable'));
      const skippedSeatMaps = seatShowtimeEntries.filter((entry) => entry.showtime.bookingId && CONFIG.skipUnavailableListings && entry.showtime.listingStatus !== 'bookable').length;
      if (skippedSeatMaps) log(`Skipping ${skippedSeatMaps} currently unavailable seat map(s).`);
      if (autoSeatCheckMode !== 'all' || periodicFullSeatCheck) {
        const reasonSummary = summarizeSeatCheckReasons(seatShowtimeEntries);
        log(`Auto seat-check mode: ${autoSeatCheckMode}${periodicFullSeatCheck ? ' + periodic full check' : ''}; checking ${seatShowtimes.length} seat map(s)${reasonSummary ? ` (${reasonSummary})` : ''}.`);
      }
      if (seatShowtimes.length) {
        browser = new ChromeSession();
        await browser.start();
      }

      for (const showtime of seatShowtimes) {
        try {
          log(`Reading seats for ${displayDate(showtime.date)} ${showtime.time} (${showtime.bookingId})...`);
          const seatInfo = enrichSeatInfo(await inspectSeats(browser, showtime));
          checked.push(seatInfo);
          if (seatInfo.seatCount === 0 && seatInfo.soldOut) {
            log(`Seat result for ${displayDate(showtime.date)} ${showtime.time}: unavailable/sold out, 0 in interested range.`);
          } else {
            log(`Seat result for ${displayDate(showtime.date)} ${showtime.time}: ${seatInfo.available}/${seatInfo.seatCount} available, ${seatInfo.interestedAvailable} in interested range.`);
          }

          const snapshotKey = showtime.key;
          const previousSnapshot = state.seatSnapshots[snapshotKey];
          const signature = JSON.stringify({
            interestedAvailableSeats: seatInfo.interestedAvailableSeats,
          });

          let interestedAlertType = '';
          if (seatInfo.interestedAvailable > 0 && previousSnapshot && CONFIG.notifySeatChanges && previousSnapshot.signature !== signature) {
            interestedAlertType = 'INTERESTED SEATS CHANGED';
          } else if (seatInfo.interestedAvailable > 0 && !previousSnapshot) {
            interestedAlertType = 'INTERESTED SEATS AVAILABLE';
          }

          if (interestedAlertType) {
            const interestedMessage = formatInterestedSeatMessage(seatInfo, interestedAlertType);
            if (canSendTelegram()) {
              await sendTelegram(interestedMessage);
              state.hasSentBaseline = true;
              log(`Sent interested-seat alert for ${displayDate(seatInfo.date)} ${seatInfo.time}: ${formatSeatList(seatInfo.interestedAvailableSeats, 28)}.`);
            } else {
              alerts.push(interestedMessage.replace(/\n/g, ' | '));
            }
          }

          state.seatSnapshots[snapshotKey] = { signature, updatedAt: startedAt, seatInfo };
          saveState(state);

          const prioritySignature = JSON.stringify(seatInfo.priorityAvailableSeats);
          const previousPrioritySnapshot = state.prioritySnapshots[snapshotKey];
          if (seatInfo.priorityAvailable > 0 && (!previousPrioritySnapshot || previousPrioritySnapshot.signature !== prioritySignature)) {
            const priorityMessage = formatPrioritySeatMessage(seatInfo);
            if (canSendTelegram()) {
              await sendTelegram(priorityMessage);
              state.hasSentBaseline = true;
              log(`Sent priority-seat alert for ${displayDate(seatInfo.date)} ${seatInfo.time}: ${formatSeatList(seatInfo.priorityAvailableSeats, 20)}.`);
            } else {
              alerts.push(priorityMessage.replace(/\n/g, ' | '));
            }
          }
          state.prioritySnapshots[snapshotKey] = {
            signature: prioritySignature,
            updatedAt: startedAt,
            priorityAvailableSeats: seatInfo.priorityAvailableSeats,
          };
        } catch (error) {
          alerts.push(`Could not read seats for ${displayDate(showtime.date)} ${showtime.time}: ${error.message}`);
        }
      }
      if (periodicFullSeatCheck && seatShowtimes.length) state.lastFullSeatCheckAt = startedAt;
    }
  } finally {
    if (browser) await browser.stop();
  }

  if (CONFIG.persistLastRun) state.lastRunAt = startedAt;
  saveState(state);

  const summary = formatSummary(startedAt, targetDates, checked, discovered, alerts);
  log(summary.replace(/\n/g, '\n  '));
  log(`Cycle completed in ${((Date.now() - cycleStartedMs) / 1000).toFixed(1)}s.`);
  if (NETWORK_MEASURE.enabled) {
    log(formatNetworkMeasureSummary().replace(/\n/g, '\n  '));
    saveNetworkMeasure({
      type: 'cycle',
      dateCount: targetDates.length,
      listedShowtimeCount: discovered.length,
      seatCheckCount: checked.length,
      elapsedSeconds: Number(((Date.now() - cycleStartedMs) / 1000).toFixed(1)),
    });
    log(`Saved network measurement to ${CONFIG.networkMeasurementFile}`);
  }

  if (canSendTelegram()) {
    const shouldSend = CONFIG.sendEveryCheck || alerts.length > 0 || !state.hasSentBaseline;
    if (shouldSend) {
      await sendTelegram(summary);
      log('Sent summary to Telegram.');
    } else {
      log('No Telegram summary sent; no new alerts or interested-seat changes.');
    }
    state.hasSentBaseline = true;
    saveState(state);
  }

  return { checked, discovered, alerts, summary };
}

function normalizeAutoSeatCheckMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['all', 'release', 'none'].includes(normalized) ? normalized : 'release';
}

function normalizeShowtimeFetchMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['http', 'browser'].includes(normalized) ? normalized : 'http';
}

function getCheckDateInput() {
  return getArgValue('--check-date') || env('VOX_CHECK_DATE', '');
}

function getArgValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex !== -1 && process.argv[exactIndex + 1]) return process.argv[exactIndex + 1];

  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

function shouldRunPeriodicFullSeatCheck(state, startedAt) {
  if (CONFIG.fullSeatCheckEveryMinutes <= 0) return false;
  if (normalizeAutoSeatCheckMode(CONFIG.autoSeatCheckMode) === 'none') return false;
  if (!state.lastFullSeatCheckAt) return true;
  const last = Date.parse(state.lastFullSeatCheckAt);
  const now = Date.parse(startedAt);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last >= CONFIG.fullSeatCheckEveryMinutes * 60 * 1000;
}

function buildSeatCheckEntries(uniqueShowtimes, seatCheckReasons, mode, periodicFullSeatCheck) {
  if (mode === 'none') return [];

  if (mode === 'all' || periodicFullSeatCheck) {
    return uniqueShowtimes
      .filter((showtime) => showtime.bookingId)
      .map((showtime) => ({
        showtime,
        reasons: new Set([mode === 'all' ? 'all' : 'periodic']),
      }));
  }

  return [...seatCheckReasons.values()];
}

function summarizeSeatCheckReasons(entries) {
  const counts = {};
  for (const entry of entries) {
    for (const reason of entry.reasons || []) counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
}

function appendDateFailureAlerts(alerts, dateFailures, targetDateCount, state, options = {}) {
  if (!dateFailures.length) {
    if (state.lastDateScanFailureSignature) state.lastDateScanFailureSignature = null;
    return;
  }

  const first = dateFailures[0];
  const allFailed = dateFailures.length === targetDateCount;
  const abortedDateScan = !!options.abortedDateScan;
  const normalizedFirstMessage = normalizeFailureMessage(first.message);
  const signature = abortedDateScan
    ? `aborted|${targetDateCount}|${normalizedFirstMessage}`
    : allFailed
      ? `all|${targetDateCount}|${normalizedFirstMessage}`
      : `partial|${dateFailures.length}|${normalizedFirstMessage}`;

  if (state.lastDateScanFailureSignature === signature) {
    log(`Suppressing repeated showtime scan warning: ${signature}`);
    return;
  }

  state.lastDateScanFailureSignature = signature;

  if (abortedDateScan) {
    alerts.push(`SHOWTIME SCAN WARNING: GitHub could not read VOX's first date page (${displayDate(first.dateYmd)}): ${first.message}. Skipped the remaining ${Math.max(0, targetDateCount - 1)} date(s) to keep this run fast; GitHub will retry on the next scheduled run.`);
    return;
  }

  if (allFailed) {
    alerts.push(`SHOWTIME SCAN WARNING: Could not read any of ${targetDateCount} date page(s) from VOX. First failure: ${displayDate(first.dateYmd)} - ${first.message}. GitHub will retry on the next scheduled run.`);
    return;
  }

  const sample = dateFailures
    .slice(0, 4)
    .map((failure) => `${displayDate(failure.dateYmd)} (${failure.message})`)
    .join('; ');
  const more = dateFailures.length > 4 ? `; +${dateFailures.length - 4} more` : '';
  alerts.push(`SHOWTIME SCAN WARNING: ${dateFailures.length}/${targetDateCount} date page(s) failed: ${sample}${more}.`);
}

function normalizeFailureMessage(message) {
  return String(message || '')
    .replace(/\bafter \d+ms\b/g, 'after TIMEOUT')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function startTelegramCommandLoop() {
  if (!CONFIG.telegramCommands || !canSendTelegram() || ONCE) return;

  try {
    await initializeTelegramCommandOffset();
    log('Telegram commands enabled. Use /check 13/8 or /check 2026-08-13.');
  } catch (error) {
    log(`Telegram command setup failed: ${error.message}`);
  }

  while (true) {
    try {
      await pollTelegramCommandsOnce();
    } catch (error) {
      log(`Telegram command poll failed: ${error.message}`);
      await sleep(5000);
    }
  }
}

async function initializeTelegramCommandOffset() {
  if (loadTelegramOffset() !== null) return;
  const updates = await getTelegramUpdates(null, 0);
  const lastUpdateId = updates.reduce((max, update) => Math.max(max, Number(update.update_id) || 0), 0);
  saveTelegramOffset(lastUpdateId ? lastUpdateId + 1 : 0);
  if (updates.length) log(`Initialized Telegram command offset; ignored ${updates.length} old update(s).`);
}

async function pollTelegramCommandsOnce() {
  const offset = loadTelegramOffset() ?? 0;
  const updates = await getTelegramUpdates(offset, CONFIG.telegramCommandTimeoutSeconds);

  for (const update of updates) {
    const nextOffset = (Number(update.update_id) || 0) + 1;
    try {
      await handleTelegramUpdate(update);
    } catch (error) {
      log(`Telegram command failed: ${error.stack || error.message || error}`);
      try {
        await sendTelegram(`Command failed: ${error.message || error}`);
      } catch (sendError) {
        log(`Could not send command failure to Telegram: ${sendError.message}`);
      }
    } finally {
      saveTelegramOffset(nextOffset);
    }
  }
}

async function getTelegramUpdates(offset, timeoutSeconds) {
  const params = new URLSearchParams({ timeout: String(timeoutSeconds) });
  if (offset !== null && offset !== undefined) params.set('offset', String(offset));
  const endpoint = `https://api.telegram.org/bot${CONFIG.telegramToken}/getUpdates?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (timeoutSeconds + 10) * 1000);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram getUpdates failed: HTTP ${response.status}`);
    return Array.isArray(data.result) ? data.result : [];
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Telegram getUpdates timed out after ${timeoutSeconds + 10}s`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleTelegramUpdate(update) {
  const message = update.message || update.edited_message;
  if (!message || !message.text) return;

  const chatId = message.chat && message.chat.id;
  if (String(chatId) !== String(CONFIG.telegramChatId)) {
    log('Ignored Telegram command from an unconfigured chat.');
    return;
  }

  const parsed = parseTelegramCommand(message.text);
  if (!parsed) return;

  if (['/help', '/start'].includes(parsed.command)) {
    await sendTelegram(telegramCommandHelp());
    return;
  }

  if (parsed.command === '/status') {
    await sendTelegram(formatCommandStatus());
    return;
  }

  if (['/check', '/date', '/seats'].includes(parsed.command)) {
    const dateYmd = parseCommandDate(parsed.args);
    if (!dateYmd) {
      await sendTelegram(`I need a date.\n\n${telegramCommandHelp()}`);
      return;
    }
    await runRequestedDateCheck(dateYmd);
    return;
  }

  if (parsed.command === '/today' || parsed.command === '/tomorrow') {
    const offsetDays = parsed.command === '/today' ? 0 : 1;
    await runRequestedDateCheck(formatDateYmd(addDays(scanStartDate(), offsetDays)));
    return;
  }

  await sendTelegram(`Unknown command: ${parsed.command}\n\n${telegramCommandHelp()}`);
}

function parseTelegramCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  return { command, args: rest.join(' ').trim() };
}

function parseCommandDate(input) {
  const text = normalize(input).toLowerCase();
  if (!text) return null;
  if (text === 'today') return formatDateYmd(scanStartDate());
  if (text === 'tomorrow') return formatDateYmd(addDays(scanStartDate(), 1));

  let match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return datePartsToYmd(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return datePartsToYmd(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
  if (match) {
    const now = scanStartDate();
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return datePartsToYmd(year, Number(match[2]), Number(match[1]));
  }

  return null;
}

function datePartsToYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return formatDateYmd(date);
}

async function runRequestedDateCheck(dateYmd) {
  const startedMs = Date.now();
  const checked = [];
  const failures = [];
  let browser = null;

  await sendTelegramOrLog(`Checking ${displayDate(dateYmd)} now for ${CONFIG.movie} ${CONFIG.experience}.\nI will send matching interested seats immediately as each seat map is read.`);
  log(`Telegram command requested date check for ${displayDate(dateYmd)}.`);

  try {
    const page = await discoverShowtimes(dateYmd);
    const showtimes = dedupeShowtimes(page.showtimes);

    if (!showtimes.length) {
      await sendTelegramOrLog(formatRequestedDateNoShowtimesMessage(dateYmd));
      return;
    }

    await sendTelegramOrLog(formatRequestedDateShowtimesMessage(dateYmd, showtimes));

    const seatShowtimes = NO_SEATS ? [] : showtimes.filter((showtime) => showtime.bookingId && (!CONFIG.skipUnavailableListings || showtime.listingStatus === 'bookable'));
    if (NO_SEATS) log('Skipping requested-date seat maps because --no-seats is set.');
    if (seatShowtimes.length) {
      browser = new ChromeSession();
      await browser.start();
    }

    for (const showtime of seatShowtimes) {
      try {
        log(`Command reading seats for ${displayDate(showtime.date)} ${showtime.time} (${showtime.bookingId})...`);
        const seatInfo = enrichSeatInfo(await inspectSeats(browser, showtime));
        checked.push(seatInfo);

        if (seatInfo.interestedAvailable > 0) {
          await sendTelegramOrLog(formatInterestedSeatMessage(seatInfo, 'REQUESTED DATE SEATS AVAILABLE'));
          log(`Sent requested-date interested seats for ${displayDate(seatInfo.date)} ${seatInfo.time}: ${formatSeatList(seatInfo.interestedAvailableSeats, 28)}.`);
        }
      } catch (error) {
        failures.push({ showtime, error });
        log(`Command seat read failed for ${displayDate(showtime.date)} ${showtime.time}: ${error.message}`);
      }
    }

    await sendTelegramOrLog(formatRequestedDateResultMessage(dateYmd, showtimes, checked, failures, startedMs));
  } finally {
    if (browser) await browser.stop();
  }
}

function dedupeShowtimes(showtimes) {
  const byKey = new Map();
  for (const showtime of showtimes) {
    const existing = byKey.get(showtime.key);
    if (!existing || (!existing.bookingId && showtime.bookingId)) byKey.set(showtime.key, showtime);
  }
  return [...byKey.values()].sort(compareShowtimes);
}

function compareShowtimes(a, b) {
  return a.date.localeCompare(b.date) || timeToMinutes(a.time) - timeToMinutes(b.time) || a.time.localeCompare(b.time);
}

function timeToMinutes(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toLowerCase();
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  return hour * 60 + minute;
}

function displayDate(dateYmd) {
  return `${dateYmd.slice(0, 4)}-${dateYmd.slice(4, 6)}-${dateYmd.slice(6, 8)}`;
}

function normalizeSeat(seat) {
  const label = typeof seat === 'string' ? seat : seat.seat;
  const source = typeof seat === 'string' ? {} : seat;
  const match = String(label || '').match(/^([A-Z]+)-(\d+)$/i);
  return {
    seat: label,
    row: (source.row || (match && match[1]) || '').toUpperCase(),
    number: Number.isFinite(source.number) ? source.number : (match ? Number(match[2]) : NaN),
    type: source.type || 'Unknown',
  };
}

function isSeatInInterestedRange(seat) {
  const normalized = normalizeSeat(seat);
  const lower = Math.min(CONFIG.interestedMinSeat, CONFIG.interestedMaxSeat);
  const upper = Math.max(CONFIG.interestedMinSeat, CONFIG.interestedMaxSeat);
  return CONFIG.interestedRows.includes(normalized.row) && normalized.number >= lower && normalized.number <= upper;
}

function isPrioritySeat(seat) {
  const normalized = normalizeSeat(seat);
  return CONFIG.prioritySeatKeys.has(`${normalized.row}-${normalized.number}`);
}

function enrichSeatInfo(seatInfo) {
  const availableSeats = (seatInfo.availableSeats || []).map(normalizeSeat);
  const interestedAvailableSeats = availableSeats.filter(isSeatInInterestedRange);
  const priorityAvailableSeats = availableSeats.filter(isPrioritySeat);

  return {
    ...seatInfo,
    availableSeats,
    interestedAvailable: interestedAvailableSeats.length,
    interestedAvailableSeats,
    priorityAvailable: priorityAvailableSeats.length,
    priorityAvailableSeats,
  };
}

function formatInterestedRange() {
  return `rows ${CONFIG.interestedRows.join('/')} seats ${CONFIG.interestedMaxSeat}..${CONFIG.interestedMinSeat}`;
}

function formatSeatList(availableSeats, max = 28) {
  if (!availableSeats || availableSeats.length === 0) return 'none';
  const seats = availableSeats.map((seat) => `${seat.seat}${seat.type && seat.type !== 'Unknown' ? ` ${seat.type[0]}` : ''}`);
  const visible = seats.slice(0, max).join(', ');
  const hidden = seats.length > max ? `, +${seats.length - max} more` : '';
  return `${visible}${hidden}`;
}

function bookingUrl(showtime) {
  return `${CONFIG.baseUrl}/booking/${showtime.bookingId}`;
}

function telegramCommandHelp() {
  return [
    'VOX monitor commands',
    '/check 13/8 - check one date now',
    '/check 2026-08-13 - same with full date',
    '/date 13/8 - alias for /check',
    '/seats 13/8 - alias for /check',
    '/today - check today',
    '/tomorrow - check tomorrow',
    '/status - monitor status',
  ].join('\n');
}

function formatCommandStatus() {
  const state = loadState();
  const dates = buildTargetDates();
  return [
    `VOX ${CONFIG.movie} ${CONFIG.experience} status`,
    `Last normal run: ${state.lastRunAt || 'not recorded yet'}`,
    `Date window: ${displayDate(dates[0])} to ${displayDate(dates[dates.length - 1])}`,
    `Interested: ${formatInterestedRange()}`,
    `Poll: every ${CONFIG.pollMinutes} minute(s)`,
    `Commands: ${CONFIG.telegramCommands ? 'enabled' : 'disabled'}`,
  ].join('\n');
}

function formatRequestedDateNoShowtimesMessage(dateYmd) {
  return [
    'REQUESTED DATE CHECK',
    `${displayDate(dateYmd)} - ${CONFIG.movie} ${CONFIG.experience}`,
    'No matching showtimes found yet.',
    `Showtimes: ${showtimesUrl(dateYmd)}`,
  ].join('\n');
}

function formatRequestedDateShowtimesMessage(dateYmd, showtimes) {
  const lines = [];
  lines.push('REQUESTED DATE SHOWTIMES');
  lines.push(`${displayDate(dateYmd)} - ${CONFIG.movie} ${CONFIG.experience}`);
  lines.push(`${showtimes.length} showtime(s) found. Checking seats now.`);
  for (const showtime of showtimes.sort(compareShowtimes)) {
    lines.push(`- ${showtime.time}: ${showtime.listingStatus}`);
    if (showtime.bookingId) lines.push(`  Booking: ${bookingUrl(showtime)}`);
    else lines.push('  Booking: no link yet');
  }
  return lines.join('\n');
}

function formatRequestedDateResultMessage(dateYmd, showtimes, checked, failures, startedMs) {
  const lines = [];
  const interestingShowtimes = checked.filter((showtime) => showtime.interestedAvailable > 0);
  const checkedByKey = new Map(checked.map((seatInfo) => [seatInfo.key, seatInfo]));

  lines.push('REQUESTED DATE CHECK DONE');
  lines.push(`${displayDate(dateYmd)} - ${CONFIG.movie} ${CONFIG.experience}`);
  lines.push(`Showtimes: ${showtimes.length}, seat checks: ${checked.length}`);

  if (interestingShowtimes.length) {
    lines.push('');
    lines.push('Interested seats found:');
    for (const seatInfo of interestingShowtimes.sort(compareShowtimes)) {
      lines.push(`- ${seatInfo.time}: ${seatInfo.interestedAvailable} interested seat(s)`);
      lines.push(`  Seats: ${formatSeatList(seatInfo.interestedAvailableSeats, 28)}`);
      lines.push(`  Booking: ${bookingUrl(seatInfo)}`);
    }
  } else {
    lines.push('');
    lines.push(`No seats found in ${formatInterestedRange()}.`);
  }

  lines.push('');
  lines.push('All showtimes:');
  for (const showtime of showtimes.sort(compareShowtimes)) {
    const seatInfo = checkedByKey.get(showtime.key);
    lines.push(`- ${showtime.time}: ${seatInfo ? formatSeatCheckStatus(seatInfo) : showtime.listingStatus}`);
    if (showtime.bookingId) lines.push(`  Booking: ${bookingUrl(showtime)}`);
  }

  if (failures.length) {
    lines.push('');
    lines.push('Could not read:');
    for (const failure of failures) lines.push(`- ${failure.showtime.time}: ${failure.error.message}`);
  }

  lines.push('');
  lines.push(`Finished in ${((Date.now() - startedMs) / 1000).toFixed(1)}s.`);
  return lines.join('\n');
}

function formatSeatCheckStatus(seatInfo) {
  if (seatInfo.seatCount === 0 && seatInfo.soldOut) return 'unavailable/sold out';
  return `${seatInfo.available}/${seatInfo.seatCount} available, ${seatInfo.interestedAvailable} interested`;
}

function formatNewDateMessage(date, dayShowtimes) {
  const lines = [];
  lines.push('NEW DATE RELEASED');
  lines.push(`${displayDate(date)} - ${CONFIG.movie} ${CONFIG.experience}`);
  lines.push(`${dayShowtimes.length} showtime(s)`);
  for (const showtime of dayShowtimes.sort(compareShowtimes)) {
    lines.push(`- ${showtime.time}: ${showtime.listingStatus}`);
    if (showtime.bookingId) lines.push(`  Booking: ${bookingUrl(showtime)}`);
    else lines.push('  Booking: no link yet');
  }
  return lines.join('\n');
}

function formatInterestedSeatMessage(seatInfo, title = 'INTERESTED SEATS AVAILABLE') {
  const lines = [];
  lines.push(title);
  lines.push(`${displayDate(seatInfo.date)} ${seatInfo.time}`);
  lines.push(`${seatInfo.experience || CONFIG.experience}${seatInfo.screen ? ` - ${seatInfo.screen}` : ''}`);
  lines.push(`Range: ${formatInterestedRange()}`);
  lines.push(`Seats: ${formatSeatList(seatInfo.interestedAvailableSeats, 28)}`);
  lines.push(`Booking: ${bookingUrl(seatInfo)}`);
  return lines.join('\n');
}

function formatPrioritySeatMessage(seatInfo) {
  const lines = [];
  lines.push('TARGET SEATS AVAILABLE');
  lines.push(`${displayDate(seatInfo.date)} ${seatInfo.time}`);
  lines.push(`${seatInfo.experience || CONFIG.experience}${seatInfo.screen ? ` - ${seatInfo.screen}` : ''}`);
  lines.push(`Seats: ${formatSeatList(seatInfo.priorityAvailableSeats, 20)}`);
  lines.push(`Booking: ${bookingUrl(seatInfo)}`);
  return lines.join('\n');
}

function formatSummary(startedAt, targetDates, checked, discovered, alerts) {
  const lines = [];
  const firstDate = targetDates[0] || '';
  const lastDate = targetDates[targetDates.length - 1] || '';
  lines.push(`VOX ${CONFIG.movie} ${CONFIG.experience} monitor`);
  lines.push(`Checked: ${startedAt}`);
  lines.push(`Date scan: ${displayDate(firstDate)} to ${displayDate(lastDate)} (${targetDates.length} day(s))`);
  lines.push(`Found: ${discovered.length} listed ${CONFIG.experience} slot(s), ${checked.length} seat check(s)`);

  if (alerts.length) {
    lines.push('');
    lines.push('Alerts:');
    for (const alert of alerts) lines.push(`- ${alert}`);
  }

  if (checked.length) {
    const interestingShowtimes = checked.filter((showtime) => (showtime.interestedAvailableSeats || []).length > 0);
    if (interestingShowtimes.length) {
      lines.push('');
      lines.push(`Seat maps (${formatInterestedRange()}):`);
      for (const showtime of interestingShowtimes) {
        lines.push(`- ${displayDate(showtime.date)} ${showtime.time}: ${showtime.interestedAvailable} interested seat(s) available`);
        lines.push(`  Seats: ${formatSeatList(showtime.interestedAvailableSeats)}`);
        lines.push(`  Booking: ${bookingUrl(showtime)}`);
      }
    }
  } else if (discovered.length) {
    lines.push('');
    lines.push('Listed showtimes:');
    for (const showtime of discovered) {
      lines.push(`- ${displayDate(showtime.date)} ${showtime.time}: ${showtime.listingStatus}`);
    }
  } else {
    lines.push('');
    lines.push('No matching showtimes found in the current window.');
  }

  return lines.join('\n');
}

async function sendTelegram(text) {
  const endpoint = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
  const chunks = splitTelegramMessage(text);

  for (const chunk of chunks) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram send failed: HTTP ${response.status} ${body}`);
    }
  }
}

async function sendTelegramOrLog(text) {
  if (canSendTelegram()) {
    await sendTelegram(text);
    return;
  }
  log(String(text || '').replace(/\n/g, '\n  '));
}

function splitTelegramMessage(text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 3800) {
    const index = remaining.lastIndexOf('\n', 3800);
    const splitAt = index > 1000 ? index : 3800;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function canSendTelegram() {
  return !CONFIG.disableTelegram && !!CONFIG.telegramToken && !!CONFIG.telegramChatId;
}

async function main() {
  log(`Using browser: ${CONFIG.chromePath}`);
  if (CONFIG.disableTelegram) {
    log('Telegram is disabled for this run.');
  } else if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    log('Telegram is not configured; alerts will print to the console only.');
  }

  if (CHECK_DATE_INPUT && !CHECK_DATE) {
    throw new Error(`Invalid check date: ${CHECK_DATE_INPUT}. Use a value like 13/8, today, tomorrow, or 2026-08-13.`);
  }

  if (CHECK_DATE) {
    await runRequestedDateCheck(CHECK_DATE);
    return;
  }

  if (ONCE) {
    await runCycle();
    return;
  }

  if (CONFIG.telegramCommands && canSendTelegram()) {
    startTelegramCommandLoop();
  } else if (!CONFIG.telegramCommands) {
    log('Telegram commands are disabled.');
  }

  while (true) {
    const loopStartedMs = Date.now();
    try {
      await runCycle();
    } catch (error) {
      const message = `VOX monitor error: ${error.stack || error.message || error}`;
      console.error(message);
      if (canSendTelegram()) {
        try {
          await sendTelegram(message);
        } catch (telegramError) {
          console.error(telegramError.stack || telegramError.message || telegramError);
        }
      }
    }
    const pollMs = CONFIG.pollMinutes * 60 * 1000;
    const sleepMs = Math.max(0, pollMs - (Date.now() - loopStartedMs));
    log(`Next check in ${(sleepMs / 60000).toFixed(1)} minute(s).`);
    await sleep(sleepMs);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
