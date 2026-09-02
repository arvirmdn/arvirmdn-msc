const API_BASE = ""; // sameorigin; ganti misal "https://api-musikmu.up.railway.app" kalau backend beda domain

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const resultList = document.getElementById("resultList");
const historyList = document.getElementById("historyList");

const audio = document.getElementById("audioPlayer");
const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const seekBar = document.getElementById("seekBar");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");
const volumeBar = document.getElementById("volumeBar");

const playerThumb = document.getElementById("playerThumb");
const playerTitle = document.getElementById("playerTitle");
const playerArtist = document.getElementById("playerArtist");

const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

let currentQueue = [];
let currentIndex = -1;
let searchTimer = null;
let history = JSON.parse(localStorage.getItem("musikin_history") || "[]");

// ---------- Navigasi tab ----------
navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    navItems.forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    const target = item.dataset.view;
    views.forEach((v) => v.classList.remove("active"));
    document.getElementById(target + "View").classList.add("active");
    if (target === "library") renderHistory();
  });
});

// ---------- Pencarian otomatis (debounce) ke YouTube ----------
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    resultList.innerHTML = "";
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = "Mengetik...";
  searchTimer = setTimeout(() => doSearch(q), 500);
});

searchBtn.addEventListener("click", () => {
  const q = searchInput.value.trim();
  if (q) doSearch(q);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  }
});

async function doSearch(query) {
  statusEl.textContent = "Mencari di YouTube...";
  resultList.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Gagal mencari");
    const data = await res.json();
    currentQueue = data.results;
    if (!currentQueue.length) {
      statusEl.textContent = "Tidak ada hasil.";
      return;
    }
    statusEl.textContent = `${currentQueue.length} hasil untuk "${query}"`;
    renderResults(currentQueue);
  } catch (err) {
    statusEl.textContent = "Terjadi kesalahan saat mencari. Coba lagi.";
    console.error(err);
  }
}

function renderResults(tracks) {
  resultList.innerHTML = "";
  tracks.forEach((track, idx) => {
    resultList.appendChild(buildTrackItem(track, idx));
  });
}

function buildTrackItem(track, idx) {
  const li = document.createElement("li");
  li.className = "track-item";
  li.dataset.id = track.id;
  li.innerHTML = `
    <img class="track-thumb" src="${track.thumbnail || ""}" alt="">
    <div class="track-info">
      <div class="track-title">${escapeHtml(track.title)}</div>
      <div class="track-artist">${escapeHtml(track.artist || "")}</div>
    </div>
    <div class="track-duration">${formatDuration(track.duration)}</div>
  `;
  li.addEventListener("click", () => playTrack(idx, currentQueue));
  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- Player ----------
function playTrack(index, queue) {
  currentQueue = queue;
  currentIndex = index;
  const track = currentQueue[index];
  if (!track) return;

  audio.src = `${API_BASE}/api/stream/${track.id}`;
  audio.play().catch((e) => console.error("Gagal memutar:", e));

  playerThumb.src = track.thumbnail || "";
  playerTitle.textContent = track.title;
  playerArtist.textContent = track.artist || "";
  playBtn.textContent = "⏸";

  highlightPlaying(track.id);
  addToHistory(track);
}

function highlightPlaying(id) {
  document.querySelectorAll(".track-item").forEach((el) => {
    el.classList.toggle("playing", el.dataset.id === id);
  });
}

function addToHistory(track) {
  history = history.filter((t) => t.id !== track.id);
  history.unshift(track);
  history = history.slice(0, 50);
  localStorage.setItem("musikin_history", JSON.stringify(history));
}

function renderHistory() {
  historyList.innerHTML = "";
  if (!history.length) {
    historyList.innerHTML = '<div class="status">Belum ada lagu yang diputar.</div>';
    return;
  }
  history.forEach((track, idx) => {
    const li = buildTrackItem(track, idx);
    li.addEventListener("click", () => playTrack(idx, history));
    historyList.appendChild(li);
  });
}

playBtn.addEventListener("click", () => {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
    playBtn.textContent = "⏸";
  } else {
    audio.pause();
    playBtn.textContent = "▶";
  }
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playTrack(currentIndex - 1, currentQueue);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < currentQueue.length - 1) playTrack(currentIndex + 1, currentQueue);
});

audio.addEventListener("ended", () => {
  if (currentIndex < currentQueue.length - 1) {
    playTrack(currentIndex + 1, currentQueue);
  } else {
    playBtn.textContent = "▶";
  }
});

audio.addEventListener("timeupdate", () => {
  if (!isNaN(audio.duration)) {
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    curTimeEl.textContent = formatDuration(audio.currentTime);
    durTimeEl.textContent = formatDuration(audio.duration);
  }
});

seekBar.addEventListener("input", () => {
  if (!isNaN(audio.duration)) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
  }
});

volumeBar.addEventListener("input", () => {
  audio.volume = volumeBar.value / 100;
});
audio.volume = 0.8;
