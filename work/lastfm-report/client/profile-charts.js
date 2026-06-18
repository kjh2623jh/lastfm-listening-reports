function renderListeningProfile() {
  renderMusicRatio();
  renderFingerprint();
  renderTagMovement();
  renderListeningClock();
}

function renderMusicRatio() {
  const profile = state.report.listeningProfile?.ratio || {};
  const current = profile.current || { tracks: state.report.tracks, albums: state.report.albums || state.report.topAlbums.length, artists: state.report.artists };
  const previous = profile.previous || { tracks: 0, albums: 0, artists: 0 };
  const rows = [
    { key: "tracks", label: "Tracks", color: "#2f80ed", radius: 76 },
    { key: "albums", label: "Albums", color: "#12a594", radius: 56 },
    { key: "artists", label: "Artists", color: "#d51007", radius: 36 }
  ];
  const rings = rows.map((row) => {
    const value = Number(current[row.key] || 0);
    const before = Number(previous[row.key] || 0);
    const delta = value - before;
    const ceiling = Math.max(value, before, 1);
    const circumference = 2 * Math.PI * row.radius;
    const dash = circumference * value / ceiling;
    const markerAngle = before / ceiling * 359 - 90;
    const marker = polarPoint(100, 100, row.radius, markerAngle);
    const note = before ? `Previous ${before.toLocaleString()} · ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} change` : "Previous-period data is unavailable.";
    return `<g class="ratio-ring" ${profileAttrs({ chart: "ratio", key: row.key, title: row.label, value: value.toLocaleString(), note })}><circle class="ratio-track" cx="100" cy="100" r="${row.radius}"></circle><circle class="ratio-progress" cx="100" cy="100" r="${row.radius}" stroke="${row.color}" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"></circle>${before ? `<circle class="ratio-marker" cx="${marker.x}" cy="${marker.y}" r="3.5"></circle>` : ""}</g>`;
  }).join("");
  const detail = rows.map((row) => {
    const value = Number(current[row.key] || 0);
    const before = Number(previous[row.key] || 0);
    const delta = value - before;
    const note = before ? `Previous ${before.toLocaleString()} · ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} change` : "Previous-period data is unavailable.";
    return `<button class="ratio-row" type="button" ${profileAttrs({ chart: "ratio", key: row.key, title: row.label, value: value.toLocaleString(), note })}><i style="background:${row.color}"></i><span>${row.label}</span><strong>${value.toLocaleString()}</strong><small>${before ? `${delta >= 0 ? "+" : ""}${delta.toLocaleString()} vs previous` : "No previous data"}</small></button>`;
  }).join("");
  $("#musicRatio").innerHTML = `<div class="ratio-layout"><svg class="ratio-svg" viewBox="0 0 200 200" role="img" aria-label="Track, album, and artist breadth compared with the previous period">${rings}<circle cx="100" cy="100" r="19" fill="#211c18"></circle><text x="100" y="96" text-anchor="middle" class="ratio-center-label">SCROBBLES</text><text x="100" y="112" text-anchor="middle" class="ratio-center-value">${state.report.total}</text></svg><div class="ratio-detail">${detail}</div></div><div class="profile-detail" id="ratioDetail"></div>`;
  setInitialProfileDetail("ratio", "tracks");
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
  const previousPoints = radarMetricPoints(previous, axes, center, radius);
  const currentPoints = radarMetricPoints(current, axes, center, radius);
  const nodes = axes.map(([label, key], index) => {
    const score = Number(current[key] || 0);
    const before = Number(previous[key] || 0);
    const point = polarPoint(center, center, radius * score / 100, index * 72 - 90);
    return `<circle class="radar-node" cx="${point.x}" cy="${point.y}" r="5" ${profileAttrs({ chart: "fingerprint", key, title: label, value: `${score} / 100`, note: `Previous ${before} · ${fingerprintInfo[key]}` })}></circle>`;
  }).join("");
  $("#listeningFingerprint").innerHTML = `<div class="fingerprint-wrap"><svg class="fingerprint-svg" viewBox="0 0 280 280" role="img" aria-label="Listening behavior fingerprint compared with the previous period">${grid}${spokes}<polygon class="radar-previous" points="${previousPoints}"></polygon><polygon class="radar-current" points="${currentPoints}"></polygon>${nodes}${labels}</svg><div class="profile-legend"><span><i class="legend-current"></i>Current</span><span><i class="legend-previous"></i>Previous</span></div></div><div class="profile-detail" id="fingerprintDetail"></div>`;
  setInitialProfileDetail("fingerprint", "consistency");
}

