// Split pill in YouTube's Like/Share row (a round action button on Shorts): ✦ sends to the default AI (set in the
// popup), ▾ opens a native popover with one-off sends + copy. Settings come from
// shared/settings.js; the transcript from player.js.

// After an extension reload, old content scripts are orphaned and any chrome.*
// call throws "Extension context invalidated" — check this before chrome APIs.
const alive = () => chrome.runtime?.id != null;

// Transcripts are far too long for URL prefill (~12KB cap → 414s), so the
// prompt travels via storage: chat/fill.js types it in when it sees #yt2ai.
// Temp chat: URL param on ChatGPT/Claude; on Gemini fill.js clicks it.
const AI_URLS = {
  Claude:  (temp) => `https://claude.ai/new${temp ? "?incognito=" : ""}#yt2ai`,
  ChatGPT: (temp) => `https://chatgpt.com/${temp ? "?temporary-chat=true" : ""}#yt2ai`,
  Gemini:  () => "https://gemini.google.com/app#yt2ai",
};

// ---- transcript (asks player.js, which runs in the page's MAIN world) ----

let reqId = 0;
function fromPlayer(peek = false) {
  const id = ++reqId;
  return new Promise((resolve) => {
    const done = (v) => { removeEventListener("message", on); resolve(v); };
    const on = (ev) => ev.source === window && ev.data?.type === "yt2ai:res" && ev.data.id === id && done(ev.data);
    addEventListener("message", on);
    setTimeout(() => done({}), 12000); // worst case: every fallback in player.js
    postMessage({ type: "yt2ai:req", id, peek });
  });
}

async function getVideo(timestamps = true) {
  const slow = setTimeout(() => toast("Getting transcript…"), 400); // prefetch usually beats this
  const v = await fromPlayer();
  clearTimeout(slow);
  if (!v.lines?.length) {
    toast(v.ad ? "The transcript is available once the ad ends."
      : v.lines ? "This video has no transcript."
      : "Couldn't load the transcript — try again in a moment.");
    return null;
  }
  const transcript = v.lines.map(([ts, t]) => (timestamps ? `${ts} ${t}` : t)).join("\n");
  return { title: v.title, description: v.description, transcript };
}

// ---- actions ----

