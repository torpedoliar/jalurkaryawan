# Peta, check-in dan tracking bus

## Pemisahan fungsi

- Reservasi (`Booking`, `Trip.bookedCount`) tetap menyatakan kursi yang dipesan.
- Kehadiran satu per booking menyatakan karyawan sudah naik. Scan tidak menambah/mengurangi kursi.
- Tracking GPS menyatakan lokasi perangkat sopir pada perjalanan. GPS tidak membuat kehadiran, dan penolakan izin GPS tidak memblokir check-in.
- Tidak ada perubahan otomatis booking historis menjadi `NO_SHOW` dalam implementasi awal. Finalisasi ketidakhadiran membutuhkan kebijakan tersendiri.

## Check-in dua arah

1. Sopir login, memilih trip yang ditugaskan, lalu scan QR tiket karyawan melalui scanner Zebra/DataWedge atau kamera HP.
2. Jika handheld bermasalah, karyawan login dan scan QR bus dari booking-nya sendiri.
3. Server memeriksa booking, penugasan/kepemilikan, trip, bus dan waktu. Kedua cara menghasilkan satu attendance. Scan ulang mengembalikan waktu dan metode pertama, bukan catatan ganda.
4. Jendela awal: 60 menit sebelum sampai 90 menit setelah waktu titik jemput masing-masing penumpang. Waktu server adalah acuan, bukan jam perangkat.
5. Jangan menganggap check-in berhasil ketika offline. UI menunggu konfirmasi server dan menampilkan kegagalan untuk dicoba lagi.

QR bus permanen bisa difoto dan dibagikan. QR ini adalah identitas bus, bukan bukti tunggal keberadaan fisik. Geofence atau QR dinamis dapat ditambahkan sebagai kebijakan lanjutan jika diperlukan.

QR menggunakan payload bertipe `BMS-T1:` untuk tiket dan `BMS-B1:` untuk bus. Isi setelah prefix harus acak, bukan ID atau data pribadi. Rotasi QR bus membatalkan cetakan sebelumnya; cetak ulang dan ganti label bus setelah rotasi.

## Pengelolaan admin

- Rute & Titik: pilih rute, ubah titik, geser pin di peta (posisi tersimpan saat pin dilepas) atau klik peta/isi latitude/longitude. Klik pin untuk membuka titik itu di formulir. Dua koordinat harus terisi bersama atau sama-sama kosong.
- Hapus pada daftar titik hanya menonaktifkan titik: riwayat booking dan langganan lama tetap tersimpan, dan titik bisa diaktifkan lagi lewat "Tampilkan nonaktif". Titik yang masih dipakai langganan aktif atau booking yang belum berangkat tidak bisa dihapus.
- Garis putus-putus hanya skema urutan titik aktif, **bukan** jalur jalan yang dilalui bus. Waktu jemput masih menggunakan offset yang dikelola admin, bukan ETA dari GPS.
- Admin & Vendor: role Sopir wajib terhubung ke vendor. Penugasan trip hanya mengizinkan sopir aktif dari vendor bus yang sesuai.
- Trip Harian → Penumpang: penugasan sopir, jumlah check-in, jam dan metode kehadiran.
- Vendor & Bus → QR: tampilkan/cetak QR check-in bus. Mengganti QR perlu konfirmasi karena label lama akan tidak berlaku.
- Operasional → Tracking Bus: posisi per trip, diperbarui setiap 15 detik. Posisi lebih dari 120 detik atau perjalanan selesai disebut lokasi terakhir, bukan live.

## Basemap web

Konfigurasi build Vite:

```dotenv
VITE_MAP_TILE_URL=https://your-licensed-provider.example/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=Your licensed provider attribution
```

Default pengembangan adalah tile OpenStreetMap. Untuk produksi, tentukan penyedia berlisensi, batas penggunaan, attribution dan aturan caching. Server publik OSM bukan layanan offline atau kapasitas tak terbatas. URL kosong menonaktifkan tile; koordinat manual tetap tersedia. Tile eksternal membuat browser menghubungi penyedia peta, sehingga kebijakan jaringan/privasi organisasi perlu mengizinkannya.

## Mobile dan perangkat fisik

Lihat `apps/mobile/README.md` untuk native build, profil DataWedge dan background location. Expo Go bukan lingkungan verifikasi scanner Zebra/background GPS.

Sebelum pilot, verifikasi pada model Zebra/Android yang benar:

- Scanner DataWedge melalui intent dan kamera biasa.
- GPS dan izin lokasi, termasuk saat layar terkunci.
- Gangguan sinyal, pergantian jaringan dan sesi login kedaluwarsa.
- Stop tracking pada selesai perjalanan/logout.
- Aplikasi di-force-stop tidak dijanjikan terus mengirim lokasi.
- Sertifikat HTTPS dipercaya perangkat dan server dapat dijangkau dari lapangan.

Test JavaScript, autolinking dan introspeksi Expo tidak membuktikan native Android berhasil dikompilasi atau perilaku GPS di hardware fisik.

## Mode mock

Login demo sopir: `driver` / `demo1234` (vendor v1, rute R1) dan `driver2` / `demo1234` (vendor v2, rute R4). Mock menyimpan perubahan di memori; restart menghapusnya. Data peta selain R1 menggunakan koordinat perkiraan untuk demo, bukan survei lapangan.

Mock memodelkan kontrak dan alur, tetapi tidak menggantikan pengujian transaksi PostgreSQL, authorization backend, migrasi, atau uji perangkat fisik. Jangan menggunakan credential demo di produksi.

## Migrasi dan penyimpanan backend

- Terapkan migrasi `20261027000000_trip_operations` menggunakan prosedur deployment migrasi yang biasa. Jangan menjalankannya pada produksi tanpa backup dan persetujuan operator.
- QR bus/tiket disimpan sebagai ciphertext AES-256-GCM dengan kunci turunan APP_SECRET dan hash SHA-256 untuk pencarian. APP_SECRET harus stabil serta dijaga; menggantinya membuat ciphertext QR lama tidak terbaca. Rotasi QR perlu dilakukan terencana.
- Attendance memiliki primary key bookingId, sehingga scan bersamaan tidak menggandakan kehadiran. Trip/booking dikunci berurutan dalam transaksi.
- Bus tidak dapat diganti dan jadwal tidak dapat dipropagasikan setelah check-in atau perjalanan dimulai. Pergantian bus sebelum itu menghapus penugasan sopir supaya admin menugaskan kembali sopir yang sesuai vendor.
- Booking yang sudah check-in tidak dapat dibatalkan oleh karyawan; penghentian langganan/pembekuan tidak menghapus attendance yang sudah terjadi.
- Satu sopir hanya memiliki satu perjalanan aktif. Mengakhiri perjalanan menutup check-in baru tanpa menandai NO_SHOW otomatis.
- GPS hanya diterima selama perjalanan aktif. Sampel maksimal 100 per batch, maksimal 24 jam ke belakang dan 60 detik ke depan. Lokasi dibaca hanya dalam rentang 24 jam; pembersihan data lama dilakukan saat ingest berikutnya.
- Migration check koordinat menggunakan NOT VALID untuk mempertahankan data lama; baris baru/diubah tetap diperiksa. Audit dan bersihkan koordinat lama sebelum memvalidasi constraint di produksi.
