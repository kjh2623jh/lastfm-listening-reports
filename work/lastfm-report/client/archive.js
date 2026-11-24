const query = new URLSearchParams(location.search);
const buttons = [...document.querySelectorAll(".archive-tabs button")];
const entries = [...document.querySelectorAll("#archiveList li")];
const year = document.querySelector("#archiveYear");
const month = document.querySelector("#archiveMonth");
const monthFilter = document.querySelector("#monthFilter");
const results = document.querySelector("#archiveResults");
const current = entries.find((entry) => entry.dataset.file === query.get("current"));
const monthFormat = new Intl.DateTimeFormat("ko-KR", {month: "long", timeZone: "UTC"});
let period = buttons.find((button) => button.dataset.period === query.get("period"))?.dataset.period || "weekly";

if (current) current.firstElementChild.setAttribute("aria-current", "page");

function setOptions(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  if (options.some(([value]) => value === selected)) select.value = selected;
}

function renderArchive(preferredYear, preferredMonth) {
  const reports = entries.filter((entry) => entry.dataset.period === period);
  const years = [...new Set(reports.flatMap(({dataset}) => [dataset.end.slice(0, 4), dataset.start.slice(0, 4)]))].sort().reverse();
  setOptions(year, [["", "전체 연도"], ...years.map((value) => [value, `${value}년`])], preferredYear);
  monthFilter.hidden = period === "yearly";
  setOptions(month, [["", "전체 월"], ...Array.from({length: 12}, (_, index) => [
    String(index + 1).padStart(2, "0"), monthFormat.format(Date.UTC(2000, index, 1))
  ])], monthFilter.hidden ? "" : preferredMonth);
  buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === period)));

  let count = 0;
  for (const entry of entries) {
    const matches = [entry.dataset.start, entry.dataset.end].some((date) =>
      (!year.value || date.startsWith(year.value)) && (!month.value || date.slice(5, 7) === month.value));
    entry.hidden = entry.dataset.period !== period || !matches;
    if (!entry.hidden) count += 1;
  }
  results.textContent = count ? `리포트 ${count}편` : "선택한 기간에 리포트가 없어요.";
}

function updateFilters(preferredYear, preferredMonth) {
  renderArchive(preferredYear, preferredMonth);
  query.set("period", period);
  for (const [name, value] of [["year", year.value], ["month", month.value]]) {
    if (value) query.set(name, value);
    else query.delete(name);
  }
  history.replaceState(null, "", `?${query}`);
}

buttons.forEach((button) => button.addEventListener("click", () => {
  period = button.dataset.period;
  updateFilters(year.value, "");
}));
year.addEventListener("change", () => updateFilters(year.value, month.value));
month.addEventListener("change", () => updateFilters(year.value, month.value));
renderArchive(query.get("year"), query.get("month"));
