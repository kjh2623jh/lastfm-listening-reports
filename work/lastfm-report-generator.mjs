import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHtml, renderIndexRedirect } from "./lastfm-report/generator/render.mjs";
import { fallbackCopy, generateAiCopy, mergeCopy } from "./lastfm-report/generator/copy.mjs";
import { album, array, artist, buildDays, buildDeepDive, buildHours, buildListeningProfile, buildPeriodFocus, cover, group, headline } from "./lastfm-report/generator/analytics.mjs";
import { fileURLToPath } from "node:url";

const USER = "ueii";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

await loadLocalEnv(DEFAULT_ROOT);

const ROOT = process.env.LASTFM_REPORT_ROOT || DEFAULT_ROOT;
const OUT_DIR = path.join(ROOT, "outputs", "lastfm-reports");
const CACHE_DIR = path.join(ROOT, "data", "lastfm-cache");
const HISTORY_DIR = path.join(ROOT, "data", "lastfm-history");
const WEEKLY_TAG_HISTORY_FILE = path.join(HISTORY_DIR, "weekly-tags.json");
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const OPENAI_API = "https://api.openai.com/v1/responses";
const TZ = "Asia/Seoul";

const period = (process.argv[2] || "weekly").toLowerCase();
const startArg = process.argv[3];
const lastfmApiKey = process.env.LASTFM_API_KEY || process.argv[4];
const useOpenAiApi = process.env.GITHUB_ACTIONS === "true" || process.env.OPENAI_USE_API === "true";
const openaiApiKey = useOpenAiApi ? process.env.OPENAI_API_KEY || "" : "";
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!["weekly", "monthly", "yearly"].includes(period)) {
  throw new Error("Usage: node work/lastfm-report-generator.mjs weekly|monthly|yearly [YYYY-MM-DD]");
}
if (!lastfmApiKey) {
  throw new Error("LASTFM_API_KEY is required.");
}

await mkdir(OUT_DIR, { recursive: true });
await mkdir(CACHE_DIR, { recursive: true });
await mkdir(HISTORY_DIR, { recursive: true });

const range = getRange(period, startArg);
const previousRange = previousRangeFor(period, range);
const tracks = await fetchRecentTracksCached(range);
const previousTracks = await fetchRecentTracksCached(previousRange).catch(() => []);
const report = await buildReport(period, range, tracks, previousRange, previousTracks);
const registry = await buildRegistry(report);
const html = await renderHtml(ROOT, report, registry);
const outFile = path.join(OUT_DIR, report.filename);

await writeFile(outFile, html, "utf8");
await writeFile(path.join(OUT_DIR, "report-registry.json"), JSON.stringify(registry, null, 2), "utf8");
await writeFile(path.join(OUT_DIR, "index.html"), renderIndexRedirect(registry, report), "utf8");

console.log(JSON.stringify({
  file: outFile,
  index: path.join(OUT_DIR, "index.html"),
  registry: path.join(OUT_DIR, "report-registry.json"),
  scrobbles: report.total,
  range: report.rangeLabel,
  ai: report.ai
}, null, 2));

