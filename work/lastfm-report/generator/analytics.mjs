const TZ = "Asia/Seoul";

export function group(tracks, keyFn, seedFn) {
  const map = new Map();
  for (const track of tracks) {
    const key = keyFn(track);
    if (!key) continue;
    const current = map.get(key) || { key, count: 0, ...seedFn(track) };
    current.count += 1;
    if (!current.image) current.image = cover(track);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function artist(track) {
  return track.artist?.name || track.artist?.["#text"] || "Unknown Artist";
}

export function album(track) {
  return track.album?.["#text"] || "";
}

export function cover(track) {
  return [...array(track.image)].reverse().find((img) => img["#text"])?.["#text"] || "";
}

export function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function buildDays(kind, tracks) {
  const formatter = kind === "yearly"
    ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short" })
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "2-digit", day: "2-digit" });
  const map = new Map();
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const order = kind === "yearly"
      ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date)
      : new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const label = formatter.format(date);
    const current = map.get(order) || { label, short: label.split(",")[0], count: 0, order };
    current.count += 1;
    map.set(order, current);
  }
  return [...map.values()].sort((a, b) => a.order.localeCompare(b.order));
}

export function buildHours(tracks) {
  const hours = new Array(24).fill(0);
  for (const track of tracks) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(Number(track.date.uts) * 1000)));
    hours[hour] += 1;
  }
  return hours;
}

export function buildListeningProfile(kind, range, previousRange, tracks, previousTracks, topArtists, previousTopArtists) {
  return {
    ratio: {
      current: musicRatio(tracks),
      previous: musicRatio(previousTracks)
    },
    fingerprint: {
      current: fingerprintMetrics(kind, range, tracks, topArtists),
      previous: fingerprintMetrics(kind, previousRange, previousTracks, previousTopArtists)
    }
  };
}

function musicRatio(tracks) {
  return {
    tracks: new Set(tracks.map((track) => `${artist(track)} -- ${track.name}`)).size,
    albums: new Set(tracks.map((track) => album(track)).filter(Boolean)).size,
    artists: new Set(tracks.map((track) => artist(track))).size
  };
}

function fingerprintMetrics(kind, range, tracks, topArtists) {
  if (!tracks.length) {
    return { consistency: 0, discovery: 0, variety: 0, concentration: 0, replay: 0 };
  }

  const trackCounts = group(tracks, (track) => `${artist(track)} -- ${track.name}`, () => ({}));
  const uniqueTracks = trackCounts.length;
  const uniqueArtists = new Set(tracks.map((track) => artist(track))).size;
  const onePlayTracks = trackCounts.filter((track) => track.count === 1).length;
  const topFiveShare = topArtists.slice(0, 5).reduce((sum, item) => sum + item.count, 0) / tracks.length;
  const periodCounts = completePeriodCounts(kind, range, tracks);
  const mean = periodCounts.reduce((sum, count) => sum + count, 0) / Math.max(periodCounts.length, 1);
  const variance = periodCounts.reduce((sum, count) => sum + ((count - mean) ** 2), 0) / Math.max(periodCounts.length, 1);
  const coefficient = mean ? Math.sqrt(variance) / mean : 1;

  return {
    consistency: clampScore(100 - coefficient * 45),
    discovery: clampScore(onePlayTracks / Math.max(uniqueTracks, 1) * 100),
    variety: clampScore(uniqueArtists / Math.max(uniqueTracks, 1) * 160),
    concentration: clampScore(topFiveShare * 100),
    replay: clampScore((tracks.length - uniqueTracks) / tracks.length * 100)
  };
}

function completePeriodCounts(kind, range, tracks) {
  const size = kind === "weekly" ? 7 : kind === "monthly" ? Number(range.endDate.slice(-2)) : 12;
  const counts = new Array(size).fill(0);
  const weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const index = kind === "yearly"
      ? Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(date)) - 1
      : kind === "monthly"
        ? Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(date)) - 1
        : weekdayIndex[new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date)];
    if (index >= 0 && index < counts.length) counts[index] += 1;
  }
  return counts;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}


function bucketByWeek(tracks) {
  const buckets = new Map();
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(date));
    const week = Math.ceil(day / 7);
    const label = `Week ${week}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [1, 2, 3, 4, 5].map((week) => ({ label: `Week ${week}`, count: buckets.get(`Week ${week}`) || 0 }));
}

function bucketByQuarter(tracks) {
  const buckets = new Map([["Q1", 0], ["Q2", 0], ["Q3", 0], ["Q4", 0]]);
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(date));
    const label = `Q${Math.ceil(month / 3)}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count }));
}

