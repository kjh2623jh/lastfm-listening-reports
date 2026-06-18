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
