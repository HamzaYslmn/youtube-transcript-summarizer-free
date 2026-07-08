// Runs on chatgpt.com / claude.ai / gemini.google.com. When the tab was opened
// by us (#yt2ai hash), type the prompt from storage into the editor — URLs
// can't carry a full transcript (~12KB cap). On Gemini (no temp-chat URL
// param) it also clicks the temporary-chat button first.

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

function findTempToggle() {
  const els = document.querySelectorAll('button, [role="button"], [role="menuitem"]');
  return [...els].find((el) => {
    const label = ((el.getAttribute("aria-label") ?? "") + " " + el.textContent).toLowerCase();
    return !label.includes("learn more") && TEMP_WORDS.some((w) => label.includes(w));
  });
}

async function run() {
  if (location.hash !== MARKER) return;
  const { yt2ai } = await chrome.storage.local.get("yt2ai");
  if (!yt2ai?.prompt || Date.now() - yt2ai.ts > 60_000) return; // stale — ignore
  chrome.storage.local.remove("yt2ai");

  // ChatGPT/Claude are already in temp mode via URL param — hunting for a
  // "temporary" button there would toggle it back OFF. Gemini only, and only
  // when the user left temp chat enabled.
  if (yt2ai.temp && location.host.includes("gemini")) {
    // short wait only — the prompt fill must not sit behind a long toggle hunt
    const toggle = await waitFor(findTempToggle, 3_000);
    if (toggle) {
      toggle.click();
      await sleep(500); // let the editor re-mount after mode switch
    }
  }

  const editor = await waitFor(() => document.querySelector("div[contenteditable='true']"), 10_000);
  if (!editor) return; // prompt is still on the clipboard as fallback
  editor.focus();
  document.execCommand("insertText", false, yt2ai.prompt);
  // ponytail: no auto-submit — user reviews and hits Enter
}

run();
