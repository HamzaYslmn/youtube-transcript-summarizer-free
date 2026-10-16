// Settings popup. State + buildPrompt come from shared/settings.js.
const $ = (sel) => document.querySelector(sel);
const prompt = $("#prompt");

// sync storage allows ~120 writes/min, so typing is debounced. Writes the whole
// object, so a pending prompt edit is never dropped by a later click.
let saveTimer;
function save(patch, delay = 0) {
  Object.assign(S, patch);
  refresh();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set(S), delay);
}

$("#providers").innerHTML = PROVIDERS.map((p) => `<button role="radio" data-provider="${p}">${p}</button>`).join("");
$("#providers").addEventListener("click", (e) => {
  const p = e.target.closest("[data-provider]")?.dataset.provider;
  if (p) save({ provider: p });
});
// ←/→ cycles the provider (radio-group keyboard pattern)
$("#providers").addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!step) return;
  const p = PROVIDERS[(PROVIDERS.indexOf(S.provider) + step + PROVIDERS.length) % PROVIDERS.length];
  save({ provider: p });
  $(`[data-provider="${p}"]`).focus();
});
prompt.addEventListener("input", () => save({ prompt: prompt.value }, 400));
document.addEventListener("change", (e) => e.target.dataset.key && save({ [e.target.dataset.key]: e.target.checked }));
addEventListener("pagehide", () => chrome.storage.sync.set(S)); // popup closed mid-debounce

views.add(() => {
  document.querySelectorAll("[data-provider]").forEach((b) => {
    const on = b.dataset.provider === S.provider;
    b.setAttribute("aria-checked", on);
    b.tabIndex = on ? 0 : -1; // radio group: one tab stop
  });
  document.querySelectorAll("[data-key]").forEach((c) => (c.checked = !!S[c.dataset.key]));
  if (document.activeElement !== prompt) prompt.value = S.prompt;
  $("#preview").textContent = buildPrompt(
    { ...S, prompt: S.prompt.trim() ? "{prompt}" : "" },
    { title: "{title}", transcript: "{transcript}", description: "{video description}" }
  );
});
refresh();

// Version + update check. Unpacked extensions can't update themselves (Chrome won't
// let them rewrite their own files), so a newer GitHub version gets a download link.
const current = chrome.runtime.getManifest().version;
$("#version").textContent = `v${current}`;
fetch("https://raw.githubusercontent.com/HamzaYslmn/youtube-transcript-summarizer-free/main/manifest.json")
  .then((r) => r.json())
  .then(({ version }) => {
    const cmp = version.localeCompare(current, undefined, { numeric: true });
    if (cmp < 0) return ($("#version").textContent += ` · ahead of GitHub (v${version})`); // local dev build
    if (cmp === 0) return ($("#version").textContent += " · up to date");
    $("#version").replaceChildren(Object.assign(document.createElement("a"), {
      id: "update", target: "_blank", textContent: `Update to v${version} ↓`,
      href: "https://github.com/HamzaYslmn/youtube-transcript-summarizer-free/archive/refs/heads/main.zip",
      title: "Extract over your extension folder, then press reload on chrome://extensions",
    }));
  })
  .catch(() => {}); // offline: just the version