let toastTimer;
function toast(msg) {
  let t = document.getElementById("yt2ai-toast");
  if (!t) {
    t = Object.assign(document.createElement("div"), { id: "yt2ai-toast", role: "status" });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

// One action at a time; the ✦ turns into a spinner meanwhile.
let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  const bar = document.getElementById("yt2ai");
  bar?.setAttribute("aria-busy", "true");
  try { await fn(); }
  catch (e) { toast("Something went wrong: " + e.message); }
  finally { busy = false; bar?.removeAttribute("aria-busy"); }
}

async function copy(timestamps) {
  const v = await getVideo(timestamps);
  if (!v) return;
  await navigator.clipboard.writeText(v.transcript);
  toast(`Transcript copied (${v.transcript.split("\n").length} lines).`);
}

// provider: one-off override from the menu — the popup's default is never changed
async function send(provider = S.provider) {
  if (!alive()) return toast("Extension was updated — refresh the page (F5).");
  const t0 = Date.now();
  const v = await getVideo();
  if (!v) return;
  // Chrome blocks window.open ~5s after the click; slow fallbacks need a 2nd (cached, instant) click
  if (Date.now() - t0 > 4500) return toast("Transcript ready — click again to send.");
  const prompt = buildPrompt(S, v);
  await navigator.clipboard.writeText(prompt).catch(() => {}); // fallback if the fill fails
  await chrome.storage.local.set({ yt2ai: { prompt, temp: S.tempChat, ts: Date.now() } });
  window.open((AI_URLS[provider] ?? AI_URLS.ChatGPT)(S.tempChat), "_blank");
  toast(`Opening ${provider}${S.tempChat ? " (temporary chat)" : ""}. Prompt is also on your clipboard.`);
}

// ---- UI ----

const SPARKLE =
  '<svg class="yt2ai-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<defs><linearGradient id="yt2ai-grad" x1="0" y1="1" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#3d8bff"/><stop offset=".55" stop-color="#a855f7"/>' +
  '<stop offset="1" stop-color="#d946ef"/></linearGradient></defs>' +
  '<path fill="url(#yt2ai-grad)" d="M10 5Q10 14 19 14Q10 14 10 23Q10 14 1 14Q10 14 10 5Z"/>' +
  '<path fill="url(#yt2ai-grad)" d="M18.5 1Q18.5 5.5 23 5.5Q18.5 5.5 18.5 10Q18.5 5.5 14 5.5Q18.5 5.5 18.5 1Z"/></svg>';
const COPY = '<svg class="yt2ai-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z"/></svg>';

const SPINNER = '<svg class="yt2ai-icon yt2ai-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40 100"/></svg>';
const CHEVRON = '<svg class="yt2ai-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7 10 5 5 5-5z"/></svg>';

function buildBar() {
  const bar = document.createElement("div");
  bar.id = "yt2ai";
  bar.innerHTML =
    `<button class="yt2ai-send">${SPARKLE}${SPINNER}<span></span></button>` +
    `<button class="yt2ai-more" popovertarget="yt2ai-menu" aria-label="More AI options"><b>AI</b>${CHEVRON}</button>` +
    `<div id="yt2ai-menu" popover role="menu">` +
    PROVIDERS.map((p) => `<button role="menuitem" data-provider="${p}">${SPARKLE}${p}<small>Default</small></button>`).join("") +
    `<hr>` +
    `<button role="menuitem" data-copy="ts">${COPY}Copy transcript</button>` +
    `<button role="menuitem" data-copy="">${COPY}Copy without timestamps</button></div>`;
  const menu = bar.querySelector("#yt2ai-menu");

  bar.querySelector(".yt2ai-send").addEventListener("click", () => run(send));
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    menu.hidePopover();
    run(b.dataset.provider ? () => send(b.dataset.provider) : () => copy(!!b.dataset.copy));
  });

  // Warm the transcript while the pointer heads for a click (~130ms → instant).
  const prefetch = () => alive() && fromPlayer();
  bar.addEventListener("pointerenter", prefetch);
  bar.addEventListener("focusin", prefetch);

  // Keyboard: opens on the default AI (Enter sends), ↑/↓ move. stopPropagation
  // keeps YouTube's shortcuts (arrows seek/volume) quiet while the menu is open.
  menu.addEventListener("toggle", (e) => e.newState === "open" && menu.querySelector(".is-default").focus());
  menu.addEventListener("keydown", (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...menu.querySelectorAll("button")];
    items.at((items.indexOf(document.activeElement) + step) % items.length).focus();
  });

  views.add(() => {
    bar.querySelector(".yt2ai-send span").textContent = S.provider;
    bar.querySelector(".yt2ai-send").title = `Send transcript to ${S.provider}`;
    menu.querySelectorAll("[data-provider]").forEach((b) => b.classList.toggle("is-default", b.dataset.provider === S.provider));
  });
  refresh();
  return bar;
}

// Where the bar goes: first item of the Like/Share row (ytd-menu-renderer) on
// /watch and /live, top of the right-hand action column on Shorts. YouTube keeps
// foreign children there across SPA navigation; we re-check on every navigation.
function findSlot() {
  if (location.pathname.startsWith("/shorts/")) {
    // the one Shorts player moves into the active reel — its action bar is ours
    const row = document.querySelector("#shorts-player")?.closest("ytd-reel-video-renderer")?.querySelector("reel-action-bar-view-model");
    return row && { row, layout: "shorts" };
  }
  const row = document.querySelector("ytd-watch-metadata ytd-menu-renderer");
  return row && { row, layout: "watch" };
}

async function ensureBar() {
  let slot;
  for (let i = 0; i < 40 && !(slot = findSlot()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!slot || slot.row.firstElementChild?.id === "yt2ai") return;
  const bar = document.getElementById("yt2ai") ?? buildBar();
  bar.dataset.layout = slot.layout;
  slot.row.prepend(bar);
  // same height as the Like pill (36px, or 40px on newer layouts)
  const h = slot.layout === "watch" && slot.row.querySelector("#top-level-buttons-computed button")?.offsetHeight;
  if (h) bar.style.setProperty("--yt2ai-h", h + "px");
}

// No caption tracks at all → hide the whole pill: every action needs a transcript.
// Unknown (player still loading this video, or an ad) → keep it, retry ~10s, then show.
async function hideIfNoCaptions() {
  const href = location.href;
  for (let i = 0; i < 20; i++) {
    const { has } = await fromPlayer(true);
    const bar = document.getElementById("yt2ai");
    if (location.href !== href || !bar) return; // navigated away; that page runs its own check
    if (has != null || i === 19) return (bar.hidden = has === false);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const onPage = () => alive() && /^\/(watch|shorts\/|live\/)/.test(location.pathname) && settingsReady.then(ensureBar).then(hideIfNoCaptions);
addEventListener("yt-navigate-finish", onPage);
onPage();
