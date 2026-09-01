# Android App (Capacitor)

Everything specific to the Android build of the user dashboard lives here.
The app shares the same React codebase, the same Supabase project and the same
login as the web dashboard.

## Folder map

| Path | What it is |
| --- | --- |
| `android-app/docs/01-SETUP-AND-BUILD.md` | One-time setup, live reload, push notifications, Google Sign-In, release build |
| `android-app/docs/02-RELEASE-CHECKLIST.md` | Pre-release verification list |
| `capacitor.config.ts` (repo root) | Capacitor config — **must stay at the repo root**, the Capacitor CLI only reads it from there |
| `src/mobile/nativeAuth.ts` | Native Google OAuth deep-link handling (`exchangeCodeForSession`) |
| `src/mobile/pushNotifications.ts` | FCM token registration + permission prompt |
| `supabase/functions/send-push/` | Server-side push sender (FCM v1, service account in Supabase secrets) |
| `android/` (generated, not committed) | Native project created by `npx cap add android` |

## Quick commands

```bash
npm install
npx cap add android      # first time only
npm run build && npx cap sync
npx cap run android
```

Full details: [docs/01-SETUP-AND-BUILD.md](./docs/01-SETUP-AND-BUILD.md).
