// Settings state + message format, shared by the popup and the YouTube content script.

const DEFAULT_SETTINGS = {
  provider: "ChatGPT",
  prompt: "Summarize this YouTube video transcript. Give key points with timestamps.",
  includeDescription: false,
  tempChat: true,
};
const PROVIDERS = ["Claude", "ChatGPT", "Gemini"];

// Live settings. Views register a render fn in `views`; any change (here, or
// from the popup/another tab via storage) re-renders them.
const S = { ...DEFAULT_SETTINGS };
const views = new Set();
const refresh = () => views.forEach((f) => f());
const settingsReady = chrome.storage.sync.get(DEFAULT_SETTINGS).then((s) => { Object.assign(S, s); refresh(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "sync") return;
  for (const k in ch) S[k] = ch[k].newValue;
  refresh();
});

// Message layout. Empty prompt / disabled description drop their section.
function buildPrompt(s, { title, transcript, description }) {
  const parts = [];
  if (s.prompt.trim()) parts.push(s.prompt.trim());
  if (title) parts.push("Title: " + title);
  parts.push("Transcript:\n" + transcript);
  if (s.includeDescription && description) parts.push("Video Description:\n" + description);
  return parts.join("\n\n");
}
