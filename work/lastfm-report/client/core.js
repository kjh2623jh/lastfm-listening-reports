const state = {
  report: window.REPORT_DATA,
  registry: window.REPORT_REGISTRY || []
};

const expandedCharts = { track: false, artist: false, album: false };
const fallbackImage = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#d8cab9"/><circle cx="150" cy="150" r="92" fill="#201b18"/><circle cx="150" cy="150" r="20" fill="#d51007"/></svg>');
const fingerprintInfo = {
  consistency: "Listening volume is spread evenly across the period.",
  discovery: "Share of tracks played only once.",
  variety: "Artist breadth relative to unique tracks.",
  concentration: "Share captured by the top five artists.",
  replay: "Share of scrobbles beyond the first play of each track."
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const img = (src) => src || fallbackImage;

function profileAttrs({ chart, key, title, value, note }) {
  return `data-profile-item data-profile-chart="${esc(chart)}" data-profile-key="${esc(key)}" data-profile-title="${esc(title)}" data-profile-value="${esc(value)}" data-profile-note="${esc(note)}" tabindex="0" role="button"`;
}

function currentFilename() {
  return decodeURIComponent(location.pathname.split(/[\\/]/).pop() || "");
}

async function refreshRegistry() {
  try {
    const res = await fetch("./report-registry.json", { cache: "no-store" });
    if (!res.ok) return;
    const registry = await res.json();
    if (Array.isArray(registry) && registry.length) {
      state.registry = registry;
      renderReportControls();
    }
  } catch {
    // Standalone local HTML can still use its embedded registry.
  }
}

function reportsFor(period) {
  return state.registry.filter((report) => report.period === period).sort((a, b) => a.start.localeCompare(b.start));
}

function currentRegistryEntry() {
  const file = currentFilename();
  return state.registry.find((report) => report.file === file)
    || state.registry.find((report) => report.period === state.report.kind && report.start === state.report.startDate);
}

function renderReportControls() {
  const entry = currentRegistryEntry();
  const reports = reportsFor(state.report.kind);
  const index = reports.findIndex((report) => report.file === entry?.file);
  for (const [id, offset] of [["#previousReport", -1], ["#nextReport", 1]]) {
    const link = $(id);
    const target = index >= 0 ? reports[index + offset] : null;
    link.hidden = !target;
    if (target) {
      link.href = "./" + target.file;
      link.setAttribute("aria-label", `${link.textContent.trim()} report, ${target.label}`);
    }
  }
}

function signed(value) {
  return (value > 0 ? "+" : "") + value.toLocaleString();
}

function render() {
  const r = state.report;
  const album = r.topAlbums[0];
  $("#headline").textContent = r.headline;
  $("#summaryText").textContent = album ? `${album.artist} · ${album.album} · ${album.count.toLocaleString()} plays` : "No album listening data";
  $("#summaryDetail").textContent = r.summary;
  $("#storyText").textContent = r.story;
  $("#recommendationTitle").textContent = r.recommendation.title;
  $("#recommendationAbout").textContent = r.recommendation.about;
  $("#recommendationWhy").textContent = r.recommendation.why;
  $("#mScrobbles").textContent = r.total.toLocaleString();
  renderReportControls();
  renderCovers();
  renderHighlights();
  renderInsights();
  renderComparison();
  renderPeriodFocus();
  renderDeepDive();
  renderListeningProfile();
  renderCharts();
  renderDays();
  renderAiStatus();
}

function renderHighlights() {
  const r = state.report;
  const track = r.topTracks[0];
  const album = r.topAlbums[0];
  const peak = r.days.reduce((best, day) => day.count > (best?.count || 0) ? day : best, null);
  const latest = r.tagTimeline?.at(-1)?.tags?.[0];
  const sustain = r.sustainedAlbum;
  const cards = [];
  if (r.kind === "weekly" && track) cards.push(["Most played track", track.title, `${track.artist} · ${track.count.toLocaleString()} plays`, track, "track"]);
  if (r.kind !== "weekly" && sustain) {
    const unit = r.kind === "yearly" ? "month" : "week";
    cards.push(["Staying in rotation", sustain.album, `${sustain.artist} · played in ${sustain.activeBuckets} ${unit}${sustain.activeBuckets === 1 ? "" : "s"}`, sustain, "album"]);
  }
  if (r.kind !== "weekly" && !sustain && album) cards.push(["Most played album", album.album, `${album.artist} · ${album.count.toLocaleString()} plays`, album, "album"]);
  if (r.kind === "monthly" && latest) cards.push(["Leading tag", latest.name, "See how it moved across six months", null, "tags"]);
  if (peak) cards.push([r.kind === "yearly" ? "Busiest month" : "Busiest day", peak.label, `${peak.count.toLocaleString()} plays`]);
  $("#highlights").innerHTML = cards.map(([label, value, note, item, type]) => {
    const content = `<span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small>`;
    if (item) return `<button class="snapshot" type="button" data-detail='${payload(item, type)}'>${content}</button>`;
    if (type === "tags") return `<a class="snapshot" href="#tagsTitle">${content}</a>`;
    return `<article class="snapshot">${content}</article>`;
  }).join("") || '<p class="profile-empty">No listening activity in this period.</p>';
}

function payload(item, type) {
  return esc(JSON.stringify({ type, ...item }));
}

function renderCovers() {
  const album = state.report.topAlbums[0];
  if (!album) {
    $("#coverGrid").hidden = true;
    return;
  }
  $("#coverGrid").innerHTML = `<button type="button" data-detail='${payload(album, "album")}'><img src="${esc(img(album.image))}" alt="${esc(album.album)} album cover"></button>`;
}

function renderInsights() {
  $("#insights").innerHTML = (state.report.insights || []).map(([title, body]) => `<article class="insight-card"><b>${esc(title)}</b><p>${esc(body)}</p></article>`).join("");
}

function renderComparison() {
  const c = state.report.comparison;
  const available = c.previousAvailable ?? (c.previousTotal > 0);
  $("#mChange").textContent = available
    ? `${signed(c.delta)} vs previous${c.percent == null ? "" : ` (${c.percentText})`}`
    : "Previous period unavailable";
  $("#comparisonGrid").innerHTML = `<span>${esc(c.previousRange || "Previous period")}</span><strong>${available ? c.previousTotal.toLocaleString() + " plays" : "Data unavailable"}</strong>`;
}

function renderPeriodFocus() {
  const focus = state.report.periodFocus || { title: "Period Focus", cards: [] };
  $("#periodFocusTitle").textContent = focus.title;
  $("#periodFocus").innerHTML = (focus.cards || []).map((card) => `<article class="insight-card"><b>${esc(card.label)} · ${esc(card.value)}</b><p>${esc(card.note)}</p></article>`).join("");
}

function renderDeepDive() {
  const dive = state.report.deepDive || { title: "", sections: [] };
  const panel = $("#deepDivePanel");
  if (!dive.sections || dive.sections.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#deepDiveTitle").textContent = dive.title || "Deep Dive";
  $("#deepDive").innerHTML = dive.sections.map((section) => `
    <article class="deep-section">
      <div class="deep-section-head">
        <h4>${esc(section.title)}</h4>
        <p>${esc(section.note || "")}</p>
      </div>
      <div class="deep-items">
        ${(section.items || []).map((item) => `
          <div class="deep-item">
            <span>${esc(item.label)}</span>
            <strong>${esc(item.value)}</strong>
            <p>${esc(item.note || "")}</p>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderCharts() {
  $("#tracks").innerHTML = list(state.report.topTracks, "track");
  $("#artists").innerHTML = list(state.report.topArtists, "artist");
  $("#albums").innerHTML = list(state.report.topAlbums, "album");
}

function list(rows, type) {
  if (!rows.length) return '<p class="profile-empty">No listening activity in this ranking.</p>';
  const visible = expandedCharts[type] ? rows : rows.slice(0, 5);
  const more = rows.length > 5 ? `<button class="more-btn" type="button" data-more="${type}">${expandedCharts[type] ? "Show less" : `More ${rows.length - 5}`}</button>` : "";
  return `<ol class="rank-list">${visible.map((item, index) => {
    const title = type === "artist" ? item.artist : type === "album" ? item.album : item.title;
    const sub = type === "artist" ? "Artist" : item.artist + (item.album && type === "track" ? ` · ${item.album}` : "");
    return `<li><button class="rank-item" type="button" data-detail='${payload(item, type)}'><img class="thumb" src="${esc(img(item.image))}" alt="" loading="lazy"><span class="rank-title"><strong>${index + 1}. ${esc(title)}</strong><span>${esc(sub)}</span></span><span class="count">${item.count}</span></button></li>`;
  }).join("")}</ol>${more}`;
}

function renderDays() {
  const report = state.report;
  const yearly = report.kind === "yearly";
  const start = new Date(report.startDate);
  const end = new Date(report.endDate);
  const counts = new Map(report.days.map((day) => [day.order, day.count]));
  const format = new Intl.DateTimeFormat("en", {month: "short", ...(yearly ? {} : {day: "numeric"}), timeZone: "UTC"});
  const buckets = [];
  for (const date = new Date(start); date <= end;) {
    const key = date.toISOString().slice(0, yearly ? 7 : 10);
    buckets.push({label: format.format(date), count: counts.get(key) || 0});
    if (yearly) date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + 1);
  }
  const peak = buckets.reduce((best, bucket) => bucket.count > best.count ? bucket : best, buckets[0]);
  const max = Math.max(peak.count, 1);
  const bars = buckets.map((bucket) => {
    const label = `${bucket.label} · ${bucket.count.toLocaleString()} plays`;
    return `<button type="button" class="pace-bar" aria-label="${esc(label)}" aria-pressed="${bucket === peak}" style="--pace-height:${bucket.count / max * 100}%"><i></i></button>`;
  }).join("");
  $("#dayGrid").innerHTML = `<div class="pace-chart" style="--pace-slots:${buckets.length}">${bars}</div><div class="pace-axis"><span>${esc(buckets[0].label)}</span><span>${esc(buckets.at(-1).label)}</span></div><p class="pace-readout" id="paceReadout" aria-live="polite">${esc(peak.label)} · ${peak.count.toLocaleString()} plays</p>`;
}

function renderAiStatus() {
  const ai = state.report.ai || {};
  const ok = Boolean(ai.enabled);
  $("#aiStatus").innerHTML = `
    <div class="status-badge ${ok ? "ok" : "fallback"}">${ok ? "AI API Success" : "Fallback Used"}</div>
    <dl class="status-list">
      <div><dt>Source</dt><dd>${esc(ai.source || (ok ? "openai" : "fallback"))}</dd></div>
      <div><dt>Model</dt><dd>${esc(ai.model || "-")}</dd></div>
      <div><dt>Status</dt><dd>${esc(ai.status || (ok ? "AI API success" : "Fallback summary"))}</dd></div>
      ${ok ? "" : `<div><dt>Reason</dt><dd>${esc(ai.error || "AI copy was not generated.")}</dd></div>`}
    </dl>
  `;
}

function openDetail(item) {
  const title = item.type === "artist" ? item.artist : item.type === "album" ? item.album : item.title;
  const meta = item.type === "artist" ? `${item.count} scrobbles` : `${item.artist} · ${item.count} scrobbles`;
  $("#detailImage").src = img(item.image);
  $("#detailImage").alt = title;
  $("#detailTitle").textContent = title;
  $("#detailMeta").textContent = meta;
  $("#detailBody").textContent = item.album && item.type !== "album" ? `Album: ${item.album}` : "";
  $("#detailBody").style.display = $("#detailBody").textContent ? "block" : "none";
  $("#detail").showModal();
}
