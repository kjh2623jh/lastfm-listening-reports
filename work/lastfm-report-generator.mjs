import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER = "ueii";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.LASTFM_REPORT_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "lastfm-reports");
const API = "https://ws.audioscrobbler.com/2.0/";
const TZ = "Asia/Seoul";

const period = (process.argv[2] || "weekly").toLowerCase();
const startArg = process.argv[3];
const apiKey = process.env.LASTFM_API_KEY || process.argv[4];

if (!["weekly", "monthly", "yearly"].includes(period)) {
  throw new Error("Usage: node work/lastfm-report-generator.mjs weekly|monthly|yearly [YYYY-MM-DD] [apiKey]");
}
if (!apiKey) {
  throw new Error("LASTFM_API_KEY is required. Set it in the environment or pass it as the fourth argument.");
}

await mkdir(OUT_DIR, { recursive: true });

const range = getRange(period, startArg);
const tracks = await fetchRecentTracks(range.fromUnix, range.toUnix);
const previousRange = previousRangeFor(period, range);
const previousTracks = await fetchRecentTracks(previousRange.fromUnix, previousRange.toUnix).catch(() => []);
const report = await buildReport(period, range, tracks, previousRange, previousTracks);
const registry = await buildRegistry(report);
const html = await renderHtml(report, registry);
const outFile = path.join(OUT_DIR, report.filename);
await writeFile(outFile, html, "utf8");
console.log(JSON.stringify({ file: outFile, scrobbles: report.total, range: report.rangeLabel }, null, 2));

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
  const endExclusive = new Date(range.start);
  if (kind === "weekly") {
    start.setUTCDate(start.getUTCDate() - 7);
  }
  if (kind === "monthly") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  if (kind === "yearly") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  }
  const previous = getRange(kind, fmtDate(start));
  previous.compareLabel = `${previous.startDate} ~ ${previous.endDate}`;
  return previous;
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

async function api(method, params = {}) {
  const url = new URL(API);
  Object.entries({ method, user: USER, api_key: apiKey, format: "json", ...params }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: { "User-Agent": "CodexLastfmReportGenerator/1.0" } });
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
    const data = await api("user.getrecenttracks", { from, to, limit: 200, page, extended: 1 });
    const batch = array(data.recenttracks.track).filter((track) => track.date?.uts);
    all.push(...batch);
    totalPages = Number(data.recenttracks["@attr"]?.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= 80);
  return all;
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function buildReport(kind, range, tracks, previousRange, previousTracks) {
  const topTracks = group(tracks, (t) => `${artist(t)} — ${t.name}`, (t) => ({ artist: artist(t), title: t.name, album: album(t), image: cover(t) })).slice(0, 20);
  const topArtists = group(tracks, (t) => artist(t), (t) => ({ artist: artist(t), image: cover(t) })).slice(0, 20);
  const topAlbums = group(tracks, (t) => album(t) ? `${artist(t)} — ${album(t)}` : "", (t) => ({ artist: artist(t), album: album(t), image: cover(t) })).slice(0, 20);
  const previousTopArtists = group(previousTracks, (t) => artist(t), (t) => ({ artist: artist(t), image: cover(t) })).slice(0, 20);
  const days = buildDays(kind, tracks);
  const hours = buildHours(tracks);
  const uniqueTracks = new Set(tracks.map((t) => `${artist(t)} — ${t.name}`)).size;
  const uniqueArtists = new Set(tracks.map((t) => artist(t))).size;
  const peak = days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  const topArtist = topArtists[0] || { artist: "Unknown", count: 0 };
  const topAlbum = topAlbums[0] || { album: "Unknown", artist: "Unknown", count: 0 };
  const concentration = tracks.length ? Math.round(topArtist.count / tracks.length * 100) : 0;
  const title = headline(topArtist, topAlbum, kind);
  const filename = filenameFor(kind, range);
  const comparison = await buildComparison({
    currentTracks: tracks,
    previousTracks,
    currentTopArtists: topArtists,
    previousTopArtists,
    previousRange
  });
  const rec = recommendation(topArtists, topAlbums);

  return {
    kind,
    user: USER,
    filename,
    rangeLabel: range.label,
    startDate: range.startDate,
    endDate: range.endDate,
    total: tracks.length,
    tracks: uniqueTracks,
    artists: uniqueArtists,
    peakDay: peak.short || peak.label,
    headline: title,
    summary: `${topArtist.artist}가 ${topArtist.count} scrobbles로 가장 강했고, ${topAlbum.album}이 앨범 단위의 중심을 만들었습니다. 전체 ${tracks.length.toLocaleString()} scrobbles 중 top artist 비중은 약 ${concentration}%입니다.`,
    story: narrative({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists }),
    insights: insights({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists, concentration, comparison }),
    comparison,
    topTracks,
    topArtists,
    topAlbums,
    days,
    hours,
    recommendation: rec
  };
}

