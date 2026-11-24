function renderListeningProfile() {
  renderMusicRatio();
  renderFingerprint();
  renderTagMovement();
  renderListeningClock();
}

function renderMusicRatio() {
  const report = state.report;
  const ratio = report.listeningProfile?.ratio;
  const current = ratio?.current || report;
  const available = report.comparison.previousAvailable ?? (report.comparison.previousTotal > 0);
  const previous = available ? ratio?.previous : null;
  const rows = [["tracks", "Tracks"], ["albums", "Albums"], ["artists", "Artists"]];
  $("#musicRatio").innerHTML = `<table class="breadth-table"><thead><tr><th scope="col">Unique</th><th scope="col">Current</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead><tbody>${rows.map(([key, label]) => {
    const value = current[key];
    const before = previous?.[key];
    return `<tr><th scope="row">${label}</th><td><strong>${value?.toLocaleString() ?? "—"}</strong></td><td>${before?.toLocaleString() ?? "—"}</td><td>${value == null || before == null ? "—" : signed(value - before)}</td></tr>`;
  }).join("")}</tbody></table>${available && previous ? "" : '<p class="profile-empty">Previous counts are unavailable.</p>'}`;
}

function renderFingerprint() {
  const fingerprint = state.report.listeningProfile?.fingerprint || {};
  const current = fingerprint.current || { consistency: 0, discovery: 0, variety: 0, concentration: 0, replay: 0 };
  const previous = fingerprint.previous || { consistency: 0, discovery: 0, variety: 0, concentration: 0, replay: 0 };
  const axes = [
    ["Consistency", "consistency"],
    ["Discovery", "discovery"],
    ["Variety", "variety"],
    ["Concentration", "concentration"],
    ["Replay", "replay"]
  ];
  const center = 140;
  const radius = 86;
  const axisPoints = axes.map((_, index) => polarPoint(center, center, radius, index * 72 - 90));
  const grid = [0.33, 0.66, 1].map((scale) => `<polygon class="radar-grid" points="${axisPoints.map((point) => `${center + (point.x - center) * scale},${center + (point.y - center) * scale}`).join(" ")}"></polygon>`).join("");
  const spokes = axisPoints.map((point) => `<line class="radar-spoke" x1="${center}" y1="${center}" x2="${point.x}" y2="${point.y}"></line>`).join("");
  const labels = axes.map(([label], index) => {
    const point = polarPoint(center, center, 116, index * 72 - 90);
    return `<text class="radar-label" x="${point.x}" y="${point.y}" text-anchor="${point.x < center - 10 ? "end" : point.x > center + 10 ? "start" : "middle"}">${label}</text>`;
  }).join("");
  const previousAvailable = Boolean(fingerprint.previous) && (state.report.comparison.previousAvailable ?? (state.report.comparison.previousTotal > 0));
  const previousPoints = previousAvailable ? radarMetricPoints(previous, axes, center, radius) : "";
  const currentPoints = radarMetricPoints(current, axes, center, radius);
  const nodes = axes.map(([label, key], index) => {
    const score = Number(current[key] || 0);
    const before = Number(previous[key] || 0);
    const point = polarPoint(center, center, radius * score / 100, index * 72 - 90);
    return `<circle class="radar-node" cx="${point.x}" cy="${point.y}" r="5" ${profileAttrs({ chart: "fingerprint", key, title: label, value: `${score} / 100`, note: previousAvailable ? `Previous ${before} · ${fingerprintInfo[key]}` : fingerprintInfo[key] })}></circle>`;
  }).join("");
  $("#listeningFingerprint").innerHTML = `<div class="fingerprint-wrap"><svg class="fingerprint-svg" viewBox="0 0 280 280" role="img" aria-label="Listening behavior fingerprint compared with the previous period">${grid}${spokes}${previousAvailable ? `<polygon class="radar-previous" points="${previousPoints}"></polygon>` : ""}<polygon class="radar-current" points="${currentPoints}"></polygon>${nodes}${labels}</svg><div class="profile-legend"><span><i class="legend-current"></i>Current</span>${previousAvailable ? '<span><i class="legend-previous"></i>Previous</span>' : ""}</div></div><div class="profile-detail" id="fingerprintDetail"></div>`;
  setInitialProfileDetail("fingerprint", "consistency");
}

