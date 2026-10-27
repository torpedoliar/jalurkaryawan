# Menjalankan aplikasi di Windows

## Prasyarat

- Node.js 22 atau lebih baru.
- pnpm sesuai `packageManager` proyek (10.33.2). Jika belum tersedia: `npm install -g pnpm@10.33.2`.
- Docker Desktop aktif untuk mode live. Mode mock tidak memerlukan Docker.

## Cara termudah

Klik dua kali `start.bat` di folder utama proyek, atau jalankan dari Command Prompt:

```bat
start.bat
```

Mode default **live** menjalankan:

1. PostgreSQL development tersendiri di `127.0.0.1:5434` (database `bms_dev`).
2. Generate Prisma client dan apply migration ke database development tersebut.
3. API di `http://127.0.0.1:3000` pada jendela terminal tersendiri.
4. Web di `http://127.0.0.1:5241` pada jendela terminal tersendiri.
5. Membuka browser setelah service siap.

Database baru menampilkan **Setup Awal** untuk membuat Super Admin. Script tidak menjalankan seed otomatis. Akun demo bukan akun pada database live baru.

Dependencies diinstall dengan frozen lockfile jika `node_modules/.pnpm` belum ada. Jika baru menarik perubahan dependency, jalankan `pnpm install --frozen-lockfile` sebelum startup.

Script menggunakan database development yang eksplisit, bukan DATABASE_URL dari `.env` lama. Tidak mengubah `.env` API/web, tidak memakai database test `bms_test`, dan tidak menjalankan deployment produksi.

## Demo UI tanpa backend

```bat
start.bat -Mode mock
```

Akun demo: `admin`, `00012345`, `driver`, semuanya password `demo1234`. Data mock berada di memori browser dan hilang saat halaman dimuat ulang. Mode ini tidak membuktikan backend atau GPS perangkat bekerja.

## Pilihan lain

```bat
start.bat -Check
start.bat -Mode mock -Check
start.bat -NoBrowser
start.bat -WebPort 5297 -ApiPort 3097 -DatabasePort 5497
```

PowerShell langsung:

```powershell
.\scripts\start.ps1 -Mode live
```

`-Check` memeriksa prasyarat saja tanpa menyalakan service atau mengubah database. Jika port sedang dipakai/dicadangkan Windows, script berhenti dan meminta port lain; tidak mematikan proses yang sudah ada.

## Menghentikan

Tekan **Ctrl+C** di masing-masing jendela API dan web. Untuk database:

```bat
docker compose -p bms-local-dev -f scripts/compose.dev.yml stop
```

Data tersimpan dalam volume Docker `bms-local-dev_pgdata`. **Jangan memakai `down -v` kecuali benar-benar ingin menghapus data development.** Hentikan instance sebelumnya sebelum start lagi, dan gunakan port database yang konsisten.

Secret development dibuat sekali di `.local/app-secret` dan dipakai ulang. Folder `.local` diabaikan Git. Jangan hapus/ganti secret setelah menerbitkan QR: QR terenkripsi memerlukan secret yang sama agar tetap terbaca. Backup development juga disimpan di `.local`.

## Mobile dan produksi

Launcher ini untuk **web + API development lokal**. Tidak membangun APK atau menjalankan emulator. Aplikasi mobile memakai prosedur di `apps/mobile/README.md` dan harus mengarah ke API yang dapat dijangkau perangkat; `127.0.0.1` pada HP bukan komputer Anda.

Jangan mengekspos launcher development ini ke internet. Produksi tetap menggunakan konfigurasi HTTPS/reverse proxy di `infra/` dan prosedur deployment tersendiri.
