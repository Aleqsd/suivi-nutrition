const SHARE_CACHE = "atlas-share-target-v1";
const SHARE_FILE_PREFIX = "/__share-target/";
const SHARE_META_PREFIX = "/__share-target-meta/";
const SHARE_ACTION_PATH = "/app/share-target/";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function buildShareId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") {
    return self.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function firstSharedFile(formData) {
  for (const value of formData.values()) {
    if (value instanceof File) return value;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === SHARE_ACTION_PATH) {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = firstSharedFile(formData);
      if (!file) {
        return Response.redirect("/app/capture/?share_error=no-photo", 303);
      }

      const shareId = buildShareId();
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        new Request(`${SHARE_FILE_PREFIX}${shareId}`),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
        }),
      );
      await cache.put(
        new Request(`${SHARE_META_PREFIX}${shareId}`),
        new Response(JSON.stringify({
          name: file.name || "meal-photo.jpg",
          type: file.type || "application/octet-stream",
          lastModified: file.lastModified || 0,
          size: file.size || 0,
        }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        }),
      );
      return Response.redirect(`/app/capture/?share_id=${encodeURIComponent(shareId)}`, 303);
    })());
  }
});