function group(tracks, keyFn, seedFn) {
  const map = new Map();
  for (const t of tracks) {
    const key = keyFn(t);
    if (!key) continue;
    const current = map.get(key) || { key, count: 0, ...seedFn(t) };
    current.count += 1;
    if (!current.image) current.image = cover(t);
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

function buildDays(kind, tracks) {
  const formatter = kind === "yearly"
    ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short" })
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "2-digit", day: "2-digit" });
  const map = new Map();
  for (const t of tracks) {
    const date = new Date(Number(t.date.uts) * 1000);
    const orderKey = kind === "yearly"
      ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date)
      : new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const label = formatter.format(date);
    const current = map.get(orderKey) || { label, short: label.split(",")[0], count: 0, order: orderKey };
    current.count += 1;
    map.set(orderKey, current);
  }
  return [...map.values()].sort((a, b) => a.order.localeCompare(b.order));
}

function buildHours(tracks) {
  const hours = new Array(24).fill(0);
  for (const t of tracks) {
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(Number(t.date.uts) * 1000)));
    hours[h] += 1;
  }
  return hours;
}

function headline(topArtist, topAlbum, kind) {
  const label = kind === "weekly" ? "week" : kind === "monthly" ? "month" : "year";
  return `${topArtist.artist} ${label}, ${topAlbum.album} gravity.`;
}

function narrative({ kind, topArtist, topAlbum, peak, total, uniqueTracks, uniqueArtists }) {
  const unit = kind === "weekly" ? "이번 주" : kind === "monthly" ? "이번 달" : "올해";
  return `${unit}는 ${total.toLocaleString()} scrobbles 안에서 ${uniqueTracks.toLocaleString()} tracks, ${uniqueArtists.toLocaleString()} artists가 움직였습니다. 중심은 ${topArtist.artist}와 ${topAlbum.album}. ${peak.label}에 청취량이 가장 높았고, 전체적으로는 단일 곡 반복보다 앨범 단위의 흐름이 더 강하게 보입니다.`;
}

function insights({ topArtist, topAlbum, peak, total, uniqueTracks, concentration, comparison }) {
  return [
    ["Main Character", `${topArtist.artist}가 ${topArtist.count} scrobbles로 리포트의 중심입니다. 전체의 약 ${concentration}%를 차지해 취향의 축이 분명합니다.`],
    ["Album Gravity", `${topAlbum.album}은 ${topAlbum.count} scrobbles. 한 앨범이 분위기와 커버 비주얼까지 리포트의 중심을 잡았습니다.`],
    ["Listening Shape", `${total.toLocaleString()} scrobbles / ${uniqueTracks.toLocaleString()} tracks. 넓게 흩어진 탐색보다 좋아하는 축을 두고 깊게 들어간 흐름입니다.`],
    ["Compared", comparison.previousTotal
      ? `직전 같은 기간보다 scrobbles가 ${comparison.delta >= 0 ? "+" : ""}${comparison.delta.toLocaleString()} (${comparison.percentText}) 변했습니다.`
      : "비교할 직전 기간 데이터가 충분하지 않습니다."]
  ];
}

function recommendation(topArtists, topAlbums) {
  const names = topArtists.slice(0, 5).map((a) => a.artist).join(", ");
  if (/Magdalena Bay/i.test(names)) {
    return {
      title: "Jane Remover - Census Designated",
      about: "shoegaze, glitchy indie rock, noisy pop이 겹치는 2023년 앨범입니다.",
      why: "이번 리포트의 Magdalena Bay처럼 pop 구조가 선명하지만, Boards of Canada 쪽의 흐릿한 질감과도 이어지는 선택입니다."
    };
  }
  if (/Boards of Canada/i.test(names)) {
    return {
      title: "Broadcast - Tender Buttons",
      about: "minimal synth-pop과 lo-fi electronic texture가 중심인 앨범입니다.",
      why: "Boards of Canada의 낡은 전자음악 질감은 유지하면서, 더 노래 중심의 방향으로 확장할 수 있습니다."
    };
  }
  if (/Big Thief/i.test(names)) {
    return {
      title: "Adrianne Lenker - Bright Future",
      about: "Big Thief의 송라이팅 축을 더 조용하고 직접적인 방식으로 들을 수 있는 솔로 앨범입니다.",
      why: "이번 리포트에서 folk/indie 쪽 감도가 강했다면, 같은 정서를 더 응축해서 이어 듣기 좋습니다."
    };
  }
  const album = topAlbums[0];
  return {
    title: album ? `${album.artist} - ${album.album}` : "Top artist deep cut",
    about: "이번 기간의 중심 취향에서 크게 벗어나지 않는 안전한 후속 청취입니다.",
    why: "리포트에서 이미 반복 청취가 확인된 축을 더 깊게 탐색하는 방향입니다."
  };
}

async function buildComparison({ currentTracks, previousTracks, currentTopArtists, previousTopArtists, previousRange }) {
  const currentTotal = currentTracks.length;
  const previousTotal = previousTracks.length;
  const delta = currentTotal - previousTotal;
  const percent = previousTotal ? Math.round(delta / previousTotal * 100) : null;
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
    summary: comparisonSummary({ currentTotal, previousTotal, delta, percent, tagShift })
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
  return [...weights.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);
}

