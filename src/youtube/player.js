// Runs in the page's MAIN world (needs the player API). Answers content.js with
// the transcript via window.postMessage. Sources, fastest first — each one only
// runs if the previous found nothing:
//   1. the player's own caption request (pot-signed), toggling captions if off
//   2. InnerTube /player as the ANDROID / IOS app (no pot needed; works during ads)
//   3. the transcript panel: open, read, close (same as Firefox's extractor)
// Works on /watch, /live/… and /shorts/…

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Caption URLs only work with the player's proof-of-origin token (pot=), so we
// watch the player's own timedtext requests. PerformanceObserver keeps seeing
// them even after YouTube fills the 250-entry resource-timing buffer.
const capUrls = new Map(); // videoId → latest timedtext URL (with pot)
const waiters = new Map(); // videoId → resolve, for viaPlayer()
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (!e.name.includes("/api/timedtext") || !e.name.includes("pot=")) continue;
    const v = new URL(e.name).searchParams.get("v");
    if (!v) continue;
    capUrls.set(v, e.name);
    waiters.get(v)?.(e.name);
  }
}).observe({ type: "resource", buffered: true });

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// json3 caption file → [[time, text]]. Empty body = YouTube rejected the token.
async function fetchJson3(url, init) {
  const u = new URL(url, location.origin);
  u.searchParams.set("fmt", "json3");
  const body = await (await fetch(u, init)).text();
  if (!body) return null;
  return (JSON.parse(body).events ?? [])
    .filter((e) => e.segs)
    .map((e) => [fmtTime(e.tStartMs), e.segs.map((s) => s.utf8).join("").replace(/\s+/g, " ").trim()])
    .filter(([, t]) => t);
}

// The track YouTube itself would pick (video language, manual over auto).
const defaultTrack = (r) => r?.captionTracks?.[r.audioTracks?.[0]?.defaultCaptionTrackIndex ?? 0] ?? r?.captionTracks?.[0];

// 1. Switch the default track on just long enough for the player to request it
//    (~125ms measured), then restore the user's caption state.
async function viaPlayer(player, videoId) {
  if (!capUrls.has(videoId)) {
    const track = defaultTrack(player.getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer);
    if (!track) return null;
    const prev = player.getOption("captions", "track") ?? {};
    const got = new Promise((r) => { waiters.set(videoId, r); setTimeout(r, 3000); });
    document.documentElement.classList.add("yt2ai-hide-cc"); // no subtitle flash
    try {
      player.loadModule("captions");
      player.setOption("captions", "track", { languageCode: track.languageCode });
      await got; // resolved by the observer the moment the request lands
    } finally {
      waiters.delete(videoId);
      player.setOption("captions", "track", prev.languageCode ? prev : {});
      document.documentElement.classList.remove("yt2ai-hide-cc");
    }
  }
  const url = capUrls.get(videoId);
  // the player just downloaded this exact json3 — force-cache: 3ms vs 200ms refetch (measured)
  return url ? fetchJson3(url, { cache: "force-cache" }) : null;
}

// 2. App clients still get caption URLs that work without pot (~400ms measured).
// ponytail: hardcoded app versions — bump them if YouTube starts rejecting these
const CLIENTS = [
  { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
  { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
];
async function viaInnertube(videoId) {
  for (const client of CLIENTS) {
    try {
      const res = await fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: { client: { ...client, hl: document.documentElement.lang || "en" } }, videoId }),
      });
      const json = await res.json();
      const track = defaultTrack(json.captions?.playerCaptionsTracklistRenderer);
      const lines = track && (await fetchJson3(track.baseUrl, { credentials: "omit" }));
      if (lines?.length) return { lines, details: json.videoDetails };
    } catch {} // next client
  }
  return null;
}

// 3. Last resort: the transcript panel. Segment selectors cover the new
//    "In this video" panel and the legacy one; we close it again if we opened it.
// ponytail: an already-open panel is trusted to belong to the current video
const SEG = "transcript-segment-view-model, ytd-transcript-segment-renderer";
async function viaPanel() {
  let seg = document.querySelector(SEG);
  const opener = !seg && document.querySelector(
    'ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"]');
  if (opener) {
    const x = scrollX, y = scrollY;
    opener.click();
    for (let i = 0; i < 40 && !(seg = document.querySelector(SEG)); i++) await sleep(100);
    scrollTo(x, y); // opening the panel scrolls the page
  }
  if (!seg) return null;
  const panel = seg.closest("ytd-engagement-panel-section-list-renderer") ?? document;
  const lines = [...panel.querySelectorAll(SEG)].map((s) => [
    s.querySelector(".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp")?.textContent.trim() ?? "",
    s.querySelector('span[role="text"], .segment-text')?.textContent.replace(/\s+/g, " ").trim() ?? "",
  ]).filter(([, t]) => t);
  if (opener) panel.querySelector("#visibility-button button")?.click();
  return lines;
}

const urlVideoId = () =>
  new URLSearchParams(location.search).get("v") ?? location.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1];

async function load(videoId) {
  // the player showing this video (#movie_player on /watch, #shorts-player on Shorts)
  const player = [...document.querySelectorAll(".html5-video-player")].find((p) => p.getVideoData?.().video_id === videoId);
  const pr = player?.getPlayerResponse?.();
  let details = pr?.videoDetails;
  const meta = () => ({ title: details?.title ?? document.title.replace(/ - YouTube$/, ""), description: details?.shortDescription ?? "" });
  if (pr && !pr.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return { ...meta(), lines: [] }; // no captions at all

  // The player doesn't load captions during an ad, so skip straight to source 2.
  const ad = player?.classList.contains("ad-showing");
  let lines = player && !ad ? await viaPlayer(player, videoId).catch(() => null) : null;
  if (!lines?.length) {
    const r = await viaInnertube(videoId);
    if (r) { lines = r.lines; details ??= r.details; }
  }
  if (!lines?.length && !location.pathname.startsWith("/shorts")) lines = await viaPanel().catch(() => null);
  return { ...meta(), ad, lines: lines?.length ? lines : null };
}

const cache = new Map(); // videoId → Promise<result>, successes only
addEventListener("message", async (ev) => {
  if (ev.source !== window || ev.data?.type !== "yt2ai:req") return;
  const videoId = urlVideoId();
  let res;
  try {
    if (!videoId) throw new Error("no video on this page");
    if (!cache.has(videoId)) cache.set(videoId, load(videoId));
    res = await cache.get(videoId);
    if (!res.lines?.length) cache.delete(videoId); // retry next click
  } catch (e) {
    cache.delete(videoId);
    res = { error: String(e) };
  }
  postMessage({ type: "yt2ai:res", id: ev.data.id, ...res });
});
