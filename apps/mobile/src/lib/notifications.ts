/**
 * Best-effort local notifications: alert on approval requests and finished
 * turns when the app isn't foregrounded. Honest limits: iOS suspends the JS
 * runtime (and the WebSocket) shortly after backgrounding, so these only
 * fire in the window where events still arrive (app inactive / just
 * backgrounded / another app in split view). True "phone buzzes an hour
 * into a long run" push needs an APNs pipeline the gateway doesn't have yet
 * — see docs/plans/ios-app-feasibility.md §6.2.
 */

import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

let permissionAsked = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureNotificationPermission(): Promise<void> {
  if (permissionAsked) {
    return;
  }
  permissionAsked = true;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Notifications are a nicety — never block chat on them.
  }
}

/** Fire a local notification, but only when the app isn't active. */
export function notifyIfBackgrounded(title: string, body: string): void {
  if (AppState.currentState === 'active') {
    return;
  }
  void Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  }).catch(() => {});
}
