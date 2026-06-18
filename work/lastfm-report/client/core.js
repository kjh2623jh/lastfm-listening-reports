const state = {
  report: window.REPORT_DATA,
  registry: window.REPORT_REGISTRY || [],
  period: window.REPORT_DATA.kind
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

function selectedReport() {
  const picker = $("#reportPicker");
  if (!picker || !picker.value) return null;
  return state.registry.find((report) => report.file === picker.value) || null;
}

function renderReportControls() {
  const entry = currentRegistryEntry();
  const activePeriod = state.period || state.report.kind;
  $$(".pill[data-period]").forEach((button) => {
    const count = reportsFor(button.dataset.period).length;
    button.disabled = count === 0;
    button.classList.toggle("active", button.dataset.period === activePeriod);
    button.title = count ? `${count} saved report${count > 1 ? "s" : ""}` : "저장된 리포트가 없습니다.";
  });

  const picker = $("#reportPicker");
  const previousValue = picker.value;
  const options = reportsFor(activePeriod);
  picker.innerHTML = options.map((report) => `<option value="${esc(report.file)}">${esc(report.label)}</option>`).join("");
  const selected = options.find((report) => report.file === previousValue)
    || options.find((report) => entry && report.file === entry.file)
    || options.at(-1);
  if (selected) picker.value = selected.file;
  picker.disabled = options.length === 0;

  const index = options.findIndex((report) => report.file === picker.value);
  $("#prevPeriod").disabled = index <= 0;
  $("#nextPeriod").disabled = index < 0 || index >= options.length - 1;
  $("#openLocal").disabled = !selected;
}

function render() {
  const r = state.report;
  state.period = r.kind;
  $("#rangeText").textContent = `${r.user} · ${r.rangeLabel} · KST`;
  $("#headline").textContent = r.headline;
  $("#summaryText").textContent = r.summary;
  $("#storyText").textContent = r.story;
  $("#recommendationTitle").textContent = r.recommendation.title;
  $("#recommendationAbout").textContent = r.recommendation.about;
  $("#recommendationWhy").textContent = r.recommendation.why;
  $("#mScrobbles").textContent = r.total.toLocaleString();
  $("#mTracks").textContent = r.tracks.toLocaleString();
  $("#mArtists").textContent = r.artists.toLocaleString();
  $("#mPeak").textContent = r.peakDay;
  $("#hero").style.setProperty("--hero-art", `url("${img(r.topAlbums[0]?.image)}")`);
  renderReportControls();
  renderCovers();
  renderInsights();
  renderComparison();
  renderPeriodFocus();
  renderDeepDive();
  renderListeningProfile();
  renderCharts();
  renderDays();
  renderHours();
  renderAlbumFocus();
  renderAiStatus();
}

function payload(item, type) {
  return esc(JSON.stringify({ type, ...item }));
}

function renderCovers() {
  $("#coverGrid").innerHTML = state.report.topAlbums.slice(0, 6).map((album) => `<button class="cover-tile" type="button" data-detail='${payload(album, "album")}'><img src="${img(album.image)}" alt="${esc(album.album)} album cover" loading="lazy"><span>${esc(album.album)}</span></button>`).join("");
}

function renderInsights() {
  $("#insights").innerHTML = state.report.insights.map(([title, body]) => `<article class="insight-card"><b>${esc(title)}</b><p>${esc(body)}</p></article>`).join("");
}

function renderComparison() {
  const c = state.report.comparison;
  const max = Math.max(c.currentTotal, c.previousTotal, 1);
  $("#comparisonRange").textContent = c.previousRange ? `vs ${c.previousRange}` : "";
  $("#comparisonSummary").textContent = c.summary;
  $("#comparisonGrid").innerHTML = `<article class="compare-card"><strong>${c.delta >= 0 ? "+" : ""}${c.delta.toLocaleString()}</strong><span>Scrobble delta</span></article><article class="compare-card"><strong>${c.percentText}</strong><span>Volume change</span></article><article class="compare-card"><strong>${c.previousTotal.toLocaleString()}</strong><span>Previous scrobbles</span></article><div class="compare-bars"><div class="compare-bar-row"><span>Current</span><div class="compare-track"><i style="width:${Math.round(c.currentTotal / max * 100)}%"></i></div><b>${c.currentTotal.toLocaleString()}</b></div><div class="compare-bar-row previous"><span>Previous</span><div class="compare-track"><i style="width:${Math.round(c.previousTotal / max * 100)}%"></i></div><b>${c.previousTotal.toLocaleString()}</b></div></div><div class="tag-list">${(c.tagShift || []).map((tag) => `<span class="tag">${esc(tag.name)} ${tag.delta >= 0 ? "+" : ""}${tag.delta}</span>`).join("")}</div>`;
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
  const visible = expandedCharts[type] ? rows : rows.slice(0, 5);
  const more = rows.length > 5 ? `<button class="more-btn" type="button" data-more="${type}">${expandedCharts[type] ? "Show less" : `More ${rows.length - 5}`}</button>` : "";
  return `<ol class="rank-list">${visible.map((item, index) => {
    const title = type === "artist" ? item.artist : type === "album" ? item.album : item.title;
    const sub = type === "artist" ? "Artist" : item.artist + (item.album && type === "track" ? ` · ${item.album}` : "");
    return `<li><button class="rank-item" type="button" data-detail='${payload(item, type)}'><img class="thumb" src="${img(item.image)}" alt="" loading="lazy"><span class="rank-title"><strong>${index + 1}. ${esc(title)}</strong><span>${esc(sub)}</span></span><span class="count">${item.count}</span></button></li>`;
  }).join("")}</ol>${more}`;
}

function renderDays() {
  const max = Math.max(...state.report.days.map((day) => day.count), 1);
  $("#dayGrid").innerHTML = state.report.days.map((day) => `<article class="day-card"><span>${esc(day.label)}</span><strong>${day.count}</strong><div class="bar"><div class="fill" style="width:${Math.round(day.count / max * 100)}%"></div></div></article>`).join("");
}

function renderHours() {
  const max = Math.max(...state.report.hours, 1);
  $("#hourHeat").innerHTML = state.report.hours.map((count, hour) => `<div class="hour-wrap"><div class="hour" data-label="${String(hour).padStart(2, "0")}:00 · ${count}" style="height:${Math.max(4, Math.round(count / max * 100))}%"></div><span>${hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span></div>`).join("");
}

function renderAlbumFocus() {
  $("#albumFocus").innerHTML = state.report.topAlbums.slice(0, 6).map((album) => `<button class="mini" type="button" data-detail='${payload(album, "album")}'><img src="${img(album.image)}" alt="" loading="lazy"><span><strong>${esc(album.album)}</strong><span>${esc(album.artist)} · ${album.count} scrobbles</span></span></button>`).join("");
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
  $("#detail").classList.add("open");
}

function openLocalEntry(entry) {
  if (!entry) {
    toast("선택 가능한 리포트가 없습니다.");
    return;
  }
  if (currentFilename() === entry.file) {
    toast("현재 열려 있는 리포트입니다.");
    return;
  }
  location.href = entry.file;
}

function shift(delta) {
  const options = reportsFor(state.period);
  const current = selectedReport();
  const index = options.findIndex((report) => current && report.file === current.file);
  const target = options[index + delta];
  if (target) openLocalEntry(target);
}
