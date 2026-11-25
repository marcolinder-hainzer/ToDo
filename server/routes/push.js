import { Router } from 'express';
import { getPublicKey, removeSubscription, saveSubscription, sendPushToUser } from '../push.js';
import { badRequest, body } from '../validate.js';

const router = Router();

router.get('/public-key', (req, res) => {
  res.json({ publicKey: getPublicKey() });
});

router.post('/subscribe', (req, res) => {
  const sub = body(req).subscription;
  const endpoint = sub?.endpoint;
  const keys = sub?.keys;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest('Ungültiges Push-Abo');
  }
  if (
    url.protocol !== 'https:' ||
    endpoint.length > 1000 ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string' ||
    keys.p256dh.length > 200 ||
    keys.auth.length > 100
  ) {
    throw badRequest('Ungültiges Push-Abo');
  }
  saveSubscription(req.user.id, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const endpoint = body(req).endpoint;
  if (typeof endpoint === 'string') removeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  const result = await sendPushToUser(req.user.id, {
    title: 'Test-Benachrichtigung',
    body: 'Super – Erinnerungen kommen auf diesem Gerät an.',
    url: '/#/settings',
    tag: 'test',
  });
  res.json(result);
});

export default router;