async function loadLocalEnv(root) {
  const values = {};
  for (const file of [".env", ".env.local"]) {
    const content = await readFile(path.join(root, file), "utf8").catch(() => "");
    Object.assign(values, parseEnvFile(content));
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = unquoteEnvValue(line.slice(index + 1).trim());
  }
  return values;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function getRange(kind, startInput) {
  const now = new Date();
  const start = startInput ? parseKst(startInput) : defaultPreviousStart(kind, now);
  const startDate = fmtDate(start);
  const endExclusive = endExclusiveFor(kind, startDate);
  const endInclusive = new Date(endExclusive.getTime() - 1000);
  return {
    start,
    endExclusive,
    endInclusive,
    fromUnix: Math.floor(start.getTime() / 1000),
    toUnix: Math.floor(endInclusive.getTime() / 1000),
    startDate,
    endDate: fmtDate(endInclusive),
    label: `${startDate} ~ ${fmtDate(endInclusive)}`
  };
}

function endExclusiveFor(kind, startDate) {
  const [year, month, day] = startDate.split("-").map(Number);
  if (kind === "weekly") {
    const end = parseKst(startDate);
    end.setUTCDate(end.getUTCDate() + 7);
    return end;
  }
  if (kind === "monthly") {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return parseKst(`${nextYear}-${pad(nextMonth)}-01`);
  }
  return parseKst(`${year + 1}-01-01`);
}

function previousRangeFor(kind, range) {
  const [year, month] = range.startDate.split("-").map(Number);
  if (kind === "weekly") {
    const start = parseKst(range.startDate);
    start.setUTCDate(start.getUTCDate() - 7);
    return getRange(kind, fmtDate(start));
  }
  if (kind === "monthly") {
    const previousYear = month === 1 ? year - 1 : year;
    const previousMonth = month === 1 ? 12 : month - 1;
    return getRange(kind, `${previousYear}-${pad(previousMonth)}-01`);
  }
  return getRange(kind, `${year - 1}-01-01`);
}

function defaultPreviousStart(kind, now) {
  const kst = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  if (kind === "weekly") {
    const day = kst.getDay() || 7;
    kst.setDate(kst.getDate() - day - 6);
    return parseKst(`${kst.getFullYear()}-${pad(kst.getMonth() + 1)}-${pad(kst.getDate())}`);
  }
  if (kind === "monthly") {
    const year = kst.getMonth() === 0 ? kst.getFullYear() - 1 : kst.getFullYear();
    const month = kst.getMonth() === 0 ? 12 : kst.getMonth();
    return parseKst(`${year}-${pad(month)}-01`);
  }
  return parseKst(`${kst.getFullYear() - 1}-01-01`);
}

function parseKst(ymd) {
  return new Date(`${ymd}T00:00:00+09:00`);
}

function fmtDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

async function fetchRecentTracksCached(range) {
  return cacheJson(`recenttracks-${range.startDate}-to-${range.endDate}.json`, () => fetchRecentTracks(range.fromUnix, range.toUnix));
}

async function cacheJson(file, producer) {
  const target = path.join(CACHE_DIR, file.replace(/[^\w.-]/g, "_"));
  const cached = await readFile(target, "utf8").then(JSON.parse).catch(() => null);
  if (cached) return cached;
  const value = await producer();
  await writeFile(target, JSON.stringify(value), "utf8");
  return value;
}

async function lastfm(method, params = {}) {
  const url = new URL(LASTFM_API);
  Object.entries({ method, user: USER, api_key: lastfmApiKey, format: "json", ...params })
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const res = await fetch(url, { headers: { "User-Agent": "CodexLastfmReportGenerator/2.1" } });
  if (!res.ok) throw new Error(`Last.fm API HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Last.fm API ${json.error}: ${json.message}`);
  return json;
}

async function fetchRecentTracks(from, to) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await lastfm("user.getrecenttracks", { from, to, limit: 200, page, extended: 1 });
    all.push(...array(data.recenttracks.track).filter((track) => track.date?.uts));
    totalPages = Number(data.recenttracks["@attr"]?.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= 80);
  return all;
}

async function buildReport(kind, range, tracks, previousRange, previousTracks) {
  const topTracks = group(tracks, (t) => `${artist(t)} -- ${t.name}`, (t) => ({ artist: artist(t), title: t.name, album: album(t), image: cover(t) })).slice(0, 20);
  const topArtists = group(tracks, (t) => artist(t), (t) => ({ artist: artist(t), image: cover(t) })).slice(0, 20);
  const topAlbums = group(tracks, (t) => album(t) ? `${artist(t)} -- ${album(t)}` : "", (t) => ({ artist: artist(t), album: album(t), image: cover(t) })).slice(0, 20);
  const previousTopArtists = group(previousTracks, (t) => artist(t), (t) => ({ artist: artist(t), image: cover(t) })).slice(0, 20);
  const days = buildDays(kind, tracks);
  const hours = buildHours(tracks);
  const uniqueTracks = new Set(tracks.map((t) => `${artist(t)} -- ${t.name}`)).size;
  const uniqueArtists = new Set(tracks.map((t) => artist(t))).size;
  const uniqueAlbums = new Set(tracks.map((t) => album(t)).filter(Boolean)).size;
  const peak = days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", short: "-", count: 0 });
  const topArtist = topArtists[0] || { artist: "Unknown", count: 0 };
  const topAlbum = topAlbums[0] || { album: "Unknown", artist: "Unknown", count: 0 };
  const concentration = tracks.length ? Math.round((topArtist.count / tracks.length) * 100) : 0;
  const comparison = await buildComparison({ currentTracks: tracks, previousTracks, currentTopArtists: topArtists, previousTopArtists, previousRange });
  const tagTimeline = kind === "weekly"
    ? await buildWeeklyTagTimeline(range, tracks, comparison.currentTags)
    : buildComparisonTagTimeline(previousRange, range, comparison);
  const listeningProfile = buildListeningProfile(kind, range, previousRange, tracks, previousTracks, topArtists, previousTopArtists);
  const periodFocus = buildPeriodFocus(kind, { days, hours, tracks, topArtists, topAlbums, range });
  const deepDive = buildDeepDive(kind, { days, hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison });
  const fallback = fallbackCopy({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums });
  let aiError = null;
  const aiCopy = await generateAiCopy({ kind, range, total: tracks.length, uniqueTracks, uniqueArtists, concentration, peak, topTracks, topArtists, topAlbums, comparison, periodFocus, deepDive }, { apiKey: openaiApiKey, model: openaiModel, apiUrl: OPENAI_API }).catch((error) => {
    aiError = error;
    console.warn(`AI copy generation failed: ${error.message}`);
    return null;
  });
  const copy = mergeCopy(fallback, aiCopy);

  return {
    kind,
    user: USER,
    filename: filenameFor(kind, range),
    rangeLabel: range.label,
    startDate: range.startDate,
    endDate: range.endDate,
    total: tracks.length,
    tracks: uniqueTracks,
    artists: uniqueArtists,
    albums: uniqueAlbums,
    peakDay: peak.short || peak.label,
    headline: headline(topArtist, topAlbum, kind),
    summary: copy.summary,
    story: copy.story,
    insights: copy.insights,
    comparison,
    tagTimeline,
    listeningProfile,
    topTracks,
    topArtists,
    topAlbums,
    days,
    hours,
    periodFocus,
    deepDive,
    recommendation: copy.recommendation,
    ai: {
      enabled: Boolean(aiCopy),
      source: aiCopy ? "openai" : "fallback",
      status: aiCopy ? "AI API success" : openaiApiKey ? "AI API failed" : "AI API not configured",
      model: aiCopy ? openaiModel : "fallback",
      error: aiCopy ? "" : aiError?.message || (openaiApiKey ? "Unknown AI failure" : "OPENAI_API_KEY is missing")
    }
  };
}

