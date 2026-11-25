// NAS Hub Service Worker
// Cache name is tied to the app version so every release purges the old cache.
const CACHE_NAME = "nashub-v5.0.1";

// Only precache things that rarely change. index.html is deliberately NOT
// precached — a stale app shell was the cause of home-screen PWAs never updating.
const SHELL = ["/manifest.json"];
// 4.16.0: the app's three typefaces ship with it, so they are kept for offline use from the first visit.
// Relative paths, so a self-hosted copy in a sub-folder caches its own files.
const LOGOS = ["logos/actual.svg", "logos/adguard.svg", "logos/audiobookshelf.svg", "logos/bazarr.svg", "logos/calibre.svg", "logos/docker.svg", "logos/emby.svg", "logos/filebrowser.svg", "logos/firefly.svg", "logos/frigate.svg", "logos/gitea.svg", "logos/gitlab.svg", "logos/glinet.svg", "logos/grafana.svg", "logos/homeassistant.svg", "logos/homebox.svg", "logos/immich.svg", "logos/jellyfin.svg", "logos/jellyseerr.svg", "logos/lidarr.svg", "logos/mealie.svg", "logos/navidrome.svg", "logos/nextcloud.svg", "logos/nginxpm.svg", "logos/nodered.svg", "logos/openwrt.svg", "logos/overseerr.svg", "logos/paperless.svg", "logos/photoprism.svg", "logos/pihole.svg", "logos/plex.svg", "logos/portainer.svg", "logos/prowlarr.svg", "logos/proxmox.svg", "logos/qbittorrent.svg", "logos/radarr.svg", "logos/readarr.svg", "logos/sabnzbd.svg", "logos/sonarr.svg", "logos/syncthing.svg", "logos/synology.svg", "logos/tailscale.svg", "logos/tautulli.svg", "logos/traefik.svg", "logos/transmission.svg", "logos/truenas.svg", "logos/unifi.svg", "logos/unraid.svg", "logos/uptime-kuma.svg", "logos/vaultwarden.svg", "logos/wireguard.svg"];
const FONTS = ["fonts/ibm-plex-mono-latin-400-normal.woff2", "fonts/ibm-plex-mono-latin-500-normal.woff2", "fonts/instrument-sans-latin-400-normal.woff2", "fonts/instrument-sans-latin-500-normal.woff2", "fonts/instrument-sans-latin-600-normal.woff2", "fonts/instrument-sans-latin-700-normal.woff2", "fonts/syne-latin-700-normal.woff2"];

// A new worker waits until the page asks it to take over (the green "New version ready" banner),
// so an update never reloads the app under someone's fingers. (BUG-NH-006)
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all([cache.addAll(SHELL).catch(() => {}), cache.addAll(FONTS).catch(() => {}), cache.addAll(LOGOS).catch(() => {})]))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Allow the page to tell a waiting SW to take over immediately
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: always network-first. Cache is an OFFLINE FALLBACK ONLY.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put("/index.html", clone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Never cache the service worker itself
  if (url.pathname.endsWith("/sw.js")) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        return response;
      });
    })
  );
});

// ── Down alerts ─────────────────────────────────────────────────────────────
// The worker sends these while the app is closed and the phone is asleep, which
// is the only time they are worth anything.
self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "NAS Hub", body: "Something changed on your NAS." }; }
  const title = d.title || "NAS Hub";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    // Same tag replaces the previous one rather than stacking, so a pool that
    // reminds you daily leaves one notification, not seven.
    tag: d.tag || d.kind || "nashub",
    renotify: true,
    requireInteraction: !!d.critical,
    icon: "/icon192.png",
    badge: "/icon192.png",
    data: { kind: d.kind || "", url: d.kind === "pool" ? "/?go=truenas" : "/" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Focus the app if it is already open rather than stacking another copy.
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        await c.focus();
        if ("navigate" in c && target !== "/") { try { await c.navigate(target); } catch (e) {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// iOS in particular can rotate a subscription without telling the app. Re-send
// it so alerts do not quietly stop working.
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: "PUSH_SUB_CHANGED" });
  })());
});
