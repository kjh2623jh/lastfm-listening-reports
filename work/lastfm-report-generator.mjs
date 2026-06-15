import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER = "ueii";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

await loadLocalEnv(DEFAULT_ROOT);

const ROOT = process.env.LASTFM_REPORT_ROOT || DEFAULT_ROOT;
const OUT_DIR = path.join(ROOT, "outputs", "lastfm-reports");
const CACHE_DIR = path.join(ROOT, "data", "lastfm-cache");
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
await mkdir(CACHE_DIR, { recursive: true });

const range = getRange(period, startArg);
const previousRange = previousRangeFor(period, range);
const tracks = await fetchRecentTracksCached(range);
const previousTracks = await fetchRecentTracksCached(previousRange).catch(() => []);
const report = await buildReport(period, range, tracks, previousRange, previousTracks);
const registry = await buildRegistry(report);
const html = await renderHtml(report, registry);
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
  const peak = days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", short: "-", count: 0 });
  const topArtist = topArtists[0] || { artist: "Unknown", count: 0 };
  const topAlbum = topAlbums[0] || { album: "Unknown", artist: "Unknown", count: 0 };
  const concentration = tracks.length ? Math.round((topArtist.count / tracks.length) * 100) : 0;
  const comparison = await buildComparison({ currentTracks: tracks, previousTracks, currentTopArtists: topArtists, previousTopArtists, previousRange });
  const periodFocus = buildPeriodFocus(kind, { days, hours, tracks, topArtists, topAlbums, range });
  const deepDive = buildDeepDive(kind, { days, hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison });
  const fallback = fallbackCopy({ kind, topArtist, topAlbum, peak, total: tracks.length, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums });
  let aiError = null;
  const aiCopy = await generateAiCopy({ kind, range, total: tracks.length, uniqueTracks, uniqueArtists, concentration, peak, topTracks, topArtists, topAlbums, comparison, periodFocus, deepDive }).catch((error) => {
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


function bucketByWeek(tracks) {
  const buckets = new Map();
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(date));
    const week = Math.ceil(day / 7);
    const label = `Week ${week}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [1, 2, 3, 4, 5].map((week) => ({ label: `Week ${week}`, count: buckets.get(`Week ${week}`) || 0 }));
}

function bucketByQuarter(tracks) {
  const buckets = new Map([["Q1", 0], ["Q2", 0], ["Q3", 0], ["Q4", 0]]);
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(date));
    const label = `Q${Math.ceil(month / 3)}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count }));
}

function buildPeriodFocus(kind, { days, hours, tracks, topArtists, topAlbums }) {
  if (kind === "weekly") {
    const weekdayTotal = days.slice(0, 5).reduce((sum, day) => sum + day.count, 0);
    const weekendTotal = days.slice(5).reduce((sum, day) => sum + day.count, 0);
    const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
    return {
      title: "Weekly Rhythm",
      cards: [
        { label: "Weekday / Weekend", value: `${weekdayTotal} / ${weekendTotal}`, note: "평일과 주말 청취량의 무게 차이입니다." },
        { label: "Late-night", value: String(lateNight), note: "00:00-04:59 KST scrobbles입니다." },
        { label: "Most active day", value: days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 }).label, note: "이번 주 청취가 가장 몰린 날입니다." }
      ]
    };
  }
  if (kind === "monthly") {
    const weeks = bucketByWeek(tracks);
    const bestWeek = weeks.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
    return {
      title: "Monthly Arc",
      cards: [
        { label: "Busiest week", value: bestWeek.label, note: `${bestWeek.count} scrobbles로 가장 강한 주간입니다.` },
        { label: "Active weeks", value: `${weeks.filter((week) => week.count > 0).length}/${weeks.length}`, note: "한 달 안에서 실제로 scrobble이 발생한 주 수입니다." },
        { label: "Album anchor", value: topAlbums[0]?.album || "-", note: "월간 흐름을 잡아준 중심 album입니다." }
      ]
    };
  }
  const quarters = bucketByQuarter(tracks);
  const bestQuarter = quarters.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  return {
    title: "Yearly Seasons",
    cards: [
      { label: "Peak quarter", value: bestQuarter.label, note: `${bestQuarter.count} scrobbles로 가장 강한 분기입니다.` },
      { label: "Artist spread", value: String(topArtists.length), note: "연간 상위권에 남은 artist 수입니다." },
      { label: "Album of the year", value: topAlbums[0]?.album || "-", note: "연간 반복의 중심 album입니다." }
    ]
  };
}