async function buildComparison({ currentTracks, previousTracks, currentTopArtists, previousTopArtists, previousRange }) {
  const currentTotal = currentTracks.length;
  const previousTotal = previousTracks.length;
  const delta = currentTotal - previousTotal;
  const percent = previousTotal ? Math.round((delta / previousTotal) * 100) : null;
  const currentTags = await weightedTags(currentTopArtists.slice(0, 6));
  const previousTags = await weightedTags(previousTopArtists.slice(0, 6));
  const tagShift = compareTags(currentTags, previousTags);
  return {
    previousRange: previousRange.label,
    currentTotal,
    previousTotal,
    delta,
    percent,
    percentText: percent === null ? "n/a" : `${percent >= 0 ? "+" : ""}${percent}%`,
    currentTags: currentTags.slice(0, 6),
    previousTags: previousTags.slice(0, 6),
    tagShift,
    summary: comparisonSummary({ previousTotal, delta, percent, tagShift })
  };
}

async function buildWeeklyTagTimeline(currentRange, currentTracks, currentTags) {
  const stored = await readFile(WEEKLY_TAG_HISTORY_FILE, "utf8").then(JSON.parse).catch(() => ({ weekly: [] }));
  const snapshots = new Map(array(stored.weekly).map((snapshot) => [snapshot.startDate, snapshot]));
  const timelineRanges = Array.from({ length: 6 }, (_, index) => weeklyRangeOffset(currentRange, index - 5));

  for (const range of timelineRanges) {
    const isCurrent = range.startDate === currentRange.startDate;
    if (!isCurrent && snapshots.has(range.startDate)) continue;
    const tracks = isCurrent ? currentTracks : await tracksForHistoryRange(range);
    const topArtists = group(tracks, (track) => artist(track), (track) => ({ artist: artist(track), image: cover(track) })).slice(0, 12);
    const tags = isCurrent
      ? currentTags
      : await weightedTags(topArtists.slice(0, 6));
    snapshots.set(range.startDate, {
      startDate: range.startDate,
      endDate: range.endDate,
      label: shortTimelineDate(range.startDate),
      scrobbles: tracks.length,
      tags: tags.slice(0, 10)
    });
  }

  const weekly = [...snapshots.values()]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-104);
  await writeFile(WEEKLY_TAG_HISTORY_FILE, JSON.stringify({ version: 1, weekly }, null, 2), "utf8");
  const wanted = new Set(timelineRanges.map((range) => range.startDate));
  return weekly.filter((snapshot) => wanted.has(snapshot.startDate));
}

function buildComparisonTagTimeline(previousRange, currentRange, comparison) {
  return [
    { startDate: previousRange.startDate, endDate: previousRange.endDate, label: shortTimelineDate(previousRange.startDate), scrobbles: comparison.previousTotal, tags: comparison.previousTags || [] },
    { startDate: currentRange.startDate, endDate: currentRange.endDate, label: shortTimelineDate(currentRange.startDate), scrobbles: comparison.currentTotal, tags: comparison.currentTags || [] }
  ];
}

