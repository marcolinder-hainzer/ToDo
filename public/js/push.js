import { config, removePushSubscription, savePushSubscription } from './data.js';
import { store } from './store.js';

const USER_KEY = 'todo.push.user';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => Boolean(config.vapidPublicKey);

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('sw.js');
  } catch (err) {
    console.warn('Service Worker konnte nicht registriert werden', err);
    return null;
  }
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || registerServiceWorker();
}

function base64ToUint8(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function getPushState() {
  const state = {
    supported: pushSupported(),
    configured: pushConfigured(),
    secure: window.isSecureContext,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    subscribed: false,
  };
  if (!state.supported || !state.secure) return state;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  state.subscribed = !!sub && localStorage.getItem(USER_KEY) === String(store.user?.id);
  return state;
}

/** True if this browser receives server push for the logged-in user. */
export async function pushActiveHere() {
  try {
    return (await getPushState()).subscribed;
  } catch {
    return false;
  }
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Dieser Browser unterstützt keine Push-Benachrichtigungen');
  if (!window.isSecureContext) throw new Error('Push-Benachrichtigungen benötigen HTTPS');
  if (!pushConfigured()) throw new Error('Push-Benachrichtigungen sind noch nicht eingerichtet');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8(config.vapidPublicKey) });
  }
  await savePushSubscription(sub);
  localStorage.setItem(USER_KEY, String(store.user.id));
}

export async function disablePush() {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await removePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  localStorage.removeItem(USER_KEY);
}

/** After login: make sure the database knows this device's subscription. */
export async function syncPushSubscription() {
  if (!pushSupported() || !window.isSecureContext || !pushConfigured() || Notification.permission !== 'granted') return;
  if (localStorage.getItem(USER_KEY) !== String(store.user?.id)) return;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) await savePushSubscription(sub).catch(() => {});
}

/** Before logout: stop sending this user's reminders to this device. */
export async function detachPushSubscription() {
  try {
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await removePushSubscription(sub.endpoint);
  } catch {
    /* ignore */
  }
}

/** Show a local system notification (used when server push isn't active here). */
export async function showLocalNotification(title, options) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await registration();
  if (reg?.showNotification) return reg.showNotification(title, { icon: 'icons/icon-192.png', ...options });
  new Notification(title, options);
}