function renderTagMovement() {
  const timeline = state.report.tagTimeline || [];
  const formatPercent = (value) => value == null ? "—" : `${value.toFixed(1)}%`;
  const scores = timeline.map((slot) => new Map(slot.scrobbles > 0
    ? (slot.tags || []).filter((tag) => tag.score > 0 && tag.score <= slot.scrobbles)
      .map((tag) => [tag.name, 100 * tag.score / slot.scrobbles])
    : []));
  const peaks = new Map();
  const coverage = new Map();
  for (const row of scores) {
    for (const [name, value] of row) {
      peaks.set(name, Math.max(peaks.get(name) || 0, value));
      coverage.set(name, (coverage.get(name) || 0) + 1);
    }
  }
  const latest = scores.at(-1);
  const historical = [...coverage.keys()].sort((a, b) => coverage.get(b) - coverage.get(a) || peaks.get(b) - peaks.get(a) || a.localeCompare(b));
  const names = [...new Set([...[...(latest?.keys() || [])].slice(0, 3), ...historical])].slice(0, 6);
  $("#tagMovementRange").textContent = timeline.length ? `${timeline[0].label} – ${timeline.at(-1).label}` : "";
  if (!names.length) {
    $("#tagMovement").innerHTML = '<p class="profile-empty">Tag data is unavailable for this period.</p>';
    return;
  }
  const scale = Math.max(10, Math.ceil(Math.max(...names.map((name) => peaks.get(name))) / 10) * 10);
  const labels = timeline.map((slot) => `<span title="${esc(slot.label)}">${esc(slot.shortLabel || slot.label)}</span>`).join("");
  $("#tagMovement").innerHTML = `<p class="tag-method">Weighted tag score per 100 plays · common scale 0–${scale}%</p><div class="tag-trends" style="--tag-periods:${timeline.length}">${names.map((name) => {
    const value = latest.get(name);
    const earlier = scores.at(-2)?.get(name);
    const delta = value == null || earlier == null ? null : Math.round((value - earlier) * 10) / 10;
    const bars = timeline.map((slot, index) => {
      const score = scores[index].get(name);
      const note = slot.scrobbles == null ? "Period data unavailable" : slot.scrobbles === 0 ? "No plays" : !slot.tags?.length ? "Tag data unavailable" : score == null ? "Outside the stored top tags" : `${slot.scrobbles.toLocaleString()} plays in this period`;
      const attrs = profileAttrs({chart: "tags", key: `${name}-${index}`, title: `${name} · ${slot.label}`, value: formatPercent(score), note});
      return `<button type="button" class="tag-bar ${score == null ? "tag-gap" : ""}" style="--tag-height:${(score || 0) / scale * 100}%" aria-label="${esc(`${name}, ${slot.label}, ${score == null ? note : formatPercent(score)}`)}" ${attrs}><i></i></button>`;
    }).join("");
    return `<article class="tag-trend"><div class="tag-label"><strong>${esc(name)}</strong><span>${formatPercent(value)}${delta == null ? "" : ` <small>${signed(delta)} pp</small>`}</span></div><div class="tag-bars">${bars}</div><div class="tag-ticks" aria-hidden="true">${labels}</div></article>`;
  }).join("")}</div><div class="profile-detail profile-detail-dark" id="tagsDetail" aria-live="polite">Select a period for its tag score.</div>`;
}

function renderListeningClock() {
  const hours = state.report.hours || new Array(24).fill(0);
  const max = Math.max(...hours, 1);
  const busiest = hours.indexOf(max);
  const segments = hours.map((count, hour) => {
    const start = hour * 15 - 89.2;
    const end = (hour + 1) * 15 - 90.8;
    const valueRadius = 55 + count / max * 59;
    const time = `${String(hour).padStart(2, "0")}:00`;
    const attrs = profileAttrs({ chart: "clock", key: String(hour), title: time, value: `${count.toLocaleString()} scrobbles`, note: `${time}-${String(hour).padStart(2, "0")}:59 KST` });
    return `<g class="clock-segment"><path class="clock-hit" d="${donutSectorPath(130, 130, 54, 116, start, end)}" fill="transparent" ${attrs}></path><path class="clock-base" d="${donutSectorPath(130, 130, 55, 114, start, end)}"></path>${count ? `<path class="clock-value-segment" d="${donutSectorPath(130, 130, 55, valueRadius, start, end)}"></path>` : ""}</g>`;
  }).join("");
  $("#listeningClock").innerHTML = `<div class="clock-layout"><svg class="clock-svg" viewBox="0 0 260 260" role="img" aria-label="Listening volume by hour in Korea Standard Time">${segments}<circle class="clock-core" cx="130" cy="130" r="53"></circle><text class="clock-axis" x="130" y="96" text-anchor="middle">00</text><text class="clock-axis" x="165" y="134" text-anchor="middle">06</text><text class="clock-axis" x="130" y="171" text-anchor="middle">12</text><text class="clock-axis" x="94" y="134" text-anchor="middle">18</text></svg><div><div class="clock-stats"><strong>${String(busiest).padStart(2, "0")}:00</strong><span>Busiest hour</span><strong>${max.toLocaleString()}</strong><span>Scrobbles in busiest hour</span><strong>${Math.round(timeBandTotal(hours, 21, 5) / Math.max(state.report.total, 1) * 100)}%</strong><span>Night share · 21:00-04:59</span></div><div class="profile-detail profile-detail-dark" id="clockDetail"></div></div></div>`;
  setInitialProfileDetail("clock", String(busiest));
}

