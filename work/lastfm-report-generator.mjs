import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderArchive, renderHtml, renderIndexRedirect } from "./lastfm-report/generator/render.mjs";
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
const openaiModel = process.env.OPENAI_MODEL || "gpt-6-luna";
const openaiReasoningEffort = process.env.OPENAI_REASONING_EFFORT || "low";

if (!["weekly", "monthly", "yearly", "rebuild"].includes(period)) {
  throw new Error("Usage: node work/lastfm-report-generator.mjs weekly|monthly|yearly [YYYY-MM-DD] | rebuild [--verify-history]");
}
if (!lastfmApiKey && (period !== "rebuild" || startArg === "--verify-history")) {
  throw new Error("LASTFM_API_KEY is required.");
}

await mkdir(OUT_DIR, { recursive: true });
await mkdir(CACHE_DIR, { recursive: true });
await mkdir(HISTORY_DIR, { recursive: true });

if (period === "rebuild") {
  await rebuildArchive(startArg === "--verify-history");
} else {
  const range = getRange(period, startArg);
  const previousRange = previousRangeFor(period, range);
  const registry = await buildRegistry({ filename: filenameFor(period, range) });
  const archived = await readArchivedReports(registry.filter((entry) => entry.file !== filenameFor(period, range)));
  const previousReport = archived.find((saved) => saved.kind === period && saved.startDate === previousRange.startDate);
  const tracks = await fetchRecentTracksCached(range);
  const previousTracks = previousReport ? null : await fetchRecentTracksCached(previousRange).catch((error) => {
    console.warn(`Previous period ${previousRange.label}: ${error.message}`);
    return null;
  });
  const report = await buildReport(period, range, tracks, previousRange, previousTracks, { previousReport });
  const periods = collectSnapshots([...archived, report]);
  if (period === "weekly") {
    const recent = await readWeeklyHistory();
    for (const snapshot of recent.values()) {
      if (!periods.weekly.has(snapshot.startDate)) periods.weekly.set(snapshot.startDate, snapshot);
    }
  }
  report.tagTimeline = await buildTagTimeline(report, periods, { tracks, fetchMissing: true });
  if (period === "weekly") await writeWeeklyHistory(periods.weekly);
  await writeFile(path.join(OUT_DIR, report.filename), await renderHtml(ROOT, report, registry), "utf8");
  await writeReportIndex(registry, report);
  console.log(JSON.stringify({ file: report.filename, scrobbles: report.total, range: report.rangeLabel, ai: report.ai }, null, 2));
}

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
  const res = await fetch(url, { headers: { "User-Agent": "CodexLastfmReportGenerator/2.1" }, signal: AbortSignal.timeout(20000) });
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
    all.push(...array(data.recenttracks.track).filter((track) => {
      const timestamp = Number(track.date?.uts);
      return timestamp >= from && timestamp <= to;
    }));
    totalPages = Number(data.recenttracks["@attr"]?.totalPages || 1);
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function buildReport(kind, range, tracks, previousRange, previousData, { skipAi = false, previousReport } = {}) {
  const previousTracks = previousData || [];
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
  const comparison = await buildComparison({ currentTracks: tracks, previousTracks, currentTopArtists: topArtists, previousTopArtists, previousRange, previousReport, previousAvailable: Boolean(previousReport) || previousData !== null });
  const listeningProfile = buildListeningProfile(kind, range, previousRange, tracks, previousTracks, topArtists, previousTopArtists);
  if (previousReport) {
    listeningProfile.ratio.previous = previousReport.listeningProfile?.ratio?.current || null;
    listeningProfile.fingerprint.previous = previousReport.listeningProfile?.fingerprint?.current || null;
  }
  const periodFocus = buildPeriodFocus(kind, { days, hours, tracks, topArtists, topAlbums, range });
  const deepDive = buildDeepDive(kind, { days, hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison });
  const fallback = fallbackCopy({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums });
  let aiError = null;
  const aiCopy = skipAi ? null : await generateAiCopy({ kind, range, total: tracks.length, uniqueTracks, uniqueArtists, concentration, peak, topTracks, topArtists, topAlbums, comparison, periodFocus, deepDive }, { apiKey: openaiApiKey, model: openaiModel, reasoningEffort: openaiReasoningEffort, apiUrl: OPENAI_API }).catch((error) => {
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
    sustainedAlbum: findSustainedAlbum(kind, tracks),
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

async function buildComparison({ currentTracks, previousTracks, currentTopArtists, previousTopArtists, previousRange, previousAvailable, previousReport }) {
  const currentTotal = currentTracks.length;
  const previousTotal = previousReport?.total ?? previousTracks.length;
  const delta = previousAvailable ? currentTotal - previousTotal : null;
  const percent = previousTotal ? Math.round((delta / previousTotal) * 100) : null;
  const currentTags = await weightedTags(currentTopArtists.slice(0, 6));
  const previousTags = previousReport?.comparison?.currentTags || await weightedTags(previousTopArtists.slice(0, 6));
  const tagShift = compareTags(currentTags, previousTags);
  return {
    previousRange: previousRange.label,
    currentTotal,
    previousTotal,
    previousAvailable,
    delta,
    percent,
    percentText: percent === null ? "n/a" : `${percent >= 0 ? "+" : ""}${percent}%`,
    currentTags: currentTags.slice(0, 6),
    previousTags: previousTags.slice(0, 6),
    tagShift,
    summary: comparisonSummary({ previousTotal, delta, percent, tagShift })
  };
}

function snapshot(range, scrobbles, tags) {
  return { startDate: range.startDate, endDate: range.endDate, scrobbles, tags: tags || [] };
}

function currentSnapshot(report) {
  return snapshot(report, report.total, report.comparison.currentTags);
}

function previousSnapshot(report) {
  const comparison = report.comparison;
  if (!(comparison.previousAvailable ?? comparison.previousTotal > 0)) return null;
  return snapshot(previousRangeFor(report.kind, report), comparison.previousTotal, comparison.previousTags);
}

function collectSnapshots(reports) {
  const periods = { weekly: new Map(), monthly: new Map() };
  for (const report of reports) {
    const byDate = periods[report.kind];
    if (byDate) byDate.set(report.startDate, currentSnapshot(report));
  }
  for (const report of reports) {
    const byDate = periods[report.kind];
    if (!byDate) continue;
    const previous = previousSnapshot(report);
    if (previous && !byDate.has(previous.startDate)) byDate.set(previous.startDate, previous);
    for (const slot of report.tagTimeline || []) {
      if (slot.scrobbles != null && !byDate.has(slot.startDate)) byDate.set(slot.startDate, slot);
    }
  }
  return periods;
}

function timelineRanges(report) {
  if (report.kind === "yearly") {
    return Array.from({ length: 12 }, (_, index) =>
      getRange("monthly", `${report.startDate.slice(0, 4)}-${pad(index + 1)}-01`));
  }

  const ranges = [getRange(report.kind, report.startDate)];
  while (ranges.length < 6) ranges.unshift(previousRangeFor(report.kind, ranges[0]));
  return ranges;
}

async function buildTagTimeline(report, periods, { tracks, fetchMissing = false } = {}) {
  const annual = report.kind === "yearly";
  const byDate = periods[report.kind === "weekly" ? "weekly" : "monthly"];
  const previous = annual ? null : previousSnapshot(report);
  const timeline = [];

  for (const range of timelineRanges(report)) {
    let data = previous?.startDate === range.startDate ? previous : byDate.get(range.startDate);
    if (annual && tracks) {
      data = await snapshotFromTracks(range, tracks.filter((track) => inRange(track, range)));
    } else if (!data && fetchMissing) {
      const historyTracks = await fetchRecentTracksCached(range).catch((error) => {
        console.warn(`Tag history ${range.label}: ${error.message}`);
        return null;
      });
      if (historyTracks) data = await snapshotFromTracks(range, historyTracks);
    }
    if (data && !byDate.has(data.startDate)) byDate.set(data.startDate, data);

    const date = parseKst(range.startDate);
    const weekly = report.kind === "weekly";
    const shortLabel = weekly
      ? `${range.startDate.slice(5, 7)}/${range.startDate.slice(8)}`
      : new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short" }).format(date);
    const label = weekly ? range.startDate : `${shortLabel} ${range.startDate.slice(0, 4)}`;
    timeline.push({ ...snapshot(range, null, []), ...data, label, shortLabel });
  }
  return timeline;
}

async function snapshotFromTracks(range, tracks) {
  const artists = group(tracks, artist, (track) => ({ artist: artist(track) })).slice(0, 6);
  return snapshot(range, tracks.length, (await weightedTags(artists)).slice(0, 6));
}

function inRange(track, range) {
  const time = Number(track.date?.uts);
  return time >= range.fromUnix && time <= range.toUnix;
}

function findSustainedAlbum(kind, tracks) {
  if (kind === "weekly") return null;
  const albums = new Map();
  for (const track of tracks) {
    const name = album(track);
    if (!name) continue;
    const key = `${artist(track)} -- ${name}`;
    const item = albums.get(key) || { artist: artist(track), album: name, image: cover(track), count: 0, buckets: new Set() };
    const date = fmtDate(new Date(Number(track.date.uts) * 1000));
    item.buckets.add(kind === "yearly" ? date.slice(0, 7) : Math.ceil(Number(date.slice(-2)) / 7));
    item.count += 1;
    albums.set(key, item);
  }
  const best = [...albums.values()].sort((a, b) => b.buckets.size - a.buckets.size || b.count - a.count || a.album.localeCompare(b.album))[0];
  if (!best) return null;
  const { buckets, ...item } = best;
  return { ...item, activeBuckets: buckets.size };
}

async function readWeeklyHistory() {
  const stored = await readFile(WEEKLY_TAG_HISTORY_FILE, "utf8").then(JSON.parse).catch(() => ({ weekly: [] }));
  return new Map(array(stored.weekly).map((slot) => [slot.startDate, slot]));
}

async function writeWeeklyHistory(snapshots) {
  const weekly = [...snapshots.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(-104);
  await writeFile(WEEKLY_TAG_HISTORY_FILE, JSON.stringify({ version: 1, weekly }, null, 2) + "\n", "utf8");
}

async function readArchivedReports(registry) {
  return Promise.all(registry.map(async ({ file }) => {
    const html = await readFile(path.join(OUT_DIR, file), "utf8");
    const embedded = html.match(/window\.REPORT_DATA=([\s\S]+?);window\.REPORT_REGISTRY=/);
    if (!embedded) throw new Error(`Could not read the stored report in ${file}`);
    return JSON.parse(embedded[1]);
  }));
}

async function writeReportIndex(registry, current) {
  const archive = await renderArchive(ROOT, registry);
  await Promise.all([
    writeFile(path.join(OUT_DIR, "report-registry.json"), JSON.stringify(registry, null, 2), "utf8"),
    writeFile(path.join(OUT_DIR, "index.html"), renderIndexRedirect(registry, current), "utf8"),
    writeFile(path.join(OUT_DIR, "archive.html"), archive, "utf8")
  ]);
}

async function verifyReportPeriods(reports, kind) {
  const matching = reports.filter((report) => report.kind === kind);
  const byDate = new Map(matching.map((report) => [report.startDate, report]));
  const slots = kind === "weekly" ? await readWeeklyHistory() : new Map();
  const suspect = new Set((kind === "weekly" ? matching.slice(-2) : matching).map((report) => report.startDate));
  const dependents = new Map(matching.map((report) => [
    previousRangeFor(kind, report).startDate, report
  ]));
  for (const report of matching) {
    const previous = previousSnapshot(report);
    const inTimeline = report.tagTimeline?.find((slot) => slot.startDate === previous?.startDate);
    const otherTotals = [inTimeline?.scrobbles, slots.get(previous?.startDate)?.scrobbles, byDate.get(previous?.startDate)?.total];
    if (previous && otherTotals.some((total) => total != null && total !== previous.scrobbles)) {
      suspect.add(previous.startDate);
      console.log(`Rechecking ${previous.startDate} (referenced by ${report.filename})`);
    }
    const own = report.tagTimeline?.find((slot) => slot.startDate === report.startDate);
    if (own && own.scrobbles !== report.total) suspect.add(report.startDate);
  }

  const loadFresh = new Map();
  async function verified(range) {
    if (!loadFresh.has(range.startDate)) {
      loadFresh.set(range.startDate, fetchRecentTracks(range.fromUnix, range.toUnix).catch((error) => {
        console.warn(`Verification unavailable for ${range.label}: ${error.message}`);
        return null;
      }));
    }
    return loadFresh.get(range.startDate);
  }

  const repaired = new Map();
  const checks = new Map();
  const affected = new Set();
  function queue(startDate) {
    if (byDate.has(startDate)) affected.add(byDate.get(startDate));
    if (dependents.has(startDate)) affected.add(dependents.get(startDate));
  }
  for (const startDate of suspect) queue(startDate);

  for (const report of affected) {
    const range = getRange(kind, report.startDate);
    const previousRange = previousRangeFor(kind, range);
    const [tracks, before] = await Promise.all([verified(range), verified(previousRange)]);
    if (!tracks || !before) {
      checks.set(report.startDate, "Some source records could not be verified.");
      continue;
    }
    const earlier = byDate.get(previousRange.startDate);
    if (earlier && before.length !== earlier.total) queue(earlier.startDate);
    if (tracks.length !== report.total) queue(report.startDate);
    const updated = await buildReport(kind, range, tracks, previousRange, before, { skipAi: true });
    if (updated.total === report.total && updated.comparison.previousTotal === report.comparison.previousTotal && updated.headline === report.headline) {
      for (const key of ["summary", "story", "insights", "recommendation", "ai"]) updated[key] = report[key];
    }
    console.log(`${report.startDate}: ${report.total} → ${updated.total}; previous ${report.comparison.previousTotal} → ${updated.comparison.previousTotal}`);
    repaired.set(report.startDate, updated);
  }
  return reports.map((report) => {
    if (report.kind !== kind) return report;
    const updated = repaired.get(report.startDate);
    if (updated) return updated;
    const note = checks.get(report.startDate);
    return note ? { ...report, dataNote: note } : report;
  });
}

async function rebuildArchive(verify) {
  const registry = await buildRegistry();
  let reports = await readArchivedReports(registry);
  if (verify) {
    reports = await verifyReportPeriods(reports, "weekly");
    reports = await verifyReportPeriods(reports, "monthly");
  }
  const periods = collectSnapshots(reports);
  const history = await readWeeklyHistory();
  for (const slot of history.values()) {
    if (!periods.weekly.has(slot.startDate)) periods.weekly.set(slot.startDate, slot);
  }

  for (const report of reports) {
    // A published timeline may contain the only stored month for an annual report.
    if (report.kind !== "yearly") continue;
    for (const slot of report.tagTimeline || []) {
      if (slot.startDate?.slice(8) === "01" && slot.scrobbles != null && !periods.monthly.has(slot.startDate) && slot.endDate === monthEndDate(slot.startDate.slice(0, 7))) {
        periods.monthly.set(slot.startDate, slot);
      }
    }
  }

  for (const report of reports) {
    let tracks;
    if (verify && report.kind === "yearly") {
      const range = getRange(report.kind, report.startDate);
      tracks = await fetchRecentTracksCached(range).catch((error) => {
        console.warn(`Listening history ${range.label}: ${error.message}`);
        return null;
      });
      if (tracks?.length === report.total) report.sustainedAlbum = findSustainedAlbum(report.kind, tracks);
    }
    report.tagTimeline = await buildTagTimeline(report, periods, { tracks: tracks?.length === report.total ? tracks : undefined, fetchMissing: verify });
    await writeFile(path.join(OUT_DIR, report.filename), await renderHtml(ROOT, report, registry), "utf8");
  }
  if (verify) await writeWeeklyHistory(periods.weekly);
  await writeReportIndex(registry);
  console.log(`Rebuilt ${reports.length} reports and their archive.`);
}

async function weightedTags(artists) {
  const weights = new Map();
  for (const item of artists) {
    const tags = await cacheJson(`artist-tags-${slug(item.artist)}.json`, async () => {
      const data = await lastfm("artist.getTopTags", { artist: item.artist });
      return array(data.toptags?.tag);
    }).catch(() => []);
    const names = new Set(tags.slice(0, 5).map((tag) => normalizeTag(tag.name)).filter(Boolean));
    for (const name of names) {
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

async function buildRegistry(currentReport = null) {
  const files = await readdir(OUT_DIR).catch(() => []);
  const reports = files.filter((file) => /^lastfm-(weekly|monthly|annual)-.*\.html$/.test(file)).map(parseReportFilename).filter(Boolean);
  const current = currentReport ? parseReportFilename(currentReport.filename) : null;
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
