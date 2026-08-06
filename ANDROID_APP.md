# Android APK Build Guide (Capacitor)

The dashboard now runs as both a web app and a native Android app from the
same codebase and the same Supabase login.

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

## Google Sign-In on Android

Native OAuth returns through a custom URL scheme instead of a web redirect.

1. Add this deep link to `android/app/src/main/AndroidManifest.xml`, inside the
   main `<activity>`:
   ```xml
   <intent-filter>
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="app.lovable.64b44d9e8bca4a859edc15e293ba8d8a" />
   </intent-filter>
   ```
2. In the Supabase dashboard → Authentication → URL Configuration → Redirect
   URLs, add:
   ```
   app.lovable.64b44d9e8bca4a859edc15e293ba8d8a://auth
   ```
3. Keep your existing web redirect URLs there too — web login is unchanged.

The app opens Google in the system browser, then `src/lib/nativeAuth.ts`
catches the callback and establishes the Supabase session. Email/password login
works with no extra configuration.

## Producing a release APK / AAB

```bash
npm run build
npx cap sync
npx cap open android
```
Then in Android Studio: Build → Generate Signed Bundle / APK, and follow the
signing key wizard. Use the `.aab` output for Google Play.
