# Android Release Checklist

Run through this before generating a signed APK/AAB.

## Build config
- [ ] `server` block removed from root `capacitor.config.ts` (otherwise the app loads the preview URL).
- [ ] `android.allowMixedContent` removed (live-reload only).
- [ ] `npm run build && npx cap sync` run after the last code change.

## Firebase / push
- [ ] `android/app/google-services.json` present and matching the release package name
      `app.lovable.64b44d9e8bca4a859edc15e293ba8d8a`.
- [ ] Release SHA-1 / SHA-256 added to the Firebase Android app.
- [ ] Supabase secret `FCM_SERVICE_ACCOUNT` set (server-side only).
- [ ] Test push received while the app is backgrounded.

## Auth
- [ ] Redirect URLs in Supabase include the custom scheme and the production domain.
- [ ] Google Sign-In tested on a physical device (fresh install → sign in → relaunch → still signed in).
- [ ] Sign-out returns to `/auth` and protected routes redirect away.

## Security
- [ ] Only the Supabase anon key ships in the bundle.
- [ ] `push_tokens` / `notification_log` RLS verified as user-scoped.
- [ ] No exchange API keys stored on device.
