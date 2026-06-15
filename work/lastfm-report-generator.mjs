import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER = "ueii";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.LASTFM_REPORT_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "lastfm-reports");
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const OPENAI_API = "https://api.openai.com/v1/responses";
const TZ = "Asia/Seoul";

const period = (process.argv[2] || "weekly").toLowerCase();
const startArg = process.argv[3];
const lastfmApiKey = process.env.LASTFM_API_KEY || process.argv[4];
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!["weekly", "monthly", "yearly"].includes(period)) {
  throw new Error("Usage: node work/lastfm-report-generator.mjs weekly|monthly|yearly [YYYY-MM-DD]");
}
if (!lastfmApiKey) {
  throw new Error("LASTFM_API_KEY is required.");
}

await mkdir(OUT_DIR, { recursive: true });

const range = getRange(period, startArg);
const previousRange = previousRangeFor(period, range);
const tracks = await fetchRecentTracks(range.fromUnix, range.toUnix);
const previousTracks = await fetchRecentTracks(previousRange.fromUnix, previousRange.toUnix).catch(() => []);
const report = await buildReport(period, range, tracks, previousRange, previousTracks);
const registry = await buildRegistry(report);
const html = await renderHtml(report, registry);
const outFile = path.join(OUT_DIR, report.filename);
await writeFile(outFile, html, "utf8");
await writeFile(path.join(OUT_DIR, "index.html"), renderIndex(registry, report), "utf8");

console.log(JSON.stringify({
  file: outFile,
  index: path.join(OUT_DIR, "index.html"),
  scrobbles: report.total,
  range: report.rangeLabel,
  ai: report.ai
}, null, 2));

function getRange(kind, startInput) {
  const now = new Date();
  const start = startInput ? parseKst(startInput) : defaultPreviousStart(kind, now);
  const endExclusive = new Date(start);
  if (kind === "weekly") endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
  if (kind === "monthly") endExclusive.setUTCMonth(endExclusive.getUTCMonth() + 1);
  if (kind === "yearly") endExclusive.setUTCFullYear(endExclusive.getUTCFullYear() + 1);
  const endInclusive = new Date(endExclusive.getTime() - 1000);
  return {
    start,
    endExclusive,
    endInclusive,
    fromUnix: Math.floor(start.getTime() / 1000),
    toUnix: Math.floor(endInclusive.getTime() / 1000),
    startDate: fmtDate(start),
    endDate: fmtDate(endInclusive),
    label: `${fmtDate(start)} ~ ${fmtDate(endInclusive)}`
  };
}

function previousRangeFor(kind, range) {
  const start = new Date(range.start);
  if (kind === "weekly") start.setUTCDate(start.getUTCDate() - 7);
  if (kind === "monthly") start.setUTCMonth(start.getUTCMonth() - 1);
  if (kind === "yearly") start.setUTCFullYear(start.getUTCFullYear() - 1);
  return getRange(kind, fmtDate(start));
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

async function lastfm(method, params = {}) {
  const url = new URL(LASTFM_API);
  Object.entries({ method, user: USER, api_key: lastfmApiKey, format: "json", ...params })
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const res = await fetch(url, { headers: { "User-Agent": "CodexLastfmReportGenerator/2.0" } });
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
  const peak = days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", short: "-", count: 0 });
  const topArtist = topArtists[0] || { artist: "Unknown", count: 0 };
  const topAlbum = topAlbums[0] || { album: "Unknown", artist: "Unknown", count: 0 };
  const concentration = tracks.length ? Math.round((topArtist.count / tracks.length) * 100) : 0;
  const comparison = await buildComparison({ currentTracks: tracks, previousTracks, currentTopArtists: topArtists, previousTopArtists, previousRange });
  const fallback = fallbackCopy({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums });
  const aiCopy = await generateAiCopy({ kind, range, total: tracks.length, uniqueTracks, uniqueArtists, concentration, peak, topTracks, topArtists, topAlbums, comparison }).catch((error) => {
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
    peakDay: peak.short || peak.label,
    headline: headline(topArtist, topAlbum, kind),
    summary: copy.summary,
    story: copy.story,
    insights: copy.insights,
    comparison,
    topTracks,
    topArtists,
    topAlbums,
    days,
    hours,
    recommendation: copy.recommendation,
    ai: { enabled: Boolean(aiCopy), model: aiCopy ? openaiModel : "fallback" }
  };
}

function group(tracks, keyFn, seedFn) {
  const map = new Map();
  for (const track of tracks) {
    const key = keyFn(track);
    if (!key) continue;
    const current = map.get(key) || { key, count: 0, ...seedFn(track) };
    current.count += 1;
    if (!current.image) current.image = cover(track);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function artist(track) {
  return track.artist?.name || track.artist?.["#text"] || "Unknown Artist";
}

function album(track) {
  return track.album?.["#text"] || "";
}

function cover(track) {
  return [...array(track.image)].reverse().find((img) => img["#text"])?.["#text"] || "";
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildDays(kind, tracks) {
  const formatter = kind === "yearly"
    ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short" })
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "2-digit", day: "2-digit" });
  const map = new Map();
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const order = kind === "yearly"
      ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date)
      : new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const label = formatter.format(date);
    const current = map.get(order) || { label, short: label.split(",")[0], count: 0, order };
    current.count += 1;
    map.set(order, current);
  }
  return [...map.values()].sort((a, b) => a.order.localeCompare(b.order));
}

function buildHours(tracks) {
  const hours = new Array(24).fill(0);
  for (const track of tracks) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(Number(track.date.uts) * 1000)));
    hours[hour] += 1;
  }
  return hours;
}

