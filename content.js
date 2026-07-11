// YouTube Transcript to AI — auto-opens the transcript panel, adds Copy + AI buttons in it.

// ponytail: DEFAULT_SETTINGS duplicated in popup.js — 2 lines, not worth a shared module
const DEFAULT_SETTINGS = {
  provider: "ChatGPT",
  prompt: "Summarize this YouTube video transcript. Give key points with timestamps.",
  includeDescription: false,
  tempChat: true,
};

// Gemini-style sparkle: big 4-point star + small one, blue→purple gradient
const SPARKLE_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex:none">' +
  '<defs><linearGradient id="yt2ai-grad" x1="0" y1="1" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#3d8bff"/><stop offset=".55" stop-color="#a855f7"/>' +
  '<stop offset="1" stop-color="#d946ef"/></linearGradient></defs>' +
  '<path fill="url(#yt2ai-grad)" d="M10 5 Q10 14 19 14 Q10 14 10 23 Q10 14 1 14 Q10 14 10 5 Z"/>' +
  '<path fill="url(#yt2ai-grad)" d="M18.5 1 Q18.5 5.5 23 5.5 Q18.5 5.5 18.5 10 Q18.5 5.5 14 5.5 Q18.5 5.5 18.5 1 Z"/>' +
  "</svg>";

// After an extension reload, old content scripts are orphaned and any chrome.*
// call throws "Extension context invalidated" — check this before chrome APIs.
const alive = () => chrome.runtime?.id != null;

// Transcripts are far too long for URL prefill (~12KB cap → 414s), so the
// prompt always travels via storage: ai-inject.js types it into the editor
// when it sees the #yt2ai marker. Temp chat (on by default, popup setting)
// comes via URL param on ChatGPT/Claude; on Gemini ai-inject.js clicks the temp button.
const AI_TARGETS = {
  Claude:  (temp) => `https://claude.ai/new${temp ? "?incognito=" : ""}#yt2ai`,
  ChatGPT: (temp) => `https://chatgpt.com/${temp ? "?temporary-chat=true" : ""}#yt2ai`,
  Gemini:  () => "https://gemini.google.com/app#yt2ai",
};

// The transcript can sit in any engagement panel: the new combined "In this video"
// panel carries target-id=null, older ones use fixed ids (PAmodern_transcript_view,
// engagement-panel-searchable-transcript). Match them ALL and pick by content below —
// keying off a hardcoded target-id missed the null panel on some locales/layouts.
const MODERN = "PAmodern_transcript_view";
const PANEL_SEL = "ytd-engagement-panel-section-list-renderer";
const EXPANDED = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";

const SEGMENT_SEL = "transcript-segment-view-model, ytd-transcript-segment-renderer";

function getPanel() {
  const all = [...document.querySelectorAll(PANEL_SEL)];
  return (
    // chaptered videos populate the legacy panel while an empty modern panel
    // also sits in the DOM — prefer whichever panel actually has segments.
    // No all[0] fallback now that PANEL_SEL matches every panel (comments, ads…):
    // before segments load, only drive the modern panel for the open step.
    all.find((p) => p.querySelector(SEGMENT_SEL)) ??
    all.find((p) => p.getAttribute("target-id") === MODERN) ??
    null
  );
}

