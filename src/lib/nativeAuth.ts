import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';

/** Custom URL scheme registered by the Android/iOS app for OAuth callbacks. */
export const NATIVE_AUTH_REDIRECT = 'app.lovable.64b44d9e8bca4a859edc15e293ba8d8a://auth';

export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * Signs in with Google.
 * - Web: normal redirect flow.
 * - Native (Capacitor): opens the system browser and completes the session
 *   when the OS hands the deep link back to the app.
 */
export const signInWithGoogle = async () => {
  if (!isNativeApp()) {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: NATIVE_AUTH_REDIRECT,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) return { data, error };

  await Browser.open({ url: data.url, presentationStyle: 'popover' });
  return { data, error: null };
};

/**
 * Listens for the OAuth deep link on native platforms and establishes the
 * Supabase session. Safe no-op on web. Returns a cleanup function.
 */
export const registerNativeAuthListener = (onSignedIn?: () => void) => {
  if (!isNativeApp()) return () => {};

  const handle = App.addListener('appUrlOpen', async ({ url }) => {
    if (!url?.startsWith(NATIVE_AUTH_REDIRECT)) return;

    try {
      const parsed = new URL(url.replace('#', '?'));
      const code = parsed.searchParams.get('code');
      const accessToken = parsed.searchParams.get('access_token');
      const refreshToken = parsed.searchParams.get('refresh_token');

      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      } else if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
      onSignedIn?.();
    } finally {
      await Browser.close().catch(() => {});
    }
  });

  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
};