export function buildPeriodFocus(kind, { days, hours, tracks, topArtists, topAlbums }) {
  if (kind === "weekly") {
    const weekdayTotal = days.slice(0, 5).reduce((sum, day) => sum + day.count, 0);
    const weekendTotal = days.slice(5).reduce((sum, day) => sum + day.count, 0);
    const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
    return {
      title: "Weekly Rhythm",
      cards: [
        { label: "Weekday / Weekend", value: `${weekdayTotal} / ${weekendTotal}`, note: "평일과 주말 청취량의 무게 차이입니다." },
        { label: "Late-night", value: String(lateNight), note: "00:00-04:59 KST scrobbles입니다." },
        { label: "Most active day", value: days.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 }).label, note: "이번 주 청취가 가장 몰린 날입니다." }
      ]
    };
  }
  if (kind === "monthly") {
    const weeks = bucketByWeek(tracks);
    const bestWeek = weeks.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
    return {
      title: "Monthly Arc",
      cards: [
        { label: "Busiest week", value: bestWeek.label, note: `${bestWeek.count} scrobbles로 가장 강한 주간입니다.` },
        { label: "Active weeks", value: `${weeks.filter((week) => week.count > 0).length}/${weeks.length}`, note: "한 달 안에서 실제로 scrobble이 발생한 주 수입니다." },
        { label: "Album anchor", value: topAlbums[0]?.album || "-", note: "월간 흐름을 잡아준 중심 album입니다." }
      ]
    };
  }
  const quarters = bucketByQuarter(tracks);
  const bestQuarter = quarters.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  return {
    title: "Yearly Seasons",
    cards: [
      { label: "Peak quarter", value: bestQuarter.label, note: `${bestQuarter.count} scrobbles로 가장 강한 분기입니다.` },
      { label: "Artist spread", value: String(topArtists.length), note: "연간 상위권에 남은 artist 수입니다." },
      { label: "Album of the year", value: topAlbums[0]?.album || "-", note: "연간 반복의 중심 album입니다." }
    ]
  };
}

export function buildDeepDive(kind, context) {
  if (kind === "weekly") return { title: "Weekly Snapshot", sections: [] };
  return kind === "monthly" ? buildMonthlyDeepDive(context) : buildYearlyDeepDive(context);
}

