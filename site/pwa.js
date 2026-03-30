const pwaReady = ("serviceWorker" in navigator)
  ? window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js?v=2026-03-30-09", { scope: "/" });
    } catch (error) {
      console.error("Service worker registration failed.", error);
    }
  }, { once: true })
  : null;

window.__atlasPwaReady = ("serviceWorker" in navigator)
  ? navigator.serviceWorker.ready.catch(() => null)
  : Promise.resolve(null);
