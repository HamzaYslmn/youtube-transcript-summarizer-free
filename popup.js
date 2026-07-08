// ponytail: DEFAULT_SETTINGS duplicated in content.js — 2 lines, not worth a shared module
const DEFAULT_SETTINGS = {
  provider: "ChatGPT",
  prompt: "Summarize this YouTube video transcript. Give key points with timestamps.",
  includeDescription: false,
  tempChat: true,
};

const $ = (sel) => document.querySelector(sel);
const providerBtns = [...document.querySelectorAll("#providers button")];
const activeProvider = () =>
  providerBtns.find((b) => b.classList.contains("active"))?.dataset.provider ?? DEFAULT_SETTINGS.provider;

function render(provider) {
  providerBtns.forEach((b) => b.classList.toggle("active", b.dataset.provider === provider));
  const parts = [];
  if ($("#prompt").value.trim()) parts.push("{prompt}");
  parts.push("Transcript:\n{transcript}");
  if ($("#desc").checked) parts.push("Video Description:\n{video description}");
  $("#preview").textContent = parts.join("\n\n");
}

let flashTimer;
function save() {
  chrome.storage.sync.set({
    provider: activeProvider(),
    prompt: $("#prompt").value,
    includeDescription: $("#desc").checked,
    tempChat: $("#temp").checked,
  });
  $("#saved").style.visibility = "visible";
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("#saved").style.visibility = "hidden"), 1200);
}

chrome.storage.sync.get(DEFAULT_SETTINGS).then((s) => {
  $("#prompt").value = s.prompt;
  $("#desc").checked = s.includeDescription;
  $("#temp").checked = s.tempChat;
  render(s.provider);
});

providerBtns.forEach((b) =>
  b.addEventListener("click", () => {
    render(b.dataset.provider);
    save();
  })
);
for (const id of ["#prompt", "#desc", "#temp"]) {
  $(id).addEventListener("input", () => {
    render(activeProvider());
    save();
  });
}
