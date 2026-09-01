# Android APK Build Guide (Capacitor)

The dashboard runs as a web app and a native Android app from the same
codebase and the same Supabase login.

## One-time setup on your machine

Requirements: Node.js, Android Studio (with SDK + a device/emulator), JDK 17.

1. Export the project to GitHub (top-right "Export to Github"), then clone it.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Add the Android platform:
   ```bash
   npx cap add android
   npx cap update android
   ```
4. Build the web assets and sync them into the native project:
   ```bash
   npm run build
   npx cap sync
   ```
5. Run on a device or emulator:
   ```bash
   npx cap run android
   ```

Repeat steps 4-5 after every `git pull`.

## Live reload during development

`capacitor.config.ts` points `server.url` at the Lovable preview, so the
installed app loads the latest preview build without rebuilding.
**Before shipping a release APK, delete the whole `server` block** so the app
loads the bundled `dist/` assets instead.

---

## 1. Push notifications (Firebase Cloud Messaging)

The app uses `@capacitor/push-notifications`, which is backed by FCM on Android.

### Firebase console
1. Create (or open) a Firebase project.
2. Add an Android app with package name
   `app.lovable.64b44d9e8bca4a859edc15e293ba8d8a`.
3. Download `google-services.json` and place it at
   `android/app/google-services.json`.
4. In **Project settings → Service accounts**, click **Generate new private
   key**. Paste the whole JSON file contents into the Supabase secret
   `FCM_SERVICE_ACCOUNT` (Edge Function secrets). It is only ever read
   server-side — never ship it in the app.

### Gradle wiring
`android/build.gradle` (project level), inside `buildscript { dependencies { … } }`:
```gradle
classpath 'com.google.gms:google-services:4.4.2'
```
`android/app/build.gradle`, at the bottom of the file:
```gradle
apply plugin: 'com.google.gms.google-services'
```

### AndroidManifest.xml
Inside `<manifest>` (above `<application>`):
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
Inside `<application>`:
```xml
<meta-data
  android:name="com.google.firebase.messaging.default_notification_channel_id"
  android:value="default" />
```
`POST_NOTIFICATIONS` is required on Android 13+; the app requests it at runtime
the first time a user signs in.

### Sending a notification
Call the `send-push` edge function:
```ts
await supabase.functions.invoke('send-push', {
  body: { title: 'Arbitrage alert', body: 'BTC/USDT 1.4% spread detected' },
});
```
A signed-in user can only notify their own devices. Backend services using the
service-role key may pass `user_id` to notify any user. Every send is recorded
in `notification_log`, and tokens FCM rejects are deleted automatically.

---

## 2. Google Sign-In: manifest + Supabase redirect entries

Native OAuth returns through a custom URL scheme instead of a web redirect.

### AndroidManifest.xml
Inside the main `<activity>` (the one with `MAIN`/`LAUNCHER`):
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="app.lovable.64b44d9e8bca4a859edc15e293ba8d8a" />
</intent-filter>
```

### Supabase → Authentication → URL Configuration → Redirect URLs
Add all of these:
```
app.lovable.64b44d9e8bca4a859edc15e293ba8d8a://auth
https://<your-published-domain>/dashboard
https://<your-published-domain>/auth
https://id-preview--64b44d9e-8bca-4a85-9edc-15e293ba8d8a.lovable.app/**
```
Site URL should be your published web domain.

### Google Cloud console
* OAuth consent screen → add your Supabase domain
  `zupbliefzhnohsoguwuk.supabase.co` under Authorized domains.
* Credentials → Web application client:
  * Authorized JavaScript origins: your published web domain.
  * Authorized redirect URI:
    `https://zupbliefzhnohsoguwuk.supabase.co/auth/v1/callback`
* Paste the client ID/secret into Supabase → Authentication → Providers → Google.

Android does **not** need its own OAuth client here — the system browser hits
the Supabase callback and Supabase redirects back into the custom scheme.

### End-to-end login test (run on a device)
1. Fresh install the debug APK, launch it, tap **Continue with Google**.
2. The system browser opens the Google account chooser → pick an account.
3. The browser closes automatically and the app lands on `/dashboard`
   (`src/lib/nativeAuth.ts` catches the deep link and calls
   `exchangeCodeForSession`).
4. Kill and relaunch the app — you should still be signed in
   (session persists in local storage, auto-refresh on).
5. Confirm a row appeared in `push_tokens` for your user.
6. Send a test push while the app is backgrounded — the notification should
   appear in the system tray.
7. Sign out → you should be returned to `/auth` and protected routes should
   redirect away.

If the browser shows `{"error":"requested path is invalid"}`, the redirect URL
in step "Redirect URLs" above is missing or mistyped.

---

## 3. Producing a release APK / AAB

```bash
npm run build
npx cap sync
npx cap open android
```
Then in Android Studio: Build → Generate Signed Bundle / APK, and follow the
signing key wizard. Use the `.aab` output for Google Play.

Release checklist:
- [ ] `server` block removed from `capacitor.config.ts`.
- [ ] `android.allowMixedContent` removed (only needed for live reload).
- [ ] `google-services.json` present and matching the release package name.
- [ ] Release SHA-1/SHA-256 added to the Firebase Android app.
- [ ] Redirect URLs above still list the production domain.

---

## Security notes

* Only the Supabase **anon** key ships in the app; it is safe to expose because
  every table is protected by row-level security.
* `push_tokens` and `notification_log` are scoped to `auth.uid()` — one user can
  never read or write another user's device tokens or alerts.
* The FCM service-account key lives only in Supabase edge-function secrets.
* `send-push` verifies the caller's JWT in code and refuses to notify a
  different user unless called with the service role key.
* API/exchange credentials are never stored in the app; they stay encrypted
  server-side and are only used by the VPS executor.