async function artistTags(name) {
  const data = await api("artist.getTopTags", { artist: name });
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

function comparisonSummary({ currentTotal, previousTotal, delta, percent, tagShift }) {
  if (!previousTotal) return "직전 같은 기간 데이터가 없거나 충분하지 않아 정량 비교는 생략했습니다.";
  const volume = delta >= 0
    ? `청취량은 직전 같은 기간보다 ${delta.toLocaleString()} scrobbles 증가했습니다 (${percent >= 0 ? "+" : ""}${percent}%).`
    : `청취량은 직전 같은 기간보다 ${Math.abs(delta).toLocaleString()} scrobbles 감소했습니다 (${percent}%).`;
  const tags = tagShift.length
    ? ` tag 기준으로는 ${tagShift.slice(0, 3).map((tag) => tag.name).join(", ")} 쪽 비중이 상대적으로 커졌습니다.`
    : "";
  return volume + tags;
}

function filenameFor(kind, range) {
  if (kind === "weekly") return `lastfm-weekly-${range.startDate}-to-${range.endDate}.html`;
  if (kind === "monthly") return `lastfm-monthly-${range.startDate.slice(0, 7)}.html`;
  return `lastfm-annual-${range.startDate.slice(0, 4)}.html`;
}

async function buildRegistry(currentReport) {
  const files = await readdir(OUT_DIR).catch(() => []);
  const reports = files
    .filter((file) => /^lastfm-(weekly|monthly|annual)-.*\.html$/.test(file))
    .map(parseReportFilename)
    .filter(Boolean);
  const current = parseReportFilename(currentReport.filename);
  if (current && !reports.some((r) => r.file === current.file)) reports.push(current);
  return reports.sort((a, b) => a.start.localeCompare(b.start));
}

function parseReportFilename(file) {
  let m = file.match(/^lastfm-weekly-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})\.html$/);
  if (m) return { period: "weekly", start: m[1], end: m[2], label: `${m[1]} ~ ${m[2]}`, file };
  m = file.match(/^lastfm-monthly-(\d{4}-\d{2})\.html$/);
  if (m) return { period: "monthly", start: `${m[1]}-01`, end: `${m[1]}-01`, label: m[1], file };
  m = file.match(/^lastfm-annual-(\d{4})\.html$/);
  if (m) return { period: "yearly", start: `${m[1]}-01-01`, end: `${m[1]}-12-31`, label: m[1], file };
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
  <title>Last.fm ${cap(report.kind)} Report - ${escape(report.rangeLabel)}</title>
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
          <section class="panel"><div class="panel-head"><h3>Highlights</h3><span class="hint">AI summary from your listening data</span></div><div class="panel-body"><div class="insight-grid" id="insights"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Comparison</h3><span class="hint" id="comparisonRange"></span></div><div class="panel-body"><p class="story" id="comparisonSummary"></p><div class="compare-grid" id="comparisonGrid"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Charts</h3><span class="hint">Click an item for details</span></div><div class="tabs"><button class="tab active" data-chart="tracks" type="button">Top Tracks</button><button class="tab" data-chart="artists" type="button">Artists</button><button class="tab" data-chart="albums" type="button">Albums</button></div><div class="panel-body"><div class="chart-section active" id="tracks"></div><div class="chart-section" id="artists"></div><div class="chart-section" id="albums"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Daily Pace</h3><span class="hint">KST</span></div><div class="panel-body"><div class="day-grid" id="dayGrid"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Time of Day</h3><span class="hint">Hourly scrobbles</span></div><div class="panel-body"><div class="heat" id="hourHeat"></div></div></section>
        </div>
        <aside class="side">
          <section class="panel"><div class="panel-head"><h3>Report Note</h3></div><div class="panel-body"><p class="story" id="storyText"></p><div class="actions"><button class="button primary" id="copyImage" type="button">리포트 이미지 복사</button><button class="button" id="downloadImage" type="button">PNG 다운로드</button></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Album Focus</h3></div><div class="panel-body"><div class="mini-list" id="albumFocus"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Recommendation</h3></div><div class="panel-body"><p class="story"><strong id="recommendationTitle"></strong></p><p class="story" id="recommendationAbout"></p><p class="story" id="recommendationWhy"></p></div></section>
        </aside>
      </section>
    </section>
  </main>
  <div class="detail" id="detail"><div class="detail-card"><img id="detailImage" alt=""><div><h3 id="detailTitle"></h3><p id="detailMeta"></p><p id="detailBody"></p><button class="button primary" id="closeDetail" type="button">닫기</button></div></div></div>
  <div class="toast" id="toast"></div>
  <script>window.REPORT_DATA=${data};window.REPORT_REGISTRY=${nav};
${client}</script>
</body>
</html>`;
}

function cap(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