function buildDeepDive(kind, context) {
  if (kind === "weekly") return { title: "Weekly Snapshot", sections: [] };
  return kind === "monthly" ? buildMonthlyDeepDive(context) : buildYearlyDeepDive(context);
}

function buildMonthlyDeepDive({ hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison }) {
  const weeks = bucketByWeek(tracks);
  const bestWeek = weeks.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  const quietWeek = weeks.filter((week) => week.count > 0).reduce((a, b) => a.count < b.count ? a : b, bestWeek);
  const firstHalf = splitByDay(tracks, (day) => day <= 15);
  const secondHalf = tracks.length - firstHalf;
  const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
  const repeatTracks = topTracks.filter((track) => track.count >= 3).length;
  const onePlayTracks = countTrackRepeats(tracks, 1);
  const topFiveArtistShare = share(topArtists.slice(0, 5).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const topFiveAlbumShare = share(topAlbums.slice(0, 5).reduce((sum, item) => sum + item.count, 0), tracks.length);
  return {
    title: "Monthly Deep Dive",
    sections: [
      {
        title: "Month Structure",
        note: "한 달 안에서 청취량이 어느 주차에 몰렸는지 보는 구간입니다.",
        items: weeks.map((week) => ({ label: week.label, value: `${week.count} scrobbles`, note: week.label === bestWeek.label ? "이번 달의 peak week입니다." : "월간 흐름을 구성한 주차입니다." }))
      },
      {
        title: "Momentum",
        note: "월초와 월말의 청취 무게가 어떻게 달라졌는지 봅니다.",
        items: [
          { label: "First half", value: `${firstHalf} scrobbles`, note: "1일부터 15일까지의 청취량입니다." },
          { label: "Second half", value: `${secondHalf} scrobbles`, note: "16일부터 월말까지의 청취량입니다." },
          { label: "Quietest active week", value: quietWeek.label, note: `${quietWeek.count} scrobbles로 가장 낮은 active week입니다.` },
          { label: "Month-over-month", value: comparison.percentText, note: comparison.summary }
        ]
      },
      {
        title: "Depth vs Breadth",
        note: "반복해서 판 음악과 넓게 훑은 음악의 균형입니다.",
        items: [
          { label: "Unique tracks", value: uniqueTracks.toLocaleString(), note: "서로 다른 track 수입니다." },
          { label: "Unique artists", value: uniqueArtists.toLocaleString(), note: "서로 다른 artist 수입니다." },
          { label: "Top artist share", value: `${concentration}%`, note: "1위 artist가 전체 scrobbles에서 차지한 비중입니다." },
          { label: "Top 5 artists", value: topFiveArtistShare, note: "상위 5 artists의 집중도입니다." },
          { label: "Top 5 albums", value: topFiveAlbumShare, note: "상위 5 albums의 집중도입니다." },
          { label: "One-play tracks", value: onePlayTracks.toLocaleString(), note: "한 번만 들은 tracks입니다." }
        ]
      },
      {
        title: "Rotation Signals",
        note: "이번 달 반복 청취의 중심축입니다.",
        items: [
          { label: "Repeat tracks", value: String(repeatTracks), note: "3회 이상 반복된 tracks 수입니다." },
          { label: "Main track", value: topTracks[0]?.title || "-", note: topTracks[0] ? `${topTracks[0].artist}, ${topTracks[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Main artist", value: topArtists[0]?.artist || "-", note: topArtists[0] ? `${topArtists[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Main album", value: topAlbums[0]?.album || "-", note: topAlbums[0] ? `${topAlbums[0].artist}, ${topAlbums[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Late-night weight", value: share(lateNight, tracks.length), note: "00:00-04:59 KST 청취 비중입니다." }
        ]
      }
    ]
  };
}

function buildYearlyDeepDive({ hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison }) {
  const months = bucketByMonth(tracks);
  const quarters = bucketByQuarter(tracks);
  const bestMonth = months.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  const activeMonths = months.filter((month) => month.count > 0).length;
  const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
  const topTenArtistShare = share(topArtists.slice(0, 10).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const topTenAlbumShare = share(topAlbums.slice(0, 10).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const repeatTracks = topTracks.filter((track) => track.count >= 5).length;
  const onePlayTracks = countTrackRepeats(tracks, 1);
  return {
    title: "Yearly Deep Dive",
    sections: [
      {
        title: "Year Timeline",
        note: "연간 청취가 어느 달에 몰렸는지 한눈에 보는 구간입니다.",
        items: months.map((month) => ({ label: month.label, value: `${month.count} scrobbles`, note: month.label === bestMonth.label ? "올해의 peak month입니다." : "연간 흐름을 구성한 월입니다." }))
      },
      {
        title: "Seasonal Shape",
        note: "월보다 큰 단위에서 취향과 사용량의 계절성을 봅니다.",
        items: quarters.map((quarter) => ({ label: quarter.label, value: `${quarter.count} scrobbles`, note: "해당 분기의 총 scrobbles입니다." }))
      },
      {
        title: "Annual Scale",
        note: "연간 리포트에서만 의미가 커지는 규모 지표입니다.",
        items: [
          { label: "Active months", value: `${activeMonths}/12`, note: "실제로 scrobble이 기록된 월 수입니다." },
          { label: "Unique tracks", value: uniqueTracks.toLocaleString(), note: "올해 들은 서로 다른 tracks입니다." },
          { label: "Unique artists", value: uniqueArtists.toLocaleString(), note: "올해 들은 서로 다른 artists입니다." },
          { label: "Year-over-year", value: comparison.percentText, note: comparison.summary }
        ]
      },
      {
        title: "Long-term Taste",
        note: "1년 단위로 봤을 때 취향이 얼마나 집중되었는지 봅니다.",
        items: [
          { label: "Top artist share", value: `${concentration}%`, note: "1위 artist의 연간 비중입니다." },
          { label: "Top 10 artists", value: topTenArtistShare, note: "상위 10 artists가 차지한 비중입니다." },
          { label: "Top 10 albums", value: topTenAlbumShare, note: "상위 10 albums가 차지한 비중입니다." },
          { label: "Repeat tracks", value: String(repeatTracks), note: "5회 이상 반복된 tracks 수입니다." },
          { label: "One-play tracks", value: onePlayTracks.toLocaleString(), note: "한 번만 들은 tracks입니다." },
          { label: "Late-night weight", value: share(lateNight, tracks.length), note: "00:00-04:59 KST 청취 비중입니다." }
        ]
      },
      {
        title: "Year Anchors",
        note: "올해 리포트의 중심으로 남은 이름들입니다.",
        items: [
          { label: "Artist of the year", value: topArtists[0]?.artist || "-", note: topArtists[0] ? `${topArtists[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Album of the year", value: topAlbums[0]?.album || "-", note: topAlbums[0] ? `${topAlbums[0].artist}, ${topAlbums[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Track of the year", value: topTracks[0]?.title || "-", note: topTracks[0] ? `${topTracks[0].artist}, ${topTracks[0].count} scrobbles` : "데이터가 부족합니다." }
        ]
      }
    ]
  };
}

function bucketByMonth(tracks) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const buckets = labels.map((label, index) => ({ label, count: 0, month: index + 1 }));
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(date));
    if (buckets[month - 1]) buckets[month - 1].count += 1;
  }
  return buckets;
}

function splitByDay(tracks, predicate) {
  return tracks.filter((track) => {
    const date = new Date(Number(track.date.uts) * 1000);
    const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(date));
    return predicate(day);
  }).length;
}

function countTrackRepeats(tracks, exactCount) {
  const counts = group(tracks, (track) => `${artist(track)} -- ${track.name}`, (track) => ({ artist: artist(track), title: track.name }));
  return counts.filter((track) => track.count === exactCount).length;
}

function share(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
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
      why: "Magdalena Bay의 선명한 pop 구조를 좋아한다면, 더 흐릿하고 거친 texture 쪽으로 확장하기 좋은 추천입니다."
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
    about: "이번 기간의 중심 취향에서 크게 벗어나지 않는 안전한 확장선입니다.",
    why: "이미 반복해서 들은 축을 한 번 더 깊게 확인하는 방향의 추천입니다."
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
    periodFocus: payload.periodFocus,
    deepDive: payload.deepDive,
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
          content: `Create report copy from this Last.fm listening data. Do not invent scrobble counts. Recommend one specific album or track that is not merely the top item, and explain why it fits. If the period is monthly or yearly, write with more analytical depth than a weekly report because the page has extended deep-dive sections. JSON shape: {"summary":string,"story":string,"insights":[{"title":string,"body":string}],"recommendation":{"title":string,"about":string,"why":string}}.\n\nDATA:\n${JSON.stringify(compact)}`
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
  return array(json.output).flatMap((item) => array(item.content)).map((content) => content.text || "").join("").trim();
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
              <div class="control-group report-picker-group" aria-label="Saved reports">
                <span class="control-label">Report</span>
                <button class="icon-btn" id="prevPeriod" type="button" title="Previous report">&lt;</button>
                <select class="control report-select" id="reportPicker" aria-label="Saved report"></select>
                <button class="icon-btn" id="nextPeriod" type="button" title="Next report">&gt;</button>
              </div>
              <div class="control-group" aria-label="Open report">
                <span class="control-label">Open</span>
                <button class="pill" id="openLocal" type="button">Open</button>
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
          <section class="panel"><div class="panel-head"><h3 id="periodFocusTitle"></h3><span class="hint">Period-specific view</span></div><div class="panel-body"><div class="insight-grid" id="periodFocus"></div></div></section>
          <section class="panel deep-dive-panel" id="deepDivePanel"><div class="panel-head"><h3 id="deepDiveTitle"></h3><span class="hint">Extended analysis</span></div><div class="panel-body"><div class="deep-dive" id="deepDive"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Charts</h3><span class="hint">Click an item for details</span></div><div class="tabs"><button class="tab active" data-chart="tracks" type="button">Top Tracks</button><button class="tab" data-chart="artists" type="button">Artists</button><button class="tab" data-chart="albums" type="button">Albums</button></div><div class="panel-body"><div class="chart-section active" id="tracks"></div><div class="chart-section" id="artists"></div><div class="chart-section" id="albums"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Daily Pace</h3><span class="hint">KST</span></div><div class="panel-body"><div class="day-grid" id="dayGrid"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Time of Day</h3><span class="hint">Hourly scrobbles</span></div><div class="panel-body"><div class="heat" id="hourHeat"></div></div></section>
        </div>
        <aside class="side">
          <section class="panel"><div class="panel-head"><h3>Report Note</h3></div><div class="panel-body"><p class="story" id="storyText"></p><div class="actions"><button class="button primary" id="copyImage" type="button">Copy image</button><button class="button" id="downloadImage" type="button">Download PNG</button></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Album Focus</h3></div><div class="panel-body"><div class="mini-list" id="albumFocus"></div></div></section>
          <section class="panel"><div class="panel-head"><h3>Recommendation</h3></div><div class="panel-body"><p class="story"><strong id="recommendationTitle"></strong></p><p class="story" id="recommendationAbout"></p><p class="story" id="recommendationWhy"></p></div></section>
          <section class="panel"><div class="panel-head"><h3>AI Status</h3><span class="hint">Copy source</span></div><div class="panel-body"><div class="ai-status" id="aiStatus"></div></div></section>
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

function renderIndexRedirect(registry, currentReport) {
  const latestWeekly = registry.filter((report) => report.period === "weekly").at(-1);
  const target = latestWeekly?.file || currentReport.filename;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=./${escapeHtml(target)}">
  <link rel="canonical" href="./${escapeHtml(target)}">
  <title>Redirecting to latest weekly report</title>
  <script>location.replace("./${escapeJs(target)}");</script>
</head>
<body>
  <p><a href="./${escapeHtml(target)}">Open latest weekly report</a></p>
</body>
</html>`;
}

function cap(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
