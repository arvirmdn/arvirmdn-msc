# Musikin — Web Musik dengan Pencarian Otomatis ke YouTube

Web player musik gaya Spotify. Kamu ketik judul lagu, otomatis dicari ke YouTube
lewat backend (yt-dlp), lalu diputar sebagai **audio only** (video-nya tidak
ditampilkan) langsung di browser.

## Struktur

```
web-musik/
├── main.py            # Backend FastAPI (search + stream audio via yt-dlp)
├── requirements.txt
├── static/
│   ├── index.html     # UI
│   ├── style.css       # Tema dark ala Spotify
│   └── app.js           # Logika search, queue, dan player
```

## Cara jalanin lokal

```bash
cd web-musik
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Buka `http://localhost:8000` di browser.

## Cara kerja

1. User ketik query di search box → setelah 500ms jeda (debounce), frontend
   panggil `GET /api/search?q=...`.
2. Backend pakai `yt_dlp` dengan `ytsearch{N}:query` buat ambil daftar hasil
   dari YouTube (judul, channel, durasi, thumbnail) — tanpa download.
3. Waktu user klik salah satu hasil, frontend set `<audio>` src ke
   `/api/stream/{video_id}`.
4. Backend ekstrak URL audio langsung (`bestaudio`) via yt-dlp, lalu di-proxy
   (di-stream ulang) ke browser supaya tidak kena blokir CORS/hotlink dari
   googlevideo.com.
5. Riwayat lagu yang pernah diputar disimpan di `localStorage` browser (tab
   "Riwayat").

## Deploy ke Railway (sama seperti arvirmdn)

1. Push folder ini ke repo GitHub baru.
2. Buat project baru di Railway → Deploy from GitHub repo.
3. Railway otomatis deteksi Python. Set start command:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
4. Tidak perlu environment variable khusus untuk versi dasar ini.

## Catatan penting

- **Legal/ToS**: streaming audio dari YouTube lewat yt-dlp berpotensi
  melanggar Terms of Service YouTube. Ini murni implementasi teknis sesuai
  permintaanmu — pertimbangkan risiko ini sebelum dipakai publik/produksi.
- **Rate limit / blokir**: YouTube kadang membatasi request dari IP server
  cloud (termasuk Railway). Kalau `/api/stream` sering gagal, biasanya solusinya
  pakai `cookies.txt` akun YouTube di opsi yt-dlp (`cookiefile`) atau proxy
  residential — tinggal bilang kalau mau aku tambahkan.
- **Performa search**: tiap request `/api/search` memanggil yt-dlp secara
  langsung (tidak ada cache). Untuk trafik lebih besar, sebaiknya tambah
  caching (mis. Redis) supaya query yang sama tidak berulang kali hit YouTube.
- CORS dibuka untuk semua origin (`*`) — persempit ke domain frontend-mu saja
  kalau backend dipisah domainnya dari frontend saat production.