function getTranscriptText() {
  const rows = getPanel()?.querySelectorAll(SEGMENT_SEL) ?? [];
  return [...rows]
    .map((s) => {
      const ts =
        s.querySelector(".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp")
          ?.textContent.trim() ?? "";
      const text =
        s.querySelector('span[role="text"], .segment-text, yt-formatted-string')
          ?.textContent.trim() ?? "";
      return `${ts} ${text}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;bottom:24px;right:16px;z-index:9999;" +
    "background:#212121;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;" +
    "font-family:Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)";
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

// Collapsed description only renders the truncated "…more" snippet — click
// expand to make YouTube render the full text, read it, then collapse again.
function getDescription() {
  const el = document.querySelector("#description-inline-expander");
  if (!el) return "";
  const strip = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("tp-yt-paper-button, button, #expand, #collapse").forEach((b) => b.remove());
    return clone.textContent.trim();
  };
  const expandBtn = el.querySelector("#expand");
  const wasCollapsed = expandBtn && expandBtn.offsetParent !== null; // visible = collapsed
  if (wasCollapsed) expandBtn.click();
  // read #expanded only — the hidden snippet would duplicate the first lines
  const text = strip(el.querySelector("#expanded") ?? el);
  if (wasCollapsed) el.querySelector("#collapse")?.click();
  return text;
}

// Format: {prompt}\n\nTranscript:\n{transcript}\n\nVideo Description:\n{description}
// Empty prompt / disabled description just drop their section.
function buildPrompt(s, transcript) {
  const parts = [];
  if (s.prompt.trim()) parts.push(s.prompt.trim());
  parts.push("Transcript:\n" + transcript);
  if (s.includeDescription) {
    const desc = getDescription();
    if (desc) parts.push("Video Description:\n" + desc);
  }
  return parts.join("\n\n");
}

async function copyTranscript() {
  const text = getTranscriptText();
  if (!text) return toast("Transcript not loaded yet — wait a second and retry.");
  await navigator.clipboard.writeText(text);
  toast("Transcript copied (with timestamps).");
}

async function sendToAI() {
  if (!alive()) return toast("Extension was updated — refresh the page (F5).");
  const transcript = getTranscriptText(); // build once — reused in the prompt
  if (!transcript) return toast("Transcript not loaded yet — wait a second and retry.");
  const s = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const prompt = buildPrompt(s, transcript);
  await navigator.clipboard.writeText(prompt); // always: fallback if the fill fails
  await chrome.storage.local.set({ yt2ai: { prompt, temp: s.tempChat, ts: Date.now() } });
  window.open((AI_TARGETS[s.provider] ?? AI_TARGETS.ChatGPT)(s.tempChat), "_blank");
  toast(`Opening ${s.provider}${s.tempChat ? " (temp chat)" : ""} — prompt copied, paste (Ctrl+V) if the chat is empty.`);
}

function makeButton(label, title, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.style.cssText =
    "padding:7px 14px;border:none;border-radius:18px;cursor:pointer;" +
    "background:var(--yt-spec-badge-chip-background,#272727);" +
    "color:var(--yt-spec-text-primary,#f1f1f1);" +
    "font-family:Roboto,Arial,sans-serif;font-size:13px;font-weight:500;white-space:nowrap";
  b.addEventListener("click", onClick);
  return b;
}

// Insert the button row at the TOP of #content — a sibling above #content
// overlaps it on legacy (chaptered) panels, and YouTube's header flexbox
// clips/hides foreign children.
function ensureBar(panel) {
  if (!alive() || panel.querySelector(".yt2ai-bar")) return;
  const content = panel.querySelector("#content");
  if (!content) return;

  const bar = document.createElement("div");
  bar.className = "yt2ai-bar";
  bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;padding:8px 16px";

  bar.append(makeButton("📋 Copy", "Copy transcript with timestamps", copyTranscript));

  const aiBtn = makeButton("", "Send transcript to AI (settings: extension icon)", sendToAI);
  aiBtn.style.display = "flex";
  aiBtn.style.alignItems = "center";
  aiBtn.style.gap = "6px";
  // unique gradient id — the bar can exist in two panels (one hidden), and a
  // duplicate id makes url(#...) resolve to the hidden copy → invisible icon
  aiBtn.innerHTML = SPARKLE_SVG.replaceAll("yt2ai-grad", "yt2ai-grad-" + Math.random().toString(36).slice(2));
  const aiLabel = document.createElement("span");
  aiLabel.textContent = "AI";
  aiBtn.append(aiLabel);
  chrome.storage.sync.get(DEFAULT_SETTINGS).then((s) => (aiLabel.textContent = s.provider));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "sync" && ch.provider) aiLabel.textContent = ch.provider.newValue;
  });
  bar.append(aiBtn);

  content.prepend(bar);
}

// Flipping the panel's visibility attribute shows it but never triggers the data
// fetch (infinite spinner). Only the real "Show transcript" click loads segments —
// so click it, then undo the scroll jump the click causes.
function clickShowTranscript() {
  const btn = document.querySelector(
    'ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"]'
  );
  if (!btn) return false;
  // Opening the panel scrolls the page; pin the scroll position back for ~1s
  // (covers YouTube's async focus/scroll) then let go.
  const x = scrollX, y = scrollY;
  const pin = () => scrollTo(x, y);
  addEventListener("scroll", pin, true);
  btn.click();
  setTimeout(() => removeEventListener("scroll", pin, true), 1000);
  return true;
}

function activate() {
  if (!location.pathname.startsWith("/watch")) return;
  let tries = 0;
  let opened = false;
  const timer = setInterval(() => {
    // stop when orphaned by an extension reload, or after ~15s (no transcript)
    if (!alive() || ++tries > 30) return clearInterval(timer);

    const panel = getPanel();
    if (!panel) return;

    ensureBar(panel);
    // cheap existence check — building the full transcript here would walk
    // every segment (thousands of nodes on long videos) twice a second
    if (panel.querySelector(SEGMENT_SEL)) return clearInterval(timer);
    if (!opened) opened = clickShowTranscript();
    // ponytail: last resort when no description button exists — panel opens but may spin
    if (!opened && tries > 6 && panel.getAttribute("visibility") !== EXPANDED)
      panel.setAttribute("visibility", EXPANDED);
  }, 500);
}

window.addEventListener("yt-navigate-finish", activate);
activate();
