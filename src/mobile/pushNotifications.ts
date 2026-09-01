import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';

export const isNativeApp = () => Capacitor.isNativePlatform();

/** Stores/refreshes the FCM device token for the signed-in user. */
const saveToken = async (token: string) => {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  await supabase
    .from('push_tokens')
    .upsert(
      {
        user_id: user.id,
        token,
        platform: Capacitor.getPlatform(),
        device_label: navigator.userAgent.slice(0, 120),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
};

/**
 * Registers the device for background push notifications.
 * No-op on web. Returns a cleanup function.
 */
export const registerPushNotifications = (
  onNotification?: (title: string, body: string) => void,
): (() => void) => {
  if (!isNativeApp()) return () => {};

  const handles: Array<Promise<{ remove: () => void }>> = [];

  const init = async () => {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') return;

    handles.push(
      PushNotifications.addListener('registration', async ({ value }) => {
        try {
          await saveToken(value);
        } catch {
          /* token save is best-effort */
        }
      }),
    );

    handles.push(
      PushNotifications.addListener('registrationError', () => {
        /* silently ignore — app still works without push */
      }),
    );

    handles.push(
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        onNotification?.(notification.title ?? 'Notification', notification.body ?? '');
      }),
    );

    await PushNotifications.register();
  };

  void init();

  return () => {
    handles.forEach((h) => h.then((handle) => handle.remove()).catch(() => {}));
  };
};

/** Removes this device's token, e.g. on sign out. */
export const unregisterPushToken = async (token?: string) => {
  if (!isNativeApp() || !token) return;
  await supabase.from('push_tokens').delete().eq('token', token);
};