function weeklyRangeOffset(range, offset) {
  const start = parseKst(range.startDate);
  start.setUTCDate(start.getUTCDate() + offset * 7);
  return getRange("weekly", fmtDate(start));
}

async function tracksForHistoryRange(range) {
  const exactName = `recenttracks-${range.startDate}-to-${range.endDate}.json`;
  const exactPath = path.join(CACHE_DIR, exactName);
  const exact = await readFile(exactPath, "utf8").then(JSON.parse).catch(() => null);
  if (Array.isArray(exact)) return exact;

  const year = range.startDate.slice(0, 4);
  const annualPath = path.join(CACHE_DIR, `recenttracks-${year}-01-01-to-${year}-12-31.json`);
  const annual = await readFile(annualPath, "utf8").then(JSON.parse).catch(() => null);
  if (Array.isArray(annual) && annual.length) {
    const tracks = annual.filter((track) => {
      const uts = Number(track.date?.uts || 0);
      return uts >= range.fromUnix && uts <= range.toUnix;
    });
    await writeFile(exactPath, JSON.stringify(tracks), "utf8");
    return tracks;
  }

  return fetchRecentTracksCached(range);
}

function shortTimelineDate(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(parseKst(date));
}

async function weightedTags(artists) {
  const weights = new Map();
  for (const item of artists) {
    const tags = await cacheJson(`artist-tags-${slug(item.artist)}.json`, async () => {
      const data = await lastfm("artist.getTopTags", { artist: item.artist });
      return array(data.toptags?.tag);
    }).catch(() => []);
    for (const tag of tags.slice(0, 5)) {
      const name = normalizeTag(tag.name);
      if (!name) continue;
      weights.set(name, (weights.get(name) || 0) + item.count);
    }
  }
  return [...weights.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "unknown";
}

function normalizeTag(name) {
  const value = String(name || "").trim().toLowerCase();
  if (!value || value === "seen live") return "";
  return value;
}

function compareTags(current, previous) {
  const prev = new Map(previous.map((tag) => [tag.name, tag.score]));
  return current
    .map((tag) => ({ name: tag.name, delta: tag.score - (prev.get(tag.name) || 0), score: tag.score }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
}


function comparisonSummary({ previousTotal, delta, percent, tagShift }) {
  if (!previousTotal) return "직전 같은 기간 데이터가 부족해서 정량 비교는 생략했습니다.";
  const volume = delta >= 0
    ? `직전 같은 기간보다 ${delta.toLocaleString()} scrobbles 증가했습니다 (${percent >= 0 ? "+" : ""}${percent}%).`
    : `직전 같은 기간보다 ${Math.abs(delta).toLocaleString()} scrobbles 감소했습니다 (${percent}%).`;
  const tags = tagShift.length ? ` Tag 기준으로는 ${tagShift.slice(0, 3).map((tag) => tag.name).join(", ")} 쪽 비중이 상대적으로 커졌습니다.` : "";
  return volume + tags;
}

function filenameFor(kind, range) {
  if (kind === "weekly") return `lastfm-weekly-${range.startDate}-to-${range.endDate}.html`;
  if (kind === "monthly") return `lastfm-monthly-${range.startDate.slice(0, 7)}.html`;
  return `lastfm-annual-${range.startDate.slice(0, 4)}.html`;
}

async function buildRegistry(currentReport) {
  const files = await readdir(OUT_DIR).catch(() => []);
  const reports = files.filter((file) => /^lastfm-(weekly|monthly|annual)-.*\.html$/.test(file)).map(parseReportFilename).filter(Boolean);
  const current = parseReportFilename(currentReport.filename);
  if (current && !reports.some((report) => report.file === current.file)) reports.push(current);
  return reports.sort((a, b) => a.start.localeCompare(b.start));
}

function parseReportFilename(file) {
  let match = file.match(/^lastfm-weekly-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})\.html$/);
  if (match) return { period: "weekly", start: match[1], end: match[2], label: `${match[1]} ~ ${match[2]}`, file };
  match = file.match(/^lastfm-monthly-(\d{4}-\d{2})\.html$/);
  if (match) return { period: "monthly", start: `${match[1]}-01`, end: monthEndDate(match[1]), label: match[1], file };
  match = file.match(/^lastfm-annual-(\d{4})\.html$/);
  if (match) return { period: "yearly", start: `${match[1]}-01-01`, end: `${match[1]}-12-31`, label: match[1], file };
  return null;
}

function monthEndDate(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(parseKst(`${nextYear}-${pad(nextMonth)}-01`).getTime() - 1000);
  return fmtDate(end);
}