function renderTagMovement() {
  const timeline = state.report.tagTimeline || [];
  if (!timeline.some((snapshot) => snapshot.tags?.length)) {
    $("#tagMovement").innerHTML = `<p class="profile-empty">Tag data is unavailable for this period.</p>`;
    return;
  }
  $("#tagMovementRange").textContent = `${timeline[0].label} – ${timeline.at(-1).label}`;
  const palette = ["#b77cff", "#4aa3f5", "#5ad0b7", "#24459b", "#8744d4", "#2f8d91", "#5d27b8", "#91d5ff"];
  const totals = new Map();
  timeline.forEach((snapshot) => snapshot.tags.forEach((tag) => totals.set(tag.name, (totals.get(tag.name) || 0) + tag.score)));
  const currentNames = timeline.at(-1).tags.slice(0, 6).map((tag) => tag.name);
  const historicalNames = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const names = [...new Set([...currentNames, ...historicalNames])].slice(0, 8);
  const width = 800;
  const height = 310;
  const center = 142;
  const maxHeight = 196;
  const xFor = (index) => 54 + index * (692 / Math.max(timeline.length - 1, 1));
  const scoreRows = timeline.map((snapshot) => {
    const map = new Map(snapshot.tags.map((tag) => [tag.name, tag.score]));
    return names.map((name) => map.get(name) || 0);
  });
  const maxTotal = Math.max(...scoreRows.map((scores) => scores.reduce((sum, score) => sum + score, 0)), 1);
  const layers = names.map((name, nameIndex) => {
    const top = [];
    const bottom = [];
    timeline.forEach((_, timeIndex) => {
      const scores = scoreRows[timeIndex];
      const total = scores.reduce((sum, score) => sum + score, 0);
      const start = center - total / maxTotal * maxHeight / 2;
      const before = scores.slice(0, nameIndex).reduce((sum, score) => sum + score, 0) / maxTotal * maxHeight;
      const thickness = scores[nameIndex] / maxTotal * maxHeight;
      top.push({ x: xFor(timeIndex), y: start + before });
      bottom.push({ x: xFor(timeIndex), y: start + before + thickness });
    });
    return { name, color: palette[nameIndex % palette.length], top, bottom };
  });
  const bands = layers.map((layer) => {
    const first = scoreRows[0][names.indexOf(layer.name)];
    const latest = scoreRows.at(-1)[names.indexOf(layer.name)];
    const values = scoreRows.map((scores) => scores[names.indexOf(layer.name)]);
    const peak = Math.max(...values);
    const peakIndex = values.indexOf(peak);
    const note = `Peak ${peak} on ${timeline[peakIndex].label} · ${values.filter(Boolean).length}/${timeline.length} active weeks`;
    const attrs = profileAttrs({ chart: "tags", key: layer.name, title: layer.name, value: `${latest} latest score`, note: `First ${first} · ${note}` });
    return `<path class="tag-stream" d="${streamAreaPath(layer.top, layer.bottom)}" fill="${layer.color}" ${attrs}></path>`;
  }).join("");
  const points = layers.flatMap((layer, nameIndex) => timeline.map((snapshot, timeIndex) => {
    const score = scoreRows[timeIndex][nameIndex];
    if (!score) return "";
    const y = (layer.top[timeIndex].y + layer.bottom[timeIndex].y) / 2;
    const attrs = profileAttrs({ chart: "tags", key: layer.name, title: `${layer.name} · ${snapshot.label}`, value: `${score} tag score`, note: `${snapshot.scrobbles.toLocaleString()} scrobbles in this week` });
    return `<circle class="stream-point" cx="${layer.top[timeIndex].x}" cy="${y}" r="8" fill="transparent" ${attrs}></circle>`;
  })).join("");
  const labels = layers.map((layer, nameIndex) => {
    const values = scoreRows.map((scores) => scores[nameIndex]);
    const latestThickness = layer.bottom.at(-1).y - layer.top.at(-1).y;
    const labelIndex = latestThickness >= 13 ? timeline.length - 1 : values.indexOf(Math.max(...values));
    const thickness = layer.bottom[labelIndex].y - layer.top[labelIndex].y;
    if (thickness < 13) return "";
    const x = layer.top[labelIndex].x + (labelIndex === timeline.length - 1 ? -8 : 0);
    const y = (layer.top[labelIndex].y + layer.bottom[labelIndex].y) / 2 + 4;
    const attrs = profileAttrs({ chart: "tags", key: layer.name, title: layer.name, value: `${values.at(-1)} latest score`, note: `Peak ${Math.max(...values)} across ${timeline.length} weeks` });
    return `<text class="stream-label" x="${x}" y="${y}" text-anchor="${labelIndex === timeline.length - 1 ? "end" : "middle"}" ${attrs}>${esc(layer.name)}</text>`;
  }).join("");
  const ticks = timeline.map((snapshot, index) => `<text class="stream-tick" x="${xFor(index)}" y="292" text-anchor="middle">${esc(snapshot.label)}</text>`).join("");
  $("#tagMovement").innerHTML = `<svg class="tag-flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Top tag movement across ${timeline.length} weekly snapshots">${bands}${points}${labels}${ticks}</svg><div class="profile-detail profile-detail-dark" id="tagsDetail"></div>`;
  const currentTop = timeline.at(-1).tags.find((tag) => names.includes(tag.name))?.name || names[0];
  setInitialProfileDetail("tags", currentTop);
}

function streamAreaPath(top, bottom) {
  const upper = top.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const lower = [...bottom].reverse().map((point) => `L ${point.x} ${point.y}`).join(" ");
  return `${upper} ${lower} Z`;
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
