const API_BASE = ""; // sameorigin; ganti kalau backend beda domain dari frontend

const searchInput = document.getElementById("searchInput");
const statusRow = document.getElementById("statusRow");
const resultList = document.getElementById("resultList");
const historyList = document.getElementById("historyList");
const emptyState = document.getElementById("emptyState");

const audio = document.getElementById("audioPlayer");

// Mini player
const miniPlayer = document.getElementById("miniPlayer");
const miniThumb = document.getElementById("miniThumb");
const miniTitle = document.getElementById("miniTitle");
const miniArtist = document.getElementById("miniArtist");
const miniPlayPause = document.getElementById("miniPlayPause");
const miniPlayIcon = document.getElementById("miniPlayIcon");
const miniPauseIcon = document.getElementById("miniPauseIcon");

// Full sheet
const playerSheet = document.getElementById("playerSheet");
const sheetHandle = document.getElementById("sheetHandle");
const sheetThumb = document.getElementById("sheetThumb");
const sheetTitle = document.getElementById("sheetTitle");
const sheetArtist = document.getElementById("sheetArtist");
const seekBar = document.getElementById("seekBar");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");
const volumeBar = document.getElementById("volumeBar");
const playBtn = document.getElementById("playBtn");
const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const navBtns = document.querySelectorAll(".nav-btn");
const panels = document.querySelectorAll(".panel");

let currentQueue = [];
let currentIndex = -1;
let searchTimer = null;
let history = JSON.parse(localStorage.getItem("musikin_history") || "[]");

// ---------- Bottom nav ----------
navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    navBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.view;
    panels.forEach((p) => p.classList.remove("active"));
    document.getElementById(target).classList.add("active");
    if (target === "libraryView") renderHistory();
  });
});

// ---------- Pencarian otomatis (debounce) ke YouTube ----------
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    resultList.innerHTML = "";
    statusRow.textContent = "";
    emptyState.style.display = "flex";
    return;
  }
  statusRow.textContent = "Mengetik...";
  searchTimer = setTimeout(() => doSearch(q), 500);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  }
});

async function doSearch(query) {
  statusRow.textContent = "Mencari di YouTube...";
  resultList.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Gagal mencari");
    const data = await res.json();
    currentQueue = data.results;
    if (!currentQueue.length) {
      statusRow.textContent = "Tidak ada hasil.";
      emptyState.style.display = "flex";
      return;
    }
    statusRow.textContent = `${currentQueue.length} hasil untuk "${query}"`;
    emptyState.style.display = "none";
    renderResults(currentQueue);
  } catch (err) {
    statusRow.textContent = "Terjadi kesalahan saat mencari. Coba lagi.";
    emptyState.style.display = "flex";
    console.error(err);
  }
}

function renderResults(tracks) {
  resultList.innerHTML = "";
  tracks.forEach((track, idx) => {
    resultList.appendChild(buildTrackItem(track, () => playTrack(idx, currentQueue)));
  });
  highlightPlayingRow();
}

function buildTrackItem(track, onClick) {
  const li = document.createElement("li");
  li.className = "track-item";
  li.dataset.id = track.id;
  li.innerHTML = `
    <img class="track-thumb" src="${track.thumbnail || ""}" alt="">
    <div class="track-info">
      <div class="track-title">${escapeHtml(track.title)}</div>
      <div class="track-artist">${escapeHtml(track.artist || "")}</div>
    </div>
    <div class="row-eq" style="display:none"><span></span><span></span><span></span></div>
    <div class="track-duration">${formatDuration(track.duration)}</div>
  `;
  li.addEventListener("click", onClick);
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

  updateMeta(track);
  setPlayingUI(true);
  highlightPlayingRow();
  addToHistory(track);
}

function updateMeta(track) {
  miniThumb.src = track.thumbnail || "";
  miniTitle.textContent = track.title;
  miniArtist.textContent = track.artist || "";
  sheetThumb.src = track.thumbnail || "";
  sheetTitle.textContent = track.title;
  sheetArtist.textContent = track.artist || "";
}

