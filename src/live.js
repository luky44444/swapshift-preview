const shopRev = new Map();
const shopSubs = new Map();

export function shopRevision(shopId) {
  if (!shopId) return 0;
  return shopRev.get(shopId) || 0;
}

export function notifyShop(shopId) {
  if (!shopId) return;
  const next = (shopRev.get(shopId) || 0) + 1;
  shopRev.set(shopId, next);
  const payload = `data: ${JSON.stringify({ revision: next })}\n\n`;
  for (const res of shopSubs.get(shopId) || []) {
    try {
      res.write(payload);
    } catch {
      shopSubs.get(shopId)?.delete(res);
    }
  }
}

export function subscribeShop(shopId, res) {
  if (!shopId) return () => {};
  if (!shopSubs.has(shopId)) shopSubs.set(shopId, new Set());
  shopSubs.get(shopId).add(res);
  const drop = () => shopSubs.get(shopId)?.delete(res);
  res.on("close", drop);
  return drop;
}