function headline(topArtist, topAlbum, kind) {
  const label = kind === "weekly" ? "week" : kind === "monthly" ? "month" : "year";
  return `${topArtist.artist} ${label}, ${topAlbum.album} gravity.`;
}

function fallbackCopy({ kind, topArtist, topAlbum, peak, total, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums }) {
  const periodLabel = kind === "weekly" ? "이번 주" : kind === "monthly" ? "지난달" : "작년";
  return {
    summary: `${topArtist.artist}가 ${topArtist.count} scrobbles로 중심을 잡았고, ${topAlbum.album}이 album focus를 만들었습니다. 전체 ${total.toLocaleString()} scrobbles 중 top artist 비중은 ${concentration}%입니다.`,
    story: `${periodLabel}에는 ${total.toLocaleString()} scrobbles 안에서 ${uniqueTracks.toLocaleString()} tracks, ${uniqueArtists.toLocaleString()} artists가 움직였습니다. ${peak.label}에 listening pace가 가장 높았고, 전체적으로는 ${topArtist.artist}와 ${topAlbum.album} 쪽으로 집중된 흐름입니다.`,
    insights: [
      ["Main Character", `${topArtist.artist}가 리포트의 중심입니다. ${topArtist.count} scrobbles, 전체의 ${concentration}%를 차지했습니다.`],
      ["Album Gravity", `${topAlbum.album}은 ${topAlbum.count} scrobbles로 이번 기간의 album 단위 집중을 만들었습니다.`],
      ["Listening Shape", `${total.toLocaleString()} scrobbles / ${uniqueTracks.toLocaleString()} tracks. 넓게 탐색하기보다 좋아하는 축을 깊게 반복한 패턴입니다.`],
      ["Compared", comparison.previousTotal ? `직전 같은 기간보다 ${comparison.delta >= 0 ? "+" : ""}${comparison.delta.toLocaleString()} scrobbles (${comparison.percentText}) 변했습니다.` : "직전 같은 기간 데이터가 부족해서 비교 해석은 제한적입니다."]
    ],
    recommendation: deterministicRecommendation(topArtists, topAlbums)
  };
}

function deterministicRecommendation(topArtists, topAlbums) {
  const names = topArtists.slice(0, 5).map((item) => item.artist).join(", ");
  if (/Magdalena Bay/i.test(names)) {
    return {
      title: "Jane Remover - Census Designated",
      about: "Shoegaze, glitchy indie rock, noisy pop이 겹치는 2023 album입니다.",
      why: "Magdalena Bay의 선명한 pop 구조를 좋아하면서 더 흐리고 거친 texture도 받아들일 수 있을 때 잘 맞는 추천입니다."
    };
  }
  if (/Boards of Canada/i.test(names)) {
    return {
      title: "Broadcast - Tender Buttons",
      about: "Minimal synth-pop과 lo-fi electronic texture가 중심인 album입니다.",
      why: "Boards of Canada의 아날로그한 질감에서 노래 중심의 방향으로 확장하기 좋습니다."
    };
  }
  const album = topAlbums[0];
  return {
    title: album ? `${album.artist} - ${album.album}` : "A focused deep dive from your top artists",
    about: "이번 기간의 중심 취향에서 크게 벗어나지 않는 안전한 연장선입니다.",
    why: "이미 반복해서 들은 축을 더 깊게 확인하는 방향의 추천입니다."
  };
}

function mergeCopy(fallback, aiCopy) {
  if (!aiCopy) return fallback;
  return {
    summary: cleanText(aiCopy.summary, fallback.summary),
    story: cleanText(aiCopy.story, fallback.story),
    insights: normalizeInsights(aiCopy.insights, fallback.insights),
    recommendation: {
      title: cleanText(aiCopy.recommendation?.title, fallback.recommendation.title),
      about: cleanText(aiCopy.recommendation?.about, fallback.recommendation.about),
      why: cleanText(aiCopy.recommendation?.why, fallback.recommendation.why)
    }
  };
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 900) : fallback;
}