function buildMonthlyDeepDive({ hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison }) {
  const weeks = bucketByWeek(tracks);
  const bestWeek = weeks.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  const quietWeek = weeks.filter((week) => week.count > 0).reduce((a, b) => a.count < b.count ? a : b, bestWeek);
  const firstHalf = splitByDay(tracks, (day) => day <= 15);
  const secondHalf = tracks.length - firstHalf;
  const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
  const repeatTracks = topTracks.filter((track) => track.count >= 3).length;
  const onePlayTracks = countTrackRepeats(tracks, 1);
  const topFiveArtistShare = share(topArtists.slice(0, 5).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const topFiveAlbumShare = share(topAlbums.slice(0, 5).reduce((sum, item) => sum + item.count, 0), tracks.length);
  return {
    title: "Monthly Deep Dive",
    sections: [
      {
        title: "Month Structure",
        note: "한 달 안에서 청취량이 어느 주차에 몰렸는지 보는 구간입니다.",
        items: weeks.map((week) => ({ label: week.label, value: `${week.count} scrobbles`, note: week.label === bestWeek.label ? "이번 달의 peak week입니다." : "월간 흐름을 구성한 주차입니다." }))
      },
      {
        title: "Momentum",
        note: "월초와 월말의 청취 무게가 어떻게 달라졌는지 봅니다.",
        items: [
          { label: "First half", value: `${firstHalf} scrobbles`, note: "1일부터 15일까지의 청취량입니다." },
          { label: "Second half", value: `${secondHalf} scrobbles`, note: "16일부터 월말까지의 청취량입니다." },
          { label: "Quietest active week", value: quietWeek.label, note: `${quietWeek.count} scrobbles로 가장 낮은 active week입니다.` },
          { label: "Month-over-month", value: comparison.percentText, note: comparison.summary }
        ]
      },
      {
        title: "Depth vs Breadth",
        note: "반복해서 판 음악과 넓게 훑은 음악의 균형입니다.",
        items: [
          { label: "Unique tracks", value: uniqueTracks.toLocaleString(), note: "서로 다른 track 수입니다." },
          { label: "Unique artists", value: uniqueArtists.toLocaleString(), note: "서로 다른 artist 수입니다." },
          { label: "Top artist share", value: `${concentration}%`, note: "1위 artist가 전체 scrobbles에서 차지한 비중입니다." },
          { label: "Top 5 artists", value: topFiveArtistShare, note: "상위 5 artists의 집중도입니다." },
          { label: "Top 5 albums", value: topFiveAlbumShare, note: "상위 5 albums의 집중도입니다." },
          { label: "One-play tracks", value: onePlayTracks.toLocaleString(), note: "한 번만 들은 tracks입니다." }
        ]
      },
      {
        title: "Rotation Signals",
        note: "이번 달 반복 청취의 중심축입니다.",
        items: [
          { label: "Repeat tracks", value: String(repeatTracks), note: "3회 이상 반복된 tracks 수입니다." },
          { label: "Main track", value: topTracks[0]?.title || "-", note: topTracks[0] ? `${topTracks[0].artist}, ${topTracks[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Main artist", value: topArtists[0]?.artist || "-", note: topArtists[0] ? `${topArtists[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Main album", value: topAlbums[0]?.album || "-", note: topAlbums[0] ? `${topAlbums[0].artist}, ${topAlbums[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Late-night weight", value: share(lateNight, tracks.length), note: "00:00-04:59 KST 청취 비중입니다." }
        ]
      }
    ]
  };
}

function buildYearlyDeepDive({ hours, tracks, topTracks, topArtists, topAlbums, uniqueTracks, uniqueArtists, concentration, comparison }) {
  const months = bucketByMonth(tracks);
  const quarters = bucketByQuarter(tracks);
  const bestMonth = months.reduce((a, b) => a.count > b.count ? a : b, { label: "-", count: 0 });
  const activeMonths = months.filter((month) => month.count > 0).length;
  const lateNight = hours.slice(0, 5).reduce((sum, count) => sum + count, 0);
  const topTenArtistShare = share(topArtists.slice(0, 10).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const topTenAlbumShare = share(topAlbums.slice(0, 10).reduce((sum, item) => sum + item.count, 0), tracks.length);
  const repeatTracks = topTracks.filter((track) => track.count >= 5).length;
  const onePlayTracks = countTrackRepeats(tracks, 1);
  return {
    title: "Yearly Deep Dive",
    sections: [
      {
        title: "Year Timeline",
        note: "연간 청취가 어느 달에 몰렸는지 한눈에 보는 구간입니다.",
        items: months.map((month) => ({ label: month.label, value: `${month.count} scrobbles`, note: month.label === bestMonth.label ? "올해의 peak month입니다." : "연간 흐름을 구성한 월입니다." }))
      },
      {
        title: "Seasonal Shape",
        note: "월보다 큰 단위에서 취향과 사용량의 계절성을 봅니다.",
        items: quarters.map((quarter) => ({ label: quarter.label, value: `${quarter.count} scrobbles`, note: "해당 분기의 총 scrobbles입니다." }))
      },
      {
        title: "Annual Scale",
        note: "연간 리포트에서만 의미가 커지는 규모 지표입니다.",
        items: [
          { label: "Active months", value: `${activeMonths}/12`, note: "실제로 scrobble이 기록된 월 수입니다." },
          { label: "Unique tracks", value: uniqueTracks.toLocaleString(), note: "올해 들은 서로 다른 tracks입니다." },
          { label: "Unique artists", value: uniqueArtists.toLocaleString(), note: "올해 들은 서로 다른 artists입니다." },
          { label: "Year-over-year", value: comparison.percentText, note: comparison.summary }
        ]
      },
      {
        title: "Long-term Taste",
        note: "1년 단위로 봤을 때 취향이 얼마나 집중되었는지 봅니다.",
        items: [
          { label: "Top artist share", value: `${concentration}%`, note: "1위 artist의 연간 비중입니다." },
          { label: "Top 10 artists", value: topTenArtistShare, note: "상위 10 artists가 차지한 비중입니다." },
          { label: "Top 10 albums", value: topTenAlbumShare, note: "상위 10 albums가 차지한 비중입니다." },
          { label: "Repeat tracks", value: String(repeatTracks), note: "5회 이상 반복된 tracks 수입니다." },
          { label: "One-play tracks", value: onePlayTracks.toLocaleString(), note: "한 번만 들은 tracks입니다." },
          { label: "Late-night weight", value: share(lateNight, tracks.length), note: "00:00-04:59 KST 청취 비중입니다." }
        ]
      },
      {
        title: "Year Anchors",
        note: "올해 리포트의 중심으로 남은 이름들입니다.",
        items: [
          { label: "Artist of the year", value: topArtists[0]?.artist || "-", note: topArtists[0] ? `${topArtists[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Album of the year", value: topAlbums[0]?.album || "-", note: topAlbums[0] ? `${topAlbums[0].artist}, ${topAlbums[0].count} scrobbles` : "데이터가 부족합니다." },
          { label: "Track of the year", value: topTracks[0]?.title || "-", note: topTracks[0] ? `${topTracks[0].artist}, ${topTracks[0].count} scrobbles` : "데이터가 부족합니다." }
        ]
      }
    ]
  };
}

function bucketByMonth(tracks) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const buckets = labels.map((label, index) => ({ label, count: 0, month: index + 1 }));
  for (const track of tracks) {
    const date = new Date(Number(track.date.uts) * 1000);
    const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(date));
    if (buckets[month - 1]) buckets[month - 1].count += 1;
  }
  return buckets;
}

function splitByDay(tracks, predicate) {
  return tracks.filter((track) => {
    const date = new Date(Number(track.date.uts) * 1000);
    const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(date));
    return predicate(day);
  }).length;
}

function countTrackRepeats(tracks, exactCount) {
  const counts = group(tracks, (track) => `${artist(track)} -- ${track.name}`, (track) => ({ artist: artist(track), title: track.name }));
  return counts.filter((track) => track.count === exactCount).length;
}

function share(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

export function headline(topArtist, topAlbum, kind) {
  const label = kind === "weekly" ? "week" : kind === "monthly" ? "month" : "year";
  return `${topArtist.artist} ${label}, ${topAlbum.album} gravity.`;
}
