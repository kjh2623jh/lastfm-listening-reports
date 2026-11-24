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
  <title>Last.fm ${PERIOD_LABELS[report.kind]} 리포트 - ${escapeHtml(report.rangeLabel)}</title>
  <style>${style}</style>
</head>
<body>
  <main class="page">
    <section class="shell">
      <nav class="report-nav" aria-label="리포트 탐색">
        <a class="report-brand" href="./index.html"><span class="mark">fm</span> Listening Report</a>
        <div class="report-nav-links"><a id="previousReport" hidden>← 이전</a><a id="nextReport" hidden>다음 →</a><a class="archive-link" href="./archive.html?period=${report.kind}&year=${report.startDate.slice(0, 4)}&current=${encodeURIComponent(report.filename)}">전체 리포트</a></div>
      </nav>
      <header class="report-intro" id="hero">
        <div>
          <p class="report-kicker">${PERIOD_LABELS[report.kind]} · ${escapeHtml(report.rangeLabel)} · KST</p>
          <h1 id="headline"></h1>
          <p id="summaryText" class="intro-summary"></p>
          <div class="intro-metric"><strong id="mScrobbles"></strong><span>재생 횟수 <small id="mChange"></small></span></div>
        </div>
        <div id="coverGrid" class="feature-cover"></div>
      </header>
      <section class="report-section" aria-labelledby="changesTitle">
        <h2 id="changesTitle">달라진 점</h2>${report.dataNote ? `
        <p class="profile-empty">${escapeHtml(report.dataNote)}</p>` : ""}
        <div id="highlights" class="snapshot-grid"></div>
        <div id="comparisonGrid" class="period-comparison"></div>
      </section>
      <section class="report-section" aria-labelledby="chartsTitle">
        <h2 id="chartsTitle">가장 많이 들은 음악</h2>
        <div class="tabs" aria-label="재생 순위"><button class="tab active" data-chart="tracks" aria-pressed="true" type="button">곡</button><button class="tab" data-chart="artists" aria-pressed="false" type="button">아티스트</button><button class="tab" data-chart="albums" aria-pressed="false" type="button">앨범</button></div>
        <div class="chart-section active" id="tracks"></div><div class="chart-section" id="artists"></div><div class="chart-section" id="albums"></div>
        <details class="report-disclosure recommendation"><summary>추천 음악 <strong id="recommendationTitle"></strong></summary><p id="recommendationAbout"></p><p id="recommendationWhy"></p></details>
      </section>
      <section class="report-section" aria-labelledby="patternsTitle">
        <h2 id="patternsTitle">청취 패턴</h2>
        <div id="profilePanel">
          <section class="report-card tags-card" aria-labelledby="tagsTitle"><div class="report-card-head"><h3 id="tagsTitle">Tag Movement</h3><span id="tagMovementRange"></span></div><div id="tagMovement"></div></section>
          <div class="patterns-grid">
            <section class="report-card" aria-labelledby="breadthTitle"><h3 id="breadthTitle">청취 다양성</h3><div id="musicRatio"></div></section>
            <section class="report-card" aria-labelledby="paceTitle"><h3 id="paceTitle">${report.kind === "yearly" ? "월별 재생" : "일별 재생"} <small>KST</small></h3><div id="dayGrid"></div></section>
          </div>
          <details class="report-disclosure"><summary>시간대와 청취 성향</summary><div class="patterns-grid"><section class="report-card"><h3>시간대별 재생 <small>KST</small></h3><div id="listeningClock"></div></section><section class="report-card"><h3>청취 성향</h3><div id="listeningFingerprint"></div></section></div></details>
        </div>
        <details class="report-disclosure" id="deepDivePanel"><summary id="deepDiveTitle">자세한 분석</summary><div class="deep-dive" id="deepDive"></div></details>
        <details class="report-disclosure"><summary>리포트 노트</summary><p id="summaryDetail"></p><p id="storyText"></p><div class="insight-grid" id="insights"></div><h3 id="periodFocusTitle"></h3><div class="insight-grid" id="periodFocus"></div></details>
      </section>
      <footer class="report-footer">
        <div class="actions"><button class="button primary" id="copyImage" type="button">이미지 복사</button><button class="button" id="downloadImage" type="button">PNG 다운로드</button></div>
        <details class="report-disclosure"><summary>AI 생성 상태</summary><div class="ai-status" id="aiStatus"></div></details>
      </footer>
    </section>
  </main>
  <dialog class="detail" id="detail" aria-labelledby="detailTitle"><div class="detail-card"><img id="detailImage" alt=""><div><h3 id="detailTitle"></h3><p id="detailMeta"></p><p id="detailBody"></p><button class="button primary" id="closeDetail" type="button" autofocus>닫기</button></div></div></dialog>
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
  <title>최신 주간 리포트로 이동</title>
  <script>location.replace("./${escapeJs(target)}");</script>
</head>
<body>
  <p><a href="./${escapeHtml(target)}">최신 주간 리포트 열기</a></p>
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
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>전체 청취 리포트</title><style>${styles.join("\n")}</style></head>
<body><main class="archive-page">
<nav class="report-nav" aria-label="리포트 탐색"><a class="report-brand" href="./index.html"><span class="mark">fm</span> 최신 리포트</a></nav>
<header class="archive-heading"><h1>전체 리포트</h1></header>
<div class="archive-tools">
  <div class="archive-tabs" role="group" aria-label="리포트 유형"><button type="button" data-period="weekly" aria-pressed="true">주간</button><button type="button" data-period="monthly" aria-pressed="false">월간</button><button type="button" data-period="yearly" aria-pressed="false">연간</button></div>
  <div class="archive-filters"><label>연도 <select id="archiveYear"></select></label><label id="monthFilter">월 <select id="archiveMonth"></select></label></div>
</div>
<p id="archiveResults" role="status"></p><ul id="archiveList">${entries}</ul>
</main><script>${client}</script></body></html>`;
}

const PERIOD_LABELS = { weekly: "주간", monthly: "월간", yearly: "연간" };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
