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

$("#profilePanel").addEventListener("pointerover", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (!item) return;
  const previous = event.relatedTarget?.closest?.("[data-profile-item]");
  if (previous?.dataset.profileChart === item.dataset.profileChart && previous?.dataset.profileKey === item.dataset.profileKey) return;
  setProfileHover(item, true);
  showProfileTooltip(item, event);
});

$("#profilePanel").addEventListener("pointermove", (event) => {
  if (event.target.closest("[data-profile-item]")) positionProfileTooltip(event);
});

$("#profilePanel").addEventListener("pointerout", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (!item) return;
  const next = event.relatedTarget?.closest?.("[data-profile-item]");
  if (next?.dataset.profileChart === item.dataset.profileChart && next?.dataset.profileKey === item.dataset.profileKey) return;
  setProfileHover(item, false);
  hideProfileTooltip();
});

$("#profilePanel").addEventListener("click", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (item) selectProfileItem(item);
});

$("#profilePanel").addEventListener("keydown", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (!item || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  selectProfileItem(item);
});

$("#profilePanel").addEventListener("focusin", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (!item) return;
  setProfileHover(item, true);
  showProfileTooltip(item, { target: item });
});

$("#profilePanel").addEventListener("focusout", (event) => {
  const item = event.target.closest("[data-profile-item]");
  if (!item) return;
  setProfileHover(item, false);
  hideProfileTooltip();
});

render();
refreshRegistry();
