import { readFile } from "node:fs/promises";
import path from "node:path";

const STYLE_FILES = ["base.css", "comparison.css", "deep-dive.css", "status.css", "profile.css", "theme.css", "report.css"];
const CLIENT_FILES = ["core.js", "profile-charts.js", "image-export.js", "bootstrap.js"];

export async function renderHtml(root, report, registry) {
  const reportSourceDir = path.join(root, "work", "lastfm-report");
  const data = JSON.stringify(report).replaceAll("</", "<\\/");
  const nav = JSON.stringify(registry).replaceAll("</", "<\\/");
  const [styles, clients] = await Promise.all([
    Promise.all(STYLE_FILES.map((file) => readFile(path.join(reportSourceDir, "styles", file), "utf8"))),
    Promise.all(CLIENT_FILES.map((file) => readFile(path.join(reportSourceDir, "client", file), "utf8")))
  ]);
  const style = styles.join("\n");
  const client = clients.join("\n");
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
      <nav class="report-nav" aria-label="Report navigation">
        <a class="report-brand" href="./index.html"><span class="mark">fm</span> Listening Report</a>
        <div class="report-nav-links"><a id="previousReport" hidden>← Previous</a><a id="nextReport" hidden>Next →</a><a class="archive-link" href="./archive.html?period=${report.kind}&year=${report.startDate.slice(0, 4)}&current=${encodeURIComponent(report.filename)}">All reports</a></div>
      </nav>
      <header class="report-intro" id="hero">
        <div>
          <p class="report-kicker">${cap(report.kind)} · ${escapeHtml(report.rangeLabel)} · KST</p>
          <h1 id="headline"></h1>
          <p id="summaryText" class="intro-summary"></p>
          <div class="intro-metric"><strong id="mScrobbles"></strong><span>Scrobbles <small id="mChange"></small></span></div>
        </div>
        <div id="coverGrid" class="feature-cover"></div>
      </header>
      <section class="report-section" aria-labelledby="changesTitle">
        <h2 id="changesTitle">What changed</h2>${report.dataNote ? `
        <p class="profile-empty">${escapeHtml(report.dataNote)}</p>` : ""}
        <div id="highlights" class="snapshot-grid"></div>
        <div id="comparisonGrid" class="period-comparison"></div>
      </section>
      <section class="report-section" aria-labelledby="chartsTitle">
        <h2 id="chartsTitle">On rotation</h2>
        <div class="tabs" aria-label="Rankings"><button class="tab active" data-chart="tracks" aria-pressed="true" type="button">Tracks</button><button class="tab" data-chart="artists" aria-pressed="false" type="button">Artists</button><button class="tab" data-chart="albums" aria-pressed="false" type="button">Albums</button></div>
        <div class="chart-section active" id="tracks"></div><div class="chart-section" id="artists"></div><div class="chart-section" id="albums"></div>
        <details class="report-disclosure recommendation"><summary>Recommendation <strong id="recommendationTitle"></strong></summary><p id="recommendationAbout"></p><p id="recommendationWhy"></p></details>
      </section>
      <section class="report-section" aria-labelledby="patternsTitle">
        <h2 id="patternsTitle">Listening patterns</h2>
        <div id="profilePanel">
          <section class="report-card tags-card" aria-labelledby="tagsTitle"><div class="report-card-head"><h3 id="tagsTitle">Tag Movement</h3><span id="tagMovementRange"></span></div><div id="tagMovement"></div></section>
          <div class="patterns-grid">
            <section class="report-card" aria-labelledby="breadthTitle"><h3 id="breadthTitle">Listening Breadth</h3><div id="musicRatio"></div></section>
            <section class="report-card" aria-labelledby="paceTitle"><h3 id="paceTitle">${report.kind === "yearly" ? "Monthly Pace" : "Daily Pace"} <small>KST</small></h3><div id="dayGrid"></div></section>
          </div>
          <details class="report-disclosure"><summary>Time of Day &amp; Listening Fingerprint</summary><div class="patterns-grid"><section class="report-card"><h3>Listening Clock <small>KST</small></h3><div id="listeningClock"></div></section><section class="report-card"><h3>Listening Fingerprint</h3><div id="listeningFingerprint"></div></section></div></details>
        </div>
        <details class="report-disclosure" id="deepDivePanel"><summary id="deepDiveTitle">Deep Dive</summary><div class="deep-dive" id="deepDive"></div></details>
        <details class="report-disclosure"><summary>Report notes</summary><p id="summaryDetail"></p><p id="storyText"></p><div class="insight-grid" id="insights"></div><h3 id="periodFocusTitle"></h3><div class="insight-grid" id="periodFocus"></div></details>
      </section>
      <footer class="report-footer">
        <div class="actions"><button class="button primary" id="copyImage" type="button">Copy image</button><button class="button" id="downloadImage" type="button">Download PNG</button></div>
        <details class="report-disclosure"><summary>AI Status</summary><div class="ai-status" id="aiStatus"></div></details>
      </footer>
    </section>
  </main>
  <dialog class="detail" id="detail" aria-labelledby="detailTitle"><div class="detail-card"><img id="detailImage" alt=""><div><h3 id="detailTitle"></h3><p id="detailMeta"></p><p id="detailBody"></p><button class="button primary" id="closeDetail" type="button" autofocus>Close</button></div></div></dialog>
  <div class="profile-tooltip" id="profileTooltip" role="tooltip"></div>
  <div class="toast" id="toast"></div>
  <script>window.REPORT_DATA=${data};window.REPORT_REGISTRY=${nav};
${client}</script>
</body>
</html>`;
}

export function renderIndexRedirect(registry, currentReport) {
  const latestWeekly = registry.filter((report) => report.period === "weekly").at(-1);
  const target = latestWeekly?.file || currentReport?.filename || registry.at(-1)?.file || "archive.html";
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

export async function renderArchive(root, registry) {
  const base = path.join(root, "work", "lastfm-report");
  const styles = await Promise.all(["base.css", "theme.css", "report.css"].map((file) => readFile(path.join(base, "styles", file), "utf8")));
  const client = await readFile(path.join(base, "client", "archive.js"), "utf8");
  const entries = registry.slice().reverse().map(({period, start, end, file, label}) =>
    `<li data-period="${escapeHtml(period)}" data-start="${escapeHtml(start)}" data-end="${escapeHtml(end)}" data-file="${escapeHtml(file)}"><a href="./${escapeHtml(file)}"><strong>${escapeHtml(label.replace(" ~ ", " – "))}</strong><span aria-hidden="true">↗</span></a></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>All Listening Reports</title><style>${styles.join("\n")}</style></head>
<body><main class="archive-page">
<nav class="report-nav" aria-label="Report navigation"><a class="report-brand" href="./index.html"><span class="mark">fm</span> Latest report</a></nav>
<header class="archive-heading"><h1>All reports</h1></header>
<div class="archive-tools">
  <div class="archive-tabs" role="group" aria-label="Report type"><button type="button" data-period="weekly" aria-pressed="true">Weekly</button><button type="button" data-period="monthly" aria-pressed="false">Monthly</button><button type="button" data-period="yearly" aria-pressed="false">Yearly</button></div>
  <div class="archive-filters"><label>Year <select id="archiveYear"></select></label><label id="monthFilter">Month <select id="archiveMonth"></select></label></div>
</div>
<p id="archiveResults" role="status"></p><ul id="archiveList">${entries}</ul>
</main><script>${client}</script></body></html>`;
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
