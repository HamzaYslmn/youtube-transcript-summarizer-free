// Runs on claude.ai / gemini.google.com. Neither has a temp-chat URL param,
// so when the tab was opened by us (#yt2ai hash), click the incognito /
// temporary-chat toggle, then type the prompt from storage into the editor.

const MARKER = "#yt2ai";
// ponytail: EN + TR labels only — add words if your UI language differs
const TEMP_WORDS = ["incognito", "temporary", "geçici", "private chat"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}

// Claude's ghost toggle is not a labeled <button> — match switch/checkbox roles
// and data-testid/title too, and skip it if it's already switched on.
function findTempToggle() {
  const els = document.querySelectorAll(
    'button, a, [role="button"], [role="switch"], [role="checkbox"], [role="menuitemcheckbox"]'
  );
  return [...els].find((el) => {
    // attributes only + short text — Claude's button embeds a <style> tag whose
    // CSS pollutes textContent, so long text must not disqualify the element
    const attrs = [el.getAttribute("aria-label"), el.getAttribute("data-testid"), el.getAttribute("title")]
      .filter(Boolean)
      .join(" ");
    const text = el.textContent.length <= 60 ? el.textContent : "";
    const label = (attrs + " " + text).toLowerCase();
    if (label.includes("learn more")) return false;
    const alreadyOn =
      el.getAttribute("aria-pressed") === "true" ||
      el.getAttribute("aria-checked") === "true" ||
      ["checked", "on"].includes(el.getAttribute("data-state"));
    return !alreadyOn && TEMP_WORDS.some((w) => label.includes(w));
  });
}

async function run() {
  if (location.hash !== MARKER) return;
  const { yt2ai } = await chrome.storage.local.get("yt2ai");
  if (!yt2ai?.prompt || Date.now() - yt2ai.ts > 60_000) return; // stale — ignore
  chrome.storage.local.remove("yt2ai");

  // short wait only — the prompt fill must not sit behind a long toggle hunt
  const toggle = await waitFor(findTempToggle, 3_000);
  if (toggle) {
    toggle.click();
    await sleep(500); // let the editor re-mount after mode switch
  }

  const editor = await waitFor(() => document.querySelector("div[contenteditable='true']"), 10_000);
  if (!editor) return; // prompt is still on the clipboard as fallback
  editor.focus();
  document.execCommand("insertText", false, yt2ai.prompt);
  // ponytail: no auto-submit — user reviews and hits Enter
}

run();
