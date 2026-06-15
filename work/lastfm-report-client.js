const state = {
  report: window.REPORT_DATA,
  registry: window.REPORT_REGISTRY || [],
  period: window.REPORT_DATA.kind
};
const expandedCharts = { track: false, artist: false, album: false };
const fallbackImage = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#d8cab9"/><circle cx="150" cy="150" r="92" fill="#201b18"/><circle cx="150" cy="150" r="20" fill="#d51007"/></svg>');
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const img = (src) => src || fallbackImage;

function currentFilename() {
  return decodeURIComponent(location.pathname.split(/[\\/]/).pop() || "");
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
    button.title = count ? `${count} saved report${count > 1 ? "s" : ""}` : "저장된 로컬 리포트가 없습니다.";
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
  renderCharts();
  renderDays();
  renderHours();
  renderAlbumFocus();
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
    toast("선택할 수 있는 로컬 리포트가 없습니다.");
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

function drawCanvas() {
  const r = state.report;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#100f0e";
  ctx.fillRect(0, 0, 1200, 1500);
  const g = ctx.createLinearGradient(0, 0, 1200, 1500);
  g.addColorStop(0, "#d51007");
  g.addColorStop(.55, "#171210");
  g.addColorStop(1, "#0e7c7b");
  ctx.globalAlpha = .72;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1200, 1500);
  ctx.globalAlpha = 1;
  round(ctx, 82, 82, 1036, 1336, 28);
  ctx.fillStyle = "#fbf7ef";
  ctx.fill();
  ctx.fillStyle = "#d51007";
  round(ctx, 132, 132, 74, 74, 14);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "900 30px Segoe UI, Arial";
  ctx.fillText("fm", 153, 180);
  ctx.fillStyle = "#d51007";
  ctx.font = "900 25px Segoe UI, Arial";
  ctx.fillText("LAST.FM LISTENING REPORT", 132, 266);
  ctx.fillStyle = "#1f1b18";
  ctx.font = "900 58px Segoe UI, Arial";
  wrap(ctx, r.headline, 132, 350, 920, 68);
  ctx.fillStyle = "#756b60";
  ctx.font = "26px Segoe UI, Arial";
  wrap(ctx, `${r.user} · ${r.rangeLabel} · ${r.total.toLocaleString()} scrobbles`, 132, 505, 900, 36);
  [["Scrobbles", r.total], ["Tracks", r.tracks], ["Artists", r.artists], ["Peak Day", r.peakDay]].forEach(([label, value], i) => {
    const x = 132 + i * 238;
    ctx.fillStyle = "#f2e9da";
    round(ctx, x, 610, 210, 132, 16);
    ctx.fill();
    ctx.fillStyle = "#1f1b18";
    ctx.font = "900 46px Segoe UI, Arial";
    ctx.fillText(String(value), x + 24, 672);
    ctx.fillStyle = "#756b60";
    ctx.font = "22px Segoe UI, Arial";
    ctx.fillText(label, x + 24, 713);
  });
  ctx.fillStyle = "#1f1b18";
  ctx.font = "900 32px Segoe UI, Arial";
  ctx.fillText("Top Tracks", 132, 830);
  ctx.fillText("Top Albums", 650, 830);
  drawRows(ctx, r.topTracks, 132, 870, "track");
  drawRows(ctx, r.topAlbums, 650, 870, "album");
  ctx.fillStyle = "#0e7c7b";
  round(ctx, 132, 1278, 936, 88, 16);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 25px Segoe UI, Arial";
  wrap(ctx, `Recommendation: ${r.recommendation.title}`, 164, 1328, 850, 32);
  return canvas;
}

function drawRows(ctx, rows, x, y, type) {
  rows.slice(0, 5).forEach((item, i) => {
    const yy = y + i * 78;
    ctx.fillStyle = "#fffaf1";
    round(ctx, x, yy, 430, 58, 12);
    ctx.fill();
    ctx.fillStyle = "#d51007";
    ctx.font = "900 22px Segoe UI, Arial";
    ctx.fillText(String(i + 1), x + 18, yy + 37);
    ctx.fillStyle = "#1f1b18";
    ctx.font = "700 21px Segoe UI, Arial";
    ctx.fillText(trunc(type === "album" ? item.album : item.title, 26), x + 58, yy + 30);
    ctx.fillStyle = "#756b60";
    ctx.font = "18px Segoe UI, Arial";
    ctx.fillText(trunc(item.artist, 28), x + 58, yy + 51);
    ctx.fillStyle = "#d51007";
    ctx.font = "900 21px Segoe UI, Arial";
    ctx.fillText(String(item.count), x + 380, yy + 35);
  });
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, x, y, max, line) {
  const words = String(text).split(" ");
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > max && current) {
      ctx.fillText(current, x, y);
      y += line;
      current = word;
    } else {
      current = test;
    }
  }
  if (current) ctx.fillText(current, x, y);
}

function trunc(text, length) {
  text = String(text || "");
  return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

function copyImage() {
  drawCanvas().toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("리포트 이미지를 클립보드에 복사했습니다.");
    } catch {
      download(blob);
      toast("클립보드 복사가 막혀 PNG로 다운로드했습니다.");
    }
  }, "image/png");
}

function downloadImage() {
  drawCanvas().toBlob((blob) => {
    download(blob);
    toast("PNG를 다운로드했습니다.");
  }, "image/png");
}

function download(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lastfm-${state.report.kind}-${state.report.startDate}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2400);
}

document.addEventListener("click", (event) => {
  const more = event.target.closest("[data-more]");
  if (more) {
    expandedCharts[more.dataset.more] = !expandedCharts[more.dataset.more];
    renderCharts();
    return;
  }
  const detail = event.target.closest("[data-detail]");
  if (detail) openDetail(JSON.parse(detail.dataset.detail));
});

$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  $$(".chart-section").forEach((section) => section.classList.toggle("active", section.id === tab.dataset.chart));
}));

$$(".pill[data-period]").forEach((button) => button.addEventListener("click", () => {
  if (button.disabled) return;
  state.period = button.dataset.period;
  renderReportControls();
}));

$("#reportPicker").addEventListener("change", renderReportControls);
$("#prevPeriod").addEventListener("click", () => shift(-1));
$("#nextPeriod").addEventListener("click", () => shift(1));
$("#openLocal").addEventListener("click", () => openLocalEntry(selectedReport()));
$("#copyImage").addEventListener("click", copyImage);
$("#downloadImage").addEventListener("click", downloadImage);
$("#closeDetail").addEventListener("click", () => $("#detail").classList.remove("open"));
$("#detail").addEventListener("click", (event) => {
  if (event.target.id === "detail") $("#detail").classList.remove("open");
});

render();
