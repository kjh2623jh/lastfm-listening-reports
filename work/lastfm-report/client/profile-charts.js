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
  const rows = [["tracks", "곡"], ["albums", "앨범"], ["artists", "아티스트"]];
  $("#musicRatio").innerHTML = `<table class="breadth-table"><thead><tr><th scope="col">고유 항목</th><th scope="col">현재</th><th scope="col">직전</th><th scope="col">증감</th></tr></thead><tbody>${rows.map(([key, label]) => {
    const value = current[key];
    const before = previous?.[key];
    return `<tr><th scope="row">${label}</th><td><strong>${value?.toLocaleString() ?? "—"}</strong></td><td>${before?.toLocaleString() ?? "—"}</td><td>${value == null || before == null ? "—" : signed(value - before)}</td></tr>`;
  }).join("")}</tbody></table>${available && previous ? "" : '<p class="profile-empty">직전 기간의 기록이 없어요.</p>'}`;
}

function renderFingerprint() {
  const fingerprint = state.report.listeningProfile?.fingerprint || {};
  const current = fingerprint.current || { consistency: 0, discovery: 0, variety: 0, concentration: 0, replay: 0 };
  const previous = fingerprint.previous || { consistency: 0, discovery: 0, variety: 0, concentration: 0, replay: 0 };
  const axes = [
    ["꾸준함", "consistency"],
    ["한 번 듣기", "discovery"],
    ["다양성", "variety"],
    ["집중도", "concentration"],
    ["반복 재생", "replay"]
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
    return `<circle class="radar-node" cx="${point.x}" cy="${point.y}" r="5" ${profileAttrs({ chart: "fingerprint", key, title: label, value: `${score} / 100`, note: previousAvailable ? `직전 ${before} · ${fingerprintInfo[key]}` : fingerprintInfo[key] })}></circle>`;
  }).join("");
  $("#listeningFingerprint").innerHTML = `<div class="fingerprint-wrap"><svg class="fingerprint-svg" viewBox="0 0 280 280" role="img" aria-label="직전 기간과 비교한 청취 성향">${grid}${spokes}${previousAvailable ? `<polygon class="radar-previous" points="${previousPoints}"></polygon>` : ""}<polygon class="radar-current" points="${currentPoints}"></polygon>${nodes}${labels}</svg><div class="profile-legend"><span><i class="legend-current"></i>현재</span>${previousAvailable ? '<span><i class="legend-previous"></i>직전</span>' : ""}</div></div><div class="profile-detail" id="fingerprintDetail"></div>`;
  setInitialProfileDetail("fingerprint", "consistency");
}

