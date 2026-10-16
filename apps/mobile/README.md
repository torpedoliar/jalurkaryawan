# Bus Karyawan (mobile)

Expo app for EMPLOYEE role. Spec: `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` §6.2.

## Run with mock API

```bash
cd apps/mobile
cp .env.example .env   # EXPO_PUBLIC_USE_MOCK=true, EXPO_PUBLIC_API_URL=http://localhost
pnpm install
pnpm test              # jest-expo + msw/node, seeded accounts K1001..K1090 / demo1234
npx expo start
```

`index.ts` starts `msw/native` with `@bms/mock-api` handlers when `EXPO_PUBLIC_USE_MOCK=true`.
Scan the QR with Expo Go, or press `a` for an emulator.

## Point at the real backend

```bash
EXPO_PUBLIC_API_URL=https://bus.perusahaan.id EXPO_PUBLIC_USE_MOCK= npx expo start
```

No other setting needed — the URL is baked at build time (spec §6.2).

## Internal APK (preview)

```bash
eas project:init   # replaces the zero projectId in app.json
eas build --profile preview --platform android
```

`eas.json` preview = `distribution: internal`, `android.buildType: apk`.
Share the QR/download link with employees; no Play Store needed.

## Manual checklist (spec §8: web & mobile get manual checks)

1. Login K1001/demo1234 → Beranda shows 14 cards (7 days × PICKUP/DROPOFF).
2. Booking Harian → tomorrow, siang, PICKUP, R2, Halte Bulak Kapal → "Sisa kursi" → Pesan → "Booking berhasil" → Beranda shows it → Batalkan → "Dibatalkan".
3. K1090/demo1234 → forced change form blocks every tab until changed.
4. K1059 → suspension banner on every tab; Pesan disabled.
5. Kill and reopen the app → session restored (SecureStore refresh rotation).
6. Airplane mode on login → "Terjadi kesalahan. Coba lagi." (network failure is not ApiFailure).
```