function setPlayingUI(isPlaying) {
  miniPlayer.classList.toggle("playing", isPlaying);
  miniPlayIcon.style.display = isPlaying ? "none" : "block";
  miniPauseIcon.style.display = isPlaying ? "block" : "none";
  playIcon.style.display = isPlaying ? "none" : "block";
  pauseIcon.style.display = isPlaying ? "block" : "none";
}

function highlightPlayingRow() {
  const currentId = currentQueue[currentIndex]?.id;
  document.querySelectorAll(".track-item").forEach((el) => {
    const isPlaying = el.dataset.id === currentId;
    el.classList.toggle("playing", isPlaying);
    const eq = el.querySelector(".row-eq");
    const dur = el.querySelector(".track-duration");
    if (eq) eq.style.display = isPlaying && !audio.paused ? "flex" : "none";
    if (dur) dur.style.display = isPlaying && !audio.paused ? "none" : "block";
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
    historyList.innerHTML = '<div class="empty-state" style="display:flex"><p>Belum ada lagu yang diputar.</p></div>';
    return;
  }
  history.forEach((track, idx) => {
    historyList.appendChild(buildTrackItem(track, () => playTrack(idx, history)));
  });
  highlightPlayingRow();
}

// ---------- Play/pause ----------
function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

miniPlayPause.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlay();
});
playBtn.addEventListener("click", togglePlay);

audio.addEventListener("play", () => { setPlayingUI(true); highlightPlayingRow(); });
audio.addEventListener("pause", () => { setPlayingUI(false); highlightPlayingRow(); });

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playTrack(currentIndex - 1, currentQueue);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < currentQueue.length - 1) playTrack(currentIndex + 1, currentQueue);
});

audio.addEventListener("ended", () => {
  if (currentIndex < currentQueue.length - 1) {
    playTrack(currentIndex + 1, currentQueue);
  }
});

audio.addEventListener("stalled", () => {
  statusRow.textContent = "Koneksi audio tersendat, coba tunggu sebentar...";
});

audio.addEventListener("waiting", () => {
  statusRow.textContent = "Memuat audio...";
});

audio.addEventListener("playing", () => {
  if (statusRow.textContent.startsWith("Memuat") || statusRow.textContent.startsWith("Koneksi")) {
    statusRow.textContent = "";
  }
});

let errorRetryCount = 0;
audio.addEventListener("error", () => {
  console.error("Audio error:", audio.error);
  setPlayingUI(false);
  const track = currentQueue[currentIndex];
  const label = track ? `"${track.title}"` : "lagu ini";

  if (errorRetryCount < 1) {
    // Kadang gagal sekali karena URL upstream keburu basi — coba re-fetch sekali.
    errorRetryCount++;
    statusRow.textContent = `Gagal muter ${label}, mencoba ulang...`;
    const retryTrack = currentQueue[currentIndex];
    setTimeout(() => {
      if (retryTrack) {
        audio.src = `${API_BASE}/api/stream/${retryTrack.id}?retry=${Date.now()}`;
        audio.play().catch(() => {});
      }
    }, 600);
    return;
  }

  errorRetryCount = 0;
  statusRow.textContent = `Gagal muter ${label}. Kemungkinan diblokir/dibatasi YouTube — coba lagu lain atau cek log server.`;
});

audio.addEventListener("play", () => { errorRetryCount = 0; });

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

// ---------- Full player sheet open/close ----------
miniPlayer.addEventListener("click", () => {
  if (!audio.src) return;
  playerSheet.classList.add("open");
});

let dragStartY = null;
sheetHandle.addEventListener("touchstart", (e) => { dragStartY = e.touches[0].clientY; }, { passive: true });
sheetHandle.addEventListener("touchmove", (e) => {
  if (dragStartY === null) return;
  const dy = e.touches[0].clientY - dragStartY;
  if (dy > 60) {
    playerSheet.classList.remove("open");
    dragStartY = null;
  }
}, { passive: true });
sheetHandle.addEventListener("touchend", () => { dragStartY = null; });
sheetHandle.addEventListener("click", () => playerSheet.classList.remove("open"));