function renderTagMovement() {
  const report = state.report;
  const timeline = report.tagTimeline || [];
  const monthOnly = report.kind !== "weekly";
  const dateLabel = (slot) => formatListeningDate(slot.startDate, monthOnly);
  const fullLabel = (slot) => `${slot.startDate.slice(0, 4)}년 ${dateLabel(slot)}`;
  const percent = (value) => value == null ? "—" : `${value.toFixed(1)}%`;
  const scores = timeline.map((slot) => new Map(slot.scrobbles > 0
    ? (slot.tags || []).filter((tag) => tag.score > 0 && tag.score <= slot.scrobbles)
      .map((tag) => [tag.name, 100 * tag.score / slot.scrobbles])
    : []));
  const weights = new Map();
  for (const row of scores) {
    for (const [name, value] of row) weights.set(name, (weights.get(name) || 0) + value);
  }
  const current = scores.at(-1);
  const previous = scores.at(-2);
  const leaders = (row) => [...(row?.keys() || [])].slice(0, 3);
  const historical = [...weights.keys()].sort((a, b) => weights.get(b) - weights.get(a) || a.localeCompare(b));
  const names = [...new Set([...leaders(current), ...leaders(previous), ...historical])].slice(0, 8);
  $("#tagMovementRange").textContent = timeline.length ? `${fullLabel(timeline[0])} – ${fullLabel(timeline.at(-1))}` : "";
  if (!names.length) {
    $("#tagMovement").innerHTML = '<p class="profile-empty">이 기간에 표시할 태그 기록이 없어요.</p>';
    return;
  }

  const palette = ["#ae80ff", "#428bf5", "#3dcfba", "#e17cb8", "#6a65e1", "#328ca6", "#daa864", "#9ec6f8"];
  const width = timeline.length > 6 ? 820 : 600;
  const step = (width - 68) / Math.max(timeline.length - 1, 1);
  const xAt = (index) => 34 + step * index;
  const totals = scores.map((row) => names.reduce((total, name) => total + (row.get(name) || 0), 0));
  const scale = 142 / Math.max(...totals, 1);
  const edges = totals.map((total) => 86 - total * scale / 2);
  const pair = report.kind === "yearly"
    ? { previous: dateLabel(timeline.at(-2)), current: dateLabel(timeline.at(-1)) }
    : periodComparisonLabels(report.kind);
  const layers = names.map((name, index) => {
    const points = scores.map((row, periodIndex) => {
      const value = row.get(name);
      if (value == null) return null;
      const top = edges[periodIndex];
      edges[periodIndex] += value * scale;
      return { x: xAt(periodIndex), top, bottom: edges[periodIndex] };
    });
    const before = previous?.get(name);
    const after = current.get(name);
    const delta = before == null || after == null ? null : Math.round((after - before) * 10) / 10;
    const value = `${percent(before)} → ${percent(after)}`;
    const note = delta == null ? "두 기간에 모두 기록된 태그의 증감을 표시해요." : `${pair.previous}보다 ${signed(delta)}%p`;
    const attrs = profileAttrs({ chart: "tags", key: name, title: name, value, note });
    const label = esc(`${name}, ${pair.previous} ${percent(before)}, ${pair.current} ${percent(after)}`);
    return { name, color: palette[index], points, attrs, label, before, after, delta };
  });

  const bands = layers.map(({ points, color, attrs, label }) =>
    `<path class="tag-stream" fill="${color}" d="${streamBandPath(points, step)}" ${attrs} aria-label="${label}"></path>`).join("");
  const labels = layers.map(({ name, points }) => {
    const last = points.at(-1);
    const thickness = (point) => point ? point.bottom - point.top : 0;
    const spot = thickness(last) >= 18 ? last
      : points.reduce((best, point) => thickness(point) > thickness(best) ? point : best, null);
    if (!spot || thickness(spot) < 18) return "";
    const end = spot.x >= width / 2;
    return `<text class="stream-band-name" x="${spot.x + (end ? -8 : 8)}" y="${(spot.top + spot.bottom) / 2 + 4}" text-anchor="${end ? "end" : "start"}" aria-hidden="true">${esc(name)}</text>`;
  }).join("");
  const ticks = timeline.map((slot, index) => {
    const emphasis = index >= timeline.length - 2;
    const missing = scores[index].size === 0;
    return `<g class="stream-date${emphasis ? " stream-recent" : ""}"><line x1="${xAt(index)}" x2="${xAt(index)}" y1="10" y2="162"></line><text class="stream-tick" x="${xAt(index)}" y="183" text-anchor="middle">${esc(dateLabel(slot))}</text>${missing ? `<text class="stream-missing" x="${xAt(index)}" y="86" text-anchor="middle">—</text>` : ""}</g>`;
  }).join("");
  const rows = layers.map(({ name, color, attrs, label, before, after, delta }) =>
    `<button type="button" class="tag-compare-row" ${attrs} aria-label="${label}"><span><i style="background:${color}"></i>${esc(name)}</span><span>${percent(before)}</span><strong>${percent(after)}</strong><small>${delta == null ? "—" : `${signed(delta)}%p`}</small></button>`).join("");
  $("#tagMovement").innerHTML = `<p class="tag-method">태그별 흐름 · 띠가 두꺼울수록 재생 100회당 태그 점수가 높아요.</p><svg class="tag-flow-svg" viewBox="0 0 ${width} 192" role="group" aria-label="기간별 태그 흐름">${bands}${ticks}${labels}</svg><div class="tag-compare"><div class="tag-compare-head"><span>태그</span><span>${pair.previous}</span><strong>${pair.current}</strong><span>증감</span></div>${rows}</div><p class="tag-method tag-gap-note">— 표시는 태그가 집계되지 않았거나 상위 태그에 들지 않은 경우예요.</p>`;
}