function normalizeInsights(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => Array.isArray(item) ? item : [item?.title, item?.body])
    .filter(([title, body]) => title && body)
    .slice(0, 4)
    .map(([title, body]) => [cleanText(title, "Insight"), cleanText(body, "")]);
  return rows.length >= 3 ? rows : fallback;
}

async function generateAiCopy(payload) {
  if (!openaiApiKey) return null;
  const compact = {
    period: payload.kind,
    range: payload.range.label,
    totalScrobbles: payload.total,
    uniqueTracks: payload.uniqueTracks,
    uniqueArtists: payload.uniqueArtists,
    topArtistSharePercent: payload.concentration,
    peak: payload.peak,
    topTracks: payload.topTracks.slice(0, 10).map(({ artist, title, album, count }) => ({ artist, title, album, count })),
    topArtists: payload.topArtists.slice(0, 10).map(({ artist, count }) => ({ artist, count })),
    topAlbums: payload.topAlbums.slice(0, 10).map(({ artist, album, count }) => ({ artist, album, count })),
    comparison: payload.comparison
  };
  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "system",
          content: "You write concise, high-signal music listening reports. Use natural Korean, but keep music terms, album titles, genres, and UI terms in English when that sounds better. Do not force awkward Korean. Return only valid JSON."
        },
        {
          role: "user",
          content: `Create report copy from this Last.fm listening data. Do not invent scrobble counts. Recommend one specific album or track that is not merely the top item, and explain why it fits. JSON shape: {"summary":string,"story":string,"insights":[{"title":string,"body":string}],"recommendation":{"title":string,"about":string,"why":string}}.\n\nDATA:\n${JSON.stringify(compact)}`
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI API HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = extractResponseText(json);
  if (!text) throw new Error("OpenAI response did not contain text");
  return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
}