function donutSectorPath(cx, cy, innerRadius, outerRadius, startDegrees, endDegrees) {
  const outerStart = polarPoint(cx, cy, outerRadius, startDegrees);
  const outerEnd = polarPoint(cx, cy, outerRadius, endDegrees);
  const innerEnd = polarPoint(cx, cy, innerRadius, endDegrees);
  const innerStart = polarPoint(cx, cy, innerRadius, startDegrees);
  const largeArc = Math.abs(endDegrees - startDegrees) > 180 ? 1 : 0;
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;
}

function radarMetricPoints(metrics, axes, center, radius) {
  return axes.map(([, key], index) => {
    const score = Math.max(0, Math.min(100, Number(metrics[key] || 0)));
    const point = polarPoint(center, center, radius * score / 100, index * 72 - 90);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function polarPoint(cx, cy, radius, degrees) {
  const radians = degrees * Math.PI / 180;
  return { x: Number((cx + Math.cos(radians) * radius).toFixed(2)), y: Number((cy + Math.sin(radians) * radius).toFixed(2)) };
}

function timeBandTotal(hours, start, end) {
  return hours.reduce((sum, count, hour) => {
    const inBand = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    return sum + (inBand ? count : 0);
  }, 0);
}

function setInitialProfileDetail(chart, key) {
  const item = $$(`[data-profile-chart="${chart}"]`).find((candidate) => candidate.dataset.profileKey === key && candidate.tabIndex >= 0);
  if (item) selectProfileItem(item, true);
}

function selectProfileItem(item, initial = false) {
  const chart = item.dataset.profileChart;
  const key = item.dataset.profileKey;
  $$(`[data-profile-chart="${chart}"]`).forEach((candidate) => {
    candidate.classList.toggle("is-selected", candidate.dataset.profileKey === key);
    candidate.setAttribute("aria-pressed", candidate.dataset.profileKey === key ? "true" : "false");
  });
  const detail = $(`#${chart}Detail`);
  if (detail) {
    detail.innerHTML = `<span>${esc(item.dataset.profileTitle)}</span><strong>${esc(item.dataset.profileValue)}</strong><p>${esc(item.dataset.profileNote)}</p>`;
  }
  if (chart === "clock") updateClockCenter(item, initial ? "BUSIEST" : "SELECTED");
}

function setProfileHover(item, active) {
  const chart = item.dataset.profileChart;
  const key = item.dataset.profileKey;
  $$(`[data-profile-chart="${chart}"]`).forEach((candidate) => {
    candidate.classList.toggle("is-hovered", active && candidate.dataset.profileKey === key);
    candidate.classList.toggle("is-dimmed", active && candidate.dataset.profileKey !== key);
  });
  if (chart === "clock") {
    if (active) updateClockCenter(item, "HOUR");
    else {
      const selected = $$('[data-profile-chart="clock"].is-selected').find((candidate) => candidate.tabIndex >= 0);
      if (selected) updateClockCenter(selected, "SELECTED");
    }
  }
}

function updateClockCenter(item, label) {
  if (!item || !$("#clockCenterLabel")) return;
  $("#clockCenterLabel").textContent = label;
  $("#clockCenterValue").textContent = item.dataset.profileTitle;
  $("#clockCenterSub").textContent = item.dataset.profileValue;
}

function showProfileTooltip(item, event) {
  const tooltip = $("#profileTooltip");
  tooltip.innerHTML = `<b>${esc(item.dataset.profileTitle)}</b><strong>${esc(item.dataset.profileValue)}</strong><span>${esc(item.dataset.profileNote)}</span>`;
  tooltip.classList.add("show");
  positionProfileTooltip(event);
}

function positionProfileTooltip(event) {
  const tooltip = $("#profileTooltip");
  const rect = tooltip.getBoundingClientRect();
  const sourceRect = event.currentTarget?.getBoundingClientRect?.() || event.target?.getBoundingClientRect?.();
  const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : sourceRect?.left + sourceRect?.width / 2 || 16;
  const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : sourceRect?.top || 16;
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x + 14))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y + 14))}px`;
}

function hideProfileTooltip() {
  $("#profileTooltip").classList.remove("show");
}
