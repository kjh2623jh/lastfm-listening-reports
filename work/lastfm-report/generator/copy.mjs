export function fallbackCopy({ kind, topArtist, topAlbum, peak, total, uniqueTracks, uniqueArtists, concentration, comparison, topArtists, topAlbums }) {
  const periodLabel = kind === "weekly" ? "이번 주" : kind === "monthly" ? "지난달" : "작년";
  return {
    summary: `${topArtist.artist}가 ${topArtist.count} scrobbles로 중심을 잡았고, ${topAlbum.album}이 album focus를 만들었습니다. 전체 ${total.toLocaleString()} scrobbles 중 top artist 비중은 ${concentration}%입니다.`,
    story: `${periodLabel}에는 ${total.toLocaleString()} scrobbles 안에서 ${uniqueTracks.toLocaleString()} tracks, ${uniqueArtists.toLocaleString()} artists가 움직였습니다. ${peak.label}에 listening pace가 가장 높았고, 전체적으로는 ${topArtist.artist}와 ${topAlbum.album} 쪽으로 집중된 흐름입니다.`,
    insights: [
      ["Main Character", `${topArtist.artist}가 리포트의 중심입니다. ${topArtist.count} scrobbles, 전체의 ${concentration}%를 차지했습니다.`],
      ["Album Gravity", `${topAlbum.album}은 ${topAlbum.count} scrobbles로 이번 기간의 album 단위 집중을 만들었습니다.`],
      ["Listening Shape", `${total.toLocaleString()} scrobbles / ${uniqueTracks.toLocaleString()} tracks. 넓게 탐색하기보다 좋아하는 축을 깊게 반복한 패턴입니다.`],
      ["Compared", comparison.previousTotal ? `직전 같은 기간보다 ${comparison.delta >= 0 ? "+" : ""}${comparison.delta.toLocaleString()} scrobbles (${comparison.percentText}) 변했습니다.` : "직전 같은 기간 데이터가 부족해서 비교 해석은 제한적입니다."]
    ],
    recommendation: deterministicRecommendation(topArtists, topAlbums)
  };
}

function deterministicRecommendation(topArtists, topAlbums) {
  const names = topArtists.slice(0, 5).map((item) => item.artist).join(", ");
  if (/Magdalena Bay/i.test(names)) {
    return {
      title: "Jane Remover - Census Designated",
      about: "Shoegaze, glitchy indie rock, noisy pop이 겹치는 2023 album입니다.",
      why: "Magdalena Bay의 선명한 pop 구조를 좋아한다면, 더 흐릿하고 거친 texture 쪽으로 확장하기 좋은 추천입니다."
    };
  }
  if (/Boards of Canada/i.test(names)) {
    return {
      title: "Broadcast - Tender Buttons",
      about: "Minimal synth-pop과 lo-fi electronic texture가 중심인 album입니다.",
      why: "Boards of Canada의 아날로그한 질감에서 노래 중심의 방향으로 확장하기 좋습니다."
    };
  }
  const album = topAlbums[0];
  return {
    title: album ? `${album.artist} - ${album.album}` : "A focused deep dive from your top artists",
    about: "이번 기간의 중심 취향에서 크게 벗어나지 않는 안전한 확장선입니다.",
    why: "이미 반복해서 들은 축을 한 번 더 깊게 확인하는 방향의 추천입니다."
  };
}

export function mergeCopy(fallback, aiCopy) {
  if (!aiCopy) return fallback;
  return {
    summary: cleanText(aiCopy.summary, fallback.summary),
    story: cleanText(aiCopy.story, fallback.story),
    insights: normalizeInsights(aiCopy.insights, fallback.insights),
    recommendation: {
      title: cleanText(aiCopy.recommendation?.title, fallback.recommendation.title),
      about: cleanText(aiCopy.recommendation?.about, fallback.recommendation.about),
      why: cleanText(aiCopy.recommendation?.why, fallback.recommendation.why)
    }
  };
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 900) : fallback;
}

function normalizeInsights(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => Array.isArray(item) ? item : [item?.title, item?.body])
    .filter(([title, body]) => title && body)
    .slice(0, 4)
    .map(([title, body]) => [cleanText(title, "Insight"), cleanText(body, "")]);
  return rows.length >= 3 ? rows : fallback;
}

export async function generateAiCopy(payload, { apiKey, model, apiUrl }) {
  if (!apiKey) return null;
  const compact = {
    period: payload.kind,
    range: payload.range.label,
    totalScrobbles: payload.total,
    uniqueTracks: payload.uniqueTracks,
    uniqueArtists: payload.uniqueArtists,
    topArtistSharePercent: payload.concentration,
    peak: payload.peak,
    periodFocus: payload.periodFocus,
    deepDive: payload.deepDive,
    topTracks: payload.topTracks.slice(0, 10).map(({ artist, title, album, count }) => ({ artist, title, album, count })),
    topArtists: payload.topArtists.slice(0, 10).map(({ artist, count }) => ({ artist, count })),
    topAlbums: payload.topAlbums.slice(0, 10).map(({ artist, album, count }) => ({ artist, album, count })),
    comparison: payload.comparison
  };
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model,
      input: [
        {
          role: "system",
          content: "You write concise, high-signal music listening reports. Use natural Korean, but keep music terms, album titles, genres, and UI terms in English when that sounds better. Do not force awkward Korean. Return only valid JSON."
        },
        {
          role: "user",
          content: `Create report copy from this Last.fm listening data. Do not invent scrobble counts. Recommend one specific album or track that is not merely the top item, and explain why it fits. If the period is monthly or yearly, write with more analytical depth than a weekly report because the page has extended deep-dive sections. JSON shape: {"summary":string,"story":string,"insights":[{"title":string,"body":string}],"recommendation":{"title":string,"about":string,"why":string}}.\n\nDATA:\n${JSON.stringify(compact)}`
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI API HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = extractResponseText(json);
  if (!text) throw new Error("OpenAI response did not contain text");
  return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
}

function extractResponseText(json) {
  if (json.output_text) return json.output_text;
  return asArray(json.output)
    .flatMap((item) => asArray(item.content))
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