function extractResponseText(json) {
  if (json.output_text) return json.output_text;
  return array(json.output)
    .flatMap((item) => array(item.content))
    .map((content) => content.text || "")
    .join("")
    .trim();
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

async function weightedTags(artists) {
  const weights = new Map();
  for (const item of artists) {
    const tags = await artistTags(item.artist).catch(() => []);
    for (const tag of tags.slice(0, 5)) {
      const name = normalizeTag(tag.name);
      if (!name) continue;
      weights.set(name, (weights.get(name) || 0) + item.count);
    }
  }
  return [...weights.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
}

async function artistTags(name) {
  const data = await lastfm("artist.getTopTags", { artist: name });
  return array(data.toptags?.tag);
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
  if (match) return { period: "monthly", start: `${match[1]}-01`, end: `${match[1]}-01`, label: match[1], file };
  match = file.match(/^lastfm-annual-(\d{4})\.html$/);
  if (match) return { period: "yearly", start: `${match[1]}-01-01`, end: `${match[1]}-12-31`, label: match[1], file };
  return null;
}

async function renderHtml(report, registry) {
  const data = JSON.stringify(report).replaceAll("</", "<\\/");
  const nav = JSON.stringify(registry).replaceAll("</", "<\\/");
  const [style, client] = await Promise.all([
    readFile(path.join(ROOT, "work", "lastfm-report-template.css"), "utf8"),
    readFile(path.join(ROOT, "work", "lastfm-report-client.js"), "utf8")
  ]);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Last.fm ${cap(report.kind)} Report - ${escapeHtml(report.rangeLabel)}</title>
  <style>${style}</style>
</head>
<body>
  <main class="page">
    <section class="shell">
      <header class="hero" id="hero">
        <div>
          <div class="topline">
            <div class="brand"><div class="mark">fm</div><div><h1>Listening Report</h1><p id="rangeText"></p></div></div>
            <div class="report-controls">
              <div class="control-group" aria-label="Report period">
                <span class="control-label">Period</span>
                <button class="pill" data-period="weekly" type="button">Weekly</button>
                <button class="pill" data-period="monthly" type="button">Monthly</button>
                <button class="pill" data-period="yearly" type="button">Yearly</button>
              </div>
              <div class="control-group report-picker-group" aria-label="Saved local reports">
                <span class="control-label">Report</span>
                <button class="icon-btn" id="prevPeriod" type="button" title="Previous local report">&lt;</button>
                <select class="control report-select" id="reportPicker" aria-label="Saved local report"></select>
                <button class="icon-btn" id="nextPeriod" type="button" title="Next local report">&gt;</button>
              </div>
              <div class="control-group" aria-label="Open local report">
                <span class="control-label">Local</span>
                <button class="pill" id="openLocal" type="button">Open Local</button>
              </div>
            </div>
          </div>
          <div class="hero-copy"><p class="eyebrow">${cap(report.kind)} Report</p><h2 id="headline"></h2><p class="summary" id="summaryText"></p></div>
        </div>
        <aside class="hero-side"><div class="cover-grid" id="coverGrid"></div></aside>
      </header>
      <section class="metrics"><div class="metric"><strong id="mScrobbles"></strong><span>Scrobbles</span></div><div class="metric"><strong id="mTracks"></strong><span>Tracks</span></div><div class="metric"><strong id="mArtists"></strong><span>Artists</span></div><div class="metric"><strong id="mPeak"></strong><span>Peak Day</span></div></section>
      <section class="body">
        <div class="main">
          <section class="panel"><div class="panel-head"><h3>Highlights</h3><span class="hint">${report.ai.enabled ? `AI generated with ${escapeHtml(report.ai.model)}` : "Fallback summary"}</span></div><div class="panel-body"><div class="insight-grid" id="insights"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Comparison</h3><span class="hint" id="comparisonRange"></span></div><div class="panel-body"><p class="story" id="comparisonSummary"></p><div class="compare-grid" id="comparisonGrid"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Charts</h3><span class="hint">Click an item for details</span></div><div class="tabs"><button class="tab active" data-chart="tracks" type="button">Top Tracks</button><button class="tab" data-chart="artists" type="button">Artists</button><button class="tab" data-chart="albums" type="button">Albums</button></div><div class="panel-body"><div class="chart-section active" id="tracks"></div><div class="chart-section" id="artists"></div><div class="chart-section" id="albums"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Daily Pace</h3><span class="hint">KST</span></div><div class="panel-body"><div class="day-grid" id="dayGrid"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Time of Day</h3><span class="hint">Hourly scrobbles</span></div><div class="panel-body"><div class="heat" id="hourHeat"></div></div></section>
        </div>
        <aside class="side">
          <section class="panel"><div class="panel-head"><h3>Report Note</h3></div><div class="panel-body"><p class="story" id="storyText"></p><div class="actions"><button class="button primary" id="copyImage" type="button">Copy image</button><button class="button" id="downloadImage" type="button">Download PNG</button></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Album Focus</h3></div><div class="panel-body"><div class="mini-list" id="albumFocus"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Recommendation</h3></div><div class="panel-body"><p class="story"><strong id="recommendationTitle"></strong></p><p class="story" id="recommendationAbout"></p><p class="story" id="recommendationWhy"></p></div></section>
        </aside>
      </section>
    </section>
  </main>
  <div class="detail" id="detail"><div class="detail-card"><img id="detailImage" alt=""><div><h3 id="detailTitle"></h3><p id="detailMeta"></p><p id="detailBody"></p><button class="button primary" id="closeDetail" type="button">Close</button></div></div></div>
  <div class="toast" id="toast"></div>
  <script>window.REPORT_DATA=${data};window.REPORT_REGISTRY=${nav};
${client}</script>
</body>
</html>`;
}

function renderIndex(registry, currentReport) {
  const rows = registry.slice().reverse().map((report) => `<a class="item" href="./${escapeHtml(report.file)}"><span>${escapeHtml(report.period)}</span><strong>${escapeHtml(report.label)}</strong></a>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Last.fm Listening Reports</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#211c18;background:#100f0e}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0,rgba(213,16,7,.35),transparent 28rem),linear-gradient(135deg,#15110f,#102020);color:#211c18}
    main{width:min(920px,calc(100vw - 28px));margin:0 auto;padding:42px 0}
    header{color:white;margin-bottom:22px} h1{font-size:clamp(40px,8vw,76px);line-height:.9;margin:0 0 12px} p{margin:0;color:rgba(255,255,255,.72)}
    .list{display:grid;gap:10px}.item{display:grid;grid-template-columns:110px minmax(0,1fr);gap:14px;align-items:center;padding:18px 20px;border-radius:14px;background:#fbf7ef;text-decoration:none;color:#211c18;border:1px solid rgba(255,255,255,.35)}
    .item span{text-transform:uppercase;font-size:12px;font-weight:900;color:#d51007}.item strong{font-size:18px}
  </style>
</head>
<body>
  <main>
    <header><h1>Listening Reports</h1><p>Latest: ${escapeHtml(currentReport.kind)} · ${escapeHtml(currentReport.rangeLabel)}</p></header>
    <section class="list">${rows || "<p>No reports yet.</p>"}</section>
  </main>
</body>
</html>`;
}

function cap(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