function streamBandPath(points, step) {
  const paths = [];
  let section = [];
  for (let index = 0; index <= points.length; index += 1) {
    const point = points[index];
    if (point) {
      if (!section.length && (index > 0 || !points[1])) section.push(streamTip(point, -step / (index === 0 ? 4 : 2)));
      section.push(point);
    } else if (section.length) {
      if (index < points.length || !points[index - 2]) {
        section.push(streamTip(section.at(-1), step / (index === points.length ? 4 : 2)));
      }
      const upper = section.map(({ x, top }) => ({ x, y: top }));
      const lower = section.reverse().map(({ x, bottom }) => ({ x, y: bottom }));
      paths.push(`M ${upper[0].x} ${upper[0].y}${streamCurve(upper)} L ${lower[0].x} ${lower[0].y}${streamCurve(lower)} Z`);
      section = [];
    }
  }
  return paths.join(" ");
}

function streamTip(point, offset) {
  const middle = (point.top + point.bottom) / 2;
  return { x: point.x + offset, top: middle, bottom: middle };
}

function streamCurve(points) {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const middle = (previous.x + point.x) / 2;
    return ` C ${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
  }).join("");
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
    const attrs = profileAttrs({ chart: "clock", key: String(hour), title: time, value: `${count.toLocaleString()}회`, note: `${time}-${String(hour).padStart(2, "0")}:59 KST` });
    return `<g class="clock-segment"><path class="clock-hit" d="${donutSectorPath(130, 130, 54, 116, start, end)}" fill="transparent" ${attrs}></path><path class="clock-base" d="${donutSectorPath(130, 130, 55, 114, start, end)}"></path>${count ? `<path class="clock-value-segment" d="${donutSectorPath(130, 130, 55, valueRadius, start, end)}"></path>` : ""}</g>`;
  }).join("");
  $("#listeningClock").innerHTML = `<div class="clock-layout"><svg class="clock-svg" viewBox="0 0 260 260" role="img" aria-label="한국 시간 기준 시간대별 재생">${segments}<circle class="clock-core" cx="130" cy="130" r="53"></circle><text class="clock-axis" x="130" y="96" text-anchor="middle">00</text><text class="clock-axis" x="165" y="134" text-anchor="middle">06</text><text class="clock-axis" x="130" y="171" text-anchor="middle">12</text><text class="clock-axis" x="94" y="134" text-anchor="middle">18</text></svg><div><div class="clock-stats"><strong>${String(busiest).padStart(2, "0")}:00</strong><span>가장 많이 들은 시간</span><strong>${max.toLocaleString()}</strong><span>이 시간의 재생 횟수</span><strong>${Math.round(timeBandTotal(hours, 21, 5) / Math.max(state.report.total, 1) * 100)}%</strong><span>야간 재생 비율 · 21:00-04:59</span></div><div class="profile-detail profile-detail-dark" id="clockDetail"></div></div></div>`;
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
  if (chart === "clock") updateClockCenter(item, initial ? "최다 재생" : "선택한 시간");
}

function setProfileHover(item, active) {
  const chart = item.dataset.profileChart;
  const key = item.dataset.profileKey;
  $$(`[data-profile-chart="${chart}"]`).forEach((candidate) => {
    candidate.classList.toggle("is-hovered", active && candidate.dataset.profileKey === key);
    candidate.classList.toggle("is-dimmed", active && candidate.dataset.profileKey !== key);
  });
  if (chart === "clock") {
    if (active) updateClockCenter(item, "시간대");
    else {
      const selected = $$('[data-profile-chart="clock"].is-selected').find((candidate) => candidate.tabIndex >= 0);
      if (selected) updateClockCenter(selected, "선택한 시간");
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
