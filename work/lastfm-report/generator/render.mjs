import { readFile } from "node:fs/promises";
import path from "node:path";

const STYLE_FILES = ["base.css", "comparison.css", "deep-dive.css", "status.css", "profile.css", "theme.css"];
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
          <section class="panel profile-panel" id="profilePanel"><div class="panel-head"><h3>Listening Profile</h3><span class="hint">Current vs previous period</span></div><div class="panel-body profile-grid"><section class="profile-chart" aria-labelledby="ratioTitle"><div class="profile-chart-head"><h4 id="ratioTitle">Music Ratio</h4><span>Library breadth</span></div><div id="musicRatio"></div></section><section class="profile-chart" aria-labelledby="fingerprintTitle"><div class="profile-chart-head"><h4 id="fingerprintTitle">Listening Fingerprint</h4><span>Behavior scores</span></div><div id="listeningFingerprint"></div></section><section class="profile-chart profile-wide profile-dark" aria-labelledby="tagsTitle"><div class="profile-chart-head"><h4 id="tagsTitle">Tag Movement</h4><span id="tagMovementRange"></span></div><div id="tagMovement"></div></section><section class="profile-chart profile-wide profile-dark" aria-labelledby="clockTitle"><div class="profile-chart-head"><h4 id="clockTitle">Listening Clock</h4><span>KST · 24 hours</span></div><div id="listeningClock"></div></section></div></section>
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
  <div class="profile-tooltip" id="profileTooltip" role="tooltip"></div>
  <div class="toast" id="toast"></div>
  <script>window.REPORT_DATA=${data};window.REPORT_REGISTRY=${nav};
${client}</script>
</body>
</html>`;
}

export function renderIndexRedirect(registry, currentReport) {
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
