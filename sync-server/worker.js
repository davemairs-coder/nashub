var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
// 5.0.0 (open source): no licences and no tiers. Every group gets the same generous cap.
var MAX_MEMBERS = 999;
var SERVER_VERSION = "5.0.0";
// Sync history: how many previous catalog versions to keep per group (Dave, 2026-09-14).
// Snapshots are small JSON blobs and KV is cheap, so 10 is generous for the real use
// case — "someone wrecked the family catalog, put it back".
var HISTORY_KEEP = 10;
// The app appends a pseudo-entry carrying synced settings to every publish. It is
// not an app, so counting it would make the history read "4 apps" to someone who
// has three. Counted honestly here rather than in the client, so any client gets
// the same number.
var SYNC_SETTINGS_ID = "__nashub_settings__";
function realAppCount(apps) {
  return Array.isArray(apps) ? apps.filter((a) => a && a.id !== SYNC_SETTINGS_ID).length : 0;
}
__name(realAppCount, "realAppCount");
var CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randChars(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b).map((x) => CHARS[x % CHARS.length]).join("");
}
__name(randChars, "randChars");
function generateSyncCode() {
  return `${randChars(3)}-${randChars(3)}`;
}
__name(generateSyncCode, "generateSyncCode");
function generateToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "sk_" + Array.from(b).map((x) => x.toString(36)).join("").slice(0, 32);
}
__name(generateToken, "generateToken");
async function hashStr(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashStr, "hashStr");
// Kept as one function so every endpoint answers with the same numbers. "open" is the
// only tier; the field stays in responses because the app shows the member cap.
function tierLimits() {
  return { maxMembers: MAX_MEMBERS, tier: "open" };
}
__name(tierLimits, "tierLimits");
async function groupLimits() {
  return tierLimits();
}
__name(groupLimits, "groupLimits");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Device-Name, X-License-Key"   // last one: still sent by app versions before 5.0.0, ignored here
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
__name(json, "json");
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
__name(err, "err");
async function handleCreate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const limits = tierLimits();
  let code;
  for (let i = 0; i < 10; i++) {
    code = generateSyncCode();
    if (!await env.SYNC_KV.get(`group:${code}`)) break;
    if (i === 9) return err("Could not generate unique code", 500);
  }
  const adminToken = generateToken();
  const adminTokenHash = await hashStr(adminToken);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const group = {
    code,
    name: body.name || "My NAS Hub",
    apps: body.apps || [],
    version: 1,
    adminTokenHash,
    created: now,
    updated: now,
    tier: limits.tier,
    maxMembers: limits.maxMembers
  };
  const ttl = 60 * 60 * 24 * 400;
  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: ttl });
  return json({ code, adminToken, version: 1, tier: limits.tier, maxMembers: limits.maxMembers });
}
__name(handleCreate, "handleCreate");
// Security audit 2026-11-07: a 6-character group code could be guessed with no limit, and a
// right guess joins the roster (and can use up a free group's seats). Only WRONG guesses are
// counted, so a normal join costs no extra KV write. 20 misses per IP per hour.
var GUESS_MAX = 20;
async function handleGet(request, env, code) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const guessKey = `rl:guess:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) {
    const misses = parseInt(await env.SYNC_KV.get(guessKey) || "0", 10);
    if (misses >= GUESS_MAX) return err("Too many wrong group codes from here. Try again in an hour.", 429);
    await env.SYNC_KV.put(guessKey, String(misses + 1), { expirationTtl: 7200 });
    return err("Group not found", 404);
  }
  if (parseInt(await env.SYNC_KV.get(guessKey) || "0", 10) >= GUESS_MAX) return err("Too many wrong group codes from here. Try again in an hour.", 429);
  const group = JSON.parse(raw);
  const deviceId = request.headers.get("X-Device-Id");
  const deviceName = request.headers.get("X-Device-Name") || "Unknown device";
  if (deviceId) {
    // The roster lives on the group record, not in a KV list(). list() is eventually
    // consistent by well over a minute — measured 2026-09-14: a device that had just
    // joined was absent from the admin's members screen, and promoting somebody
    // requires seeing them first, so the admin could not act on a device that was
    // demonstrably talking to us. An index we write ourselves is immediately correct.
    // list() is still used by handleDelete, where a minute of lag costs nothing.
    group.roster = Array.isArray(group.roster) ? group.roster : [];
    const alreadyMember = group.roster.includes(deviceId);
    const lim = await groupLimits(env, group);
    group.tier = lim.tier;
    group.maxMembers = lim.maxMembers;
    if (!alreadyMember && group.roster.length >= lim.maxMembers) {
      return err(`Member limit reached (${lim.maxMembers}).`, 403);
    }
    const prevRaw = await env.SYNC_KV.get(`member:${code}:${deviceId}`);
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    // Each device gets a member token the first time it registers, returned once in
    // this very response and stored hashed. It is what an "editor" later publishes
    // with — issuing it at join means promoting someone is a single admin action
    // with nothing to hand over. Never re-issued on later polls: a device that
    // loses it needs the admin to reset it, which is the safer failure.
    let issuedToken = null;
    let tokenHash = prev?.tokenHash || null;
    if (!tokenHash) {
      issuedToken = generateToken();
      tokenHash = await hashStr(issuedToken);
    }
    const member = {
      lastSeen: (/* @__PURE__ */ new Date()).toISOString(),
      lastVersion: group.version,
      deviceName,
      role: prev?.role === "editor" ? "editor" : "viewer",
      tokenHash
    };
    // KV budget (2026-11-03): every device polls every 15 minutes, and rewriting its
    // member record each time (just to move lastSeen) was ~96 writes a day per device.
    // Now it is written when something changed, or when lastSeen is an hour old.
    const seenAge = prev && prev.lastSeen ? Date.now() - Date.parse(prev.lastSeen) : Infinity;
    const changed = !prev || issuedToken || prev.deviceName !== member.deviceName ||
      prev.lastVersion !== member.lastVersion || prev.role !== member.role || prev.tokenHash !== member.tokenHash;
    if (changed || !(seenAge < 60 * 60 * 1000)) {
      await env.SYNC_KV.put(`member:${code}:${deviceId}`, JSON.stringify(member), { expirationTtl: 60 * 60 * 24 * 400 });
    }
    if (!alreadyMember) {
      group.roster.push(deviceId);
      await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
    }
    return json({
      apps: group.apps,
      version: group.version,
      name: group.name,
      updated: group.updated,
      tier: lim.tier,
      role: member.role,
      ...(issuedToken ? { memberToken: issuedToken } : {})
    });
  }
  return json({ apps: group.apps, version: group.version, name: group.name, updated: group.updated, tier: (await groupLimits(env, group)).tier });
}
__name(handleGet, "handleGet");
// Publish is allowed for the group admin, or for a member the admin has promoted
// to editor. Returns {ok, group, by} or {error}.
async function authorizePublisher(request, env, code) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { error: err("Unauthorized", 401) };
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return { error: err("Group not found", 404) };
  const group = JSON.parse(raw);
  const presented = await hashStr(auth.slice(7));
  if (presented === group.adminTokenHash) return { group, by: "admin" };
  // Not the admin — try it as a member token. The device id names which member
  // record to check, so a token alone is not enough.
  const deviceId = request.headers.get("X-Device-Id");
  if (deviceId) {
    const mRaw = await env.SYNC_KV.get(`member:${code}:${deviceId}`);
    if (mRaw) {
      const m = JSON.parse(mRaw);
      if (m.tokenHash && m.tokenHash === presented) {
        // Role is read at publish time, never trusted from the client, so demoting
        // someone takes effect on their very next attempt.
        if (m.role !== "editor") return { error: err("This device has view-only access to the group", 403) };
        return { group, by: m.deviceName || "a member", deviceId };
      }
    }
  }
  return { error: err("Invalid admin token", 403) };
}
__name(authorizePublisher, "authorizePublisher");
async function handlePublish(request, env, code) {
  const { group, by, error } = await authorizePublisher(request, env, code);
  if (error) return error;
  let body;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  // Optimistic concurrency. More than one admin device is a supported setup — the
  // same person with a phone and a laptop — but until now a publish overwrote
  // whatever was on the server without looking, so the second device to save
  // silently destroyed the first one's work. Measured, not theorised: a phone
  // reopening on 2026-09-24 took the group from 14 apps back to 6.
  // A client that tells us which version it edited from gets a 409 instead of
  // winning, and resolves it by merging. Clients too old to send baseVersion keep
  // the old behaviour rather than breaking.
  if (body.baseVersion != null) {
    const base = Number(body.baseVersion), cur = Number(group.version || 0);
    if (Number.isFinite(base) && base !== cur) {
      return json({
        error: "This group was changed on another device",
        conflict: true,
        serverVersion: cur,
        yourVersion: base
      }, 409);
    }
  }
  // Snapshot the state we are ABOUT TO REPLACE — order matters, snapshotting after
  // the assignment would just store a copy of the incoming catalog and history
  // would be useless.
  await snapshotVersion(env, code, group);
  group.apps = body.apps;
  group.version = (group.version || 0) + 1;
  group.updated = (/* @__PURE__ */ new Date()).toISOString();
  group.lastPublishedBy = by;
  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ version: group.version, updated: group.updated, by });
}
__name(handlePublish, "handlePublish");
// ── Sync history ────────────────────────────────────────────────────────────
// Design note, learned the hard way on the first deploy: KV's list() is eventually
// consistent and lagged well over a minute behind writes, so a history built by
// listing gver:* keys showed one entry when three existed — and the entry you most
// need after wrecking a catalog is the newest one, exactly the one list() hides.
// So the INDEX lives inside the group record: one key, written in the same put()
// that already saves the group, therefore always consistent with it. The snapshot
// BODIES stay in their own keys so the members' poll path doesn't have to read
// them. list() is never used for reads — pruning deletes exactly the key whose
// entry fell off the end of the index.
var VER_TTL = 60 * 60 * 24 * 400;
function verKey(code, v) {
  return `gver:${code}:${String(v).padStart(6, "0")}`;
}
__name(verKey, "verKey");
// Mutates group.history. Caller is responsible for persisting the group afterwards.
async function snapshotVersion(env, code, group) {
  const v = group.version || 0;
  if (!v || !Array.isArray(group.apps)) return;
  await env.SYNC_KV.put(verKey(code, v), JSON.stringify({
    version: v,
    apps: group.apps,
    name: group.name,
    updated: group.updated
  }), { expirationTtl: VER_TTL });
  const hist = Array.isArray(group.history) ? group.history : [];
  hist.push({
    version: v,
    appCount: realAppCount(group.apps),
    name: group.name,
    updated: group.updated,
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  // Drop the oldest beyond HISTORY_KEEP and delete their bodies. A failed delete
  // only leaves an orphan that expires on its own TTL — it must never fail the
  // publish, because losing someone's catalog to housekeeping would be far worse.
  while (hist.length > HISTORY_KEEP) {
    const dropped = hist.shift();
    try {
      await env.SYNC_KV.delete(verKey(code, dropped.version));
    } catch (e) {
    }
  }
  group.history = hist;
}
__name(snapshotVersion, "snapshotVersion");
// Admin check shared by the two history endpoints.
async function requireAdmin(request, env, code) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { error: err("Unauthorized", 401) };
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return { error: err("Group not found", 404) };
  const group = JSON.parse(raw);
  if (await hashStr(auth.slice(7)) !== group.adminTokenHash) return { error: err("Invalid admin token", 403) };
  // Any successful admin action means the owner still exists. Recovery keys off
  // this, so it has to be stamped somewhere — throttled to an hour so that
  // polling the members screen does not write to KV on every refresh.
  const now = Date.now();
  if (!group.lastAdminAt || now - Date.parse(group.lastAdminAt) > 36e5) {
    group.lastAdminAt = new Date(now).toISOString();
    await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  }
  return { group };
}
__name(requireAdmin, "requireAdmin");
// The group owner can list earlier versions and restore any of them.
async function handleHistory(request, env, code) {
  const { group, error } = await requireAdmin(request, env, code);
  if (error) return error;
  const limits = tierLimits();
  const hist = Array.isArray(group.history) ? group.history : [];
  return json({
    current: group.version,
    keep: HISTORY_KEEP,
    canRestore: true,
    tier: limits.tier,
    restoredFrom: group.restoredFrom || null,
    versions: hist.slice().reverse()
  });
}
__name(handleHistory, "handleHistory");
async function handleRestore(request, env, code) {
  const { group, error } = await requireAdmin(request, env, code);
  if (error) return error;
  let body;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const target = parseInt(body.version, 10);
  if (!target) return err('Which version? Send {"version": n}');
  const raw = await env.SYNC_KV.get(verKey(code, target));
  if (!raw) return err(`Version ${target} is no longer kept (the last ${HISTORY_KEEP} are)`, 404);
  const snap = JSON.parse(raw);
  // A restore moves FORWARD to a new version rather than rewinding the counter:
  // members poll on version, so a rewind would look like "nothing changed" and the
  // restore would never reach anyone's phone. It also means the state being undone
  // is itself snapshotted first, so a mistaken restore can be undone.
  await snapshotVersion(env, code, group);
  group.apps = snap.apps;
  group.version = (group.version || 0) + 1;
  group.updated = (/* @__PURE__ */ new Date()).toISOString();
  group.restoredFrom = target;
  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: VER_TTL });
  return json({
    version: group.version,
    restoredFrom: target,
    appCount: realAppCount(group.apps),
    updated: group.updated
  });
}
__name(handleRestore, "handleRestore");
// Admin sets a member to "editor" (can publish) or "viewer" (read-only).
async function handleMemberRole(request, env, code) {
  const { group, error } = await requireAdmin(request, env, code);
  if (error) return error;
  let body;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const deviceId = String(body.deviceId || "");
  const role = body.role === "editor" ? "editor" : "viewer";
  if (!deviceId) return err('Which member? Send {"deviceId": "...", "role": "editor|viewer"}');
  const key = `member:${code}:${deviceId}`;
  const mRaw = await env.SYNC_KV.get(key);
  if (!mRaw) return err("That device is not a member of this group", 404);
  const m = JSON.parse(mRaw);
  m.role = role;
  await env.SYNC_KV.put(key, JSON.stringify(m), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ deviceId, role, deviceName: m.deviceName || null });
}
__name(handleMemberRole, "handleMemberRole");
async function handleMembers(request, env, code) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return err("Unauthorized", 401);
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);
  if (await hashStr(auth.slice(7)) !== group.adminTokenHash) return err("Invalid admin token", 403);
  // Prefer the roster on the group record — it is correct the instant a device
  // registers. Groups created before the roster existed have none, so fall back to
  // list() once and write the result back, healing them on first view.
  let ids = Array.isArray(group.roster) ? group.roster : null;
  if (!ids) {
    const list = await env.SYNC_KV.list({ prefix: `member:${code}:` });
    ids = list.keys.map((k) => k.name.split(":")[2]).filter(Boolean);
    group.roster = ids;
    await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  }
  const members = [];
  const alive = [];
  for (const deviceId of ids) {
    const m = await env.SYNC_KV.get(`member:${code}:${deviceId}`);
    // A member record can expire (400 days) while the id lingers in the roster.
    // Drop it rather than showing a device that no longer exists.
    if (!m) continue;
    alive.push(deviceId);
    // Whitelist rather than spread: the member record now holds a token hash, and
    // spreading it would ship that to the client for no reason.
    const rec = JSON.parse(m);
    members.push({
      deviceId,
      deviceName: rec.deviceName,
      lastSeen: rec.lastSeen,
      lastVersion: rec.lastVersion,
      role: rec.role === "editor" ? "editor" : "viewer"
    });
  }
  if (alive.length !== ids.length) {
    group.roster = alive;
    await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  }
  const mlim = await groupLimits(env, group);
  return json({ members, version: group.version, name: group.name, appCount: realAppCount(group.apps), tier: mlim.tier, maxMembers: mlim.maxMembers,
    ...(group.recoveredAt ? { recoveredAt: group.recoveredAt, recoveredBy: group.recoveredBy, recoveredVia: group.recoveredVia } : {}) });
}
__name(handleMembers, "handleMembers");
async function handleDelete(request, env, code) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return err("Unauthorized", 401);
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);
  if (await hashStr(auth.slice(7)) !== group.adminTokenHash) return err("Invalid admin token", 403);
  await env.SYNC_KV.delete(`group:${code}`);
  const list = await env.SYNC_KV.list({ prefix: `member:${code}:` });
  for (const key of list.keys) await env.SYNC_KV.delete(key.name);
  return json({ deleted: true });
}
__name(handleDelete, "handleDelete");
// ── Ownership transfer ──────────────────────────────────────────────────────
// The admin token is handed out once at group creation and lives only in that
// device's localStorage. Before this, that meant ownership could never move and
// a lost device orphaned the group permanently — every member frozen on the last
// thing it published, with no way back. (Found on Dave's own group, 2026-09-16.)
//
// Transfer is a two-step claim so the token is never sent to a device that has
// not proved anything: the current admin asks for a short-lived claim code, and
// the new device redeems it. Redeeming ROTATES the admin token, which is also
// the revocation — the old device's stored token stops matching immediately, so
// "transfer" really transfers rather than quietly granting a second key.
var XFER_TTL = 60 * 15;
function generateClaimCode() {
  return `${randChars(4)}-${randChars(4)}`;
}
__name(generateClaimCode, "generateClaimCode");

async function handleTransferStart(request, env, code) {
  const { group, error } = await requireAdmin(request, env, code);
  if (error) return error;
  const claimCode = generateClaimCode();
  // Stored by hash: a leaked KV listing must not hand somebody the group.
  await env.SYNC_KV.put(
    `xfer:${code}:${await hashStr(claimCode)}`,
    JSON.stringify({ created: new Date().toISOString() }),
    { expirationTtl: XFER_TTL }
  );
  return json({ claimCode, expiresInSeconds: XFER_TTL, group: group.name });
}
__name(handleTransferStart, "handleTransferStart");

async function handleTransferClaim(request, env, code) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const claimCode = String(body.claimCode || "").trim().toUpperCase();
  if (!claimCode) return err('Which code? Send {"claimCode": "XXXX-XXXX"}');

  const key = `xfer:${code}:${await hashStr(claimCode)}`;
  const pending = await env.SYNC_KV.get(key);
  // Same message whether the code is wrong or expired: telling them which one
  // they got right is a hint worth not giving.
  if (!pending) return err("That transfer code is not valid, or it has expired. Ask the current owner for a new one.", 403);

  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);

  const adminToken = generateToken();
  group.adminTokenHash = await hashStr(adminToken);
  group.ownerChanged = new Date().toISOString();

  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  await env.SYNC_KV.delete(key); // single use

  const tlim = await groupLimits(env, group);
  return json({
    adminToken,
    code,
    name: group.name,
    version: group.version,
    tier: tlim.tier,
    maxMembers: tlim.maxMembers
  });
}
__name(handleTransferClaim, "handleTransferClaim");

async function handleTransferCancel(request, env, code) {
  const { error } = await requireAdmin(request, env, code);
  if (error) return error;
  const list = await env.SYNC_KV.list({ prefix: `xfer:${code}:` });
  for (const k of list.keys) await env.SYNC_KV.delete(k.name);
  return json({ cancelled: list.keys.length });
}
__name(handleTransferCancel, "handleTransferCancel");


// ── NAS bridge (the push model) ─────────────────────────────────────────────
// Measured 2026-09-16 against a real TrueNAS 25.04: its REST API sends no CORS
// headers and answers an OPTIONS preflight with 405, so a browser on
// app.nashubapp.com cannot call it at all. The websocket API works, but an https
// page may only open wss://, and TrueNAS ships a self-signed cert no browser
// trusts. Three walls on one door — because the phone was reaching into the NAS.
//
// So the arrow is reversed. The NAS makes an OUTBOUND https call here with what
// it knows; the phone reads it from us, same origin as the app. No CORS, no mixed
// content, no certificates, no DNS, no Tailscale, no domain. Outbound https from
// a NAS is never the thing that is blocked. Synology, Home Assistant and UniFi
// all work this way; nobody makes the phone talk to the box.
var NAS_TTL = 60 * 10;          // a report older than this is stale, not truth
var NAS_MAX_BYTES = 128 * 1024; // a catalogue, not a log file

// The agent gets its own credential, never the admin token: it lives in a cron
// line on a NAS and must not be able to publish the catalogue or move ownership.
async function handleNasToken(request, env, code) {
  const { group, error } = await requireAdmin(request, env, code);
  if (error) return error;
  const agentToken = generateToken();
  group.agentTokenHash = await hashStr(agentToken);
  group.agentIssued = new Date().toISOString();
  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ agentToken, code });
}
__name(handleNasToken, "handleNasToken");

async function handleNasPush(request, env, code) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return err("Unauthorized", 401);
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);
  if (!group.agentTokenHash) return err("No agent token has been issued for this group", 403);
  if (await hashStr(auth.slice(7)) !== group.agentTokenHash) return err("Invalid agent token", 403);

  const body = await request.text();
  if (body.length > NAS_MAX_BYTES) return err("Report too large", 413);
  let data;
  try { data = JSON.parse(body); } catch { return err("Invalid JSON"); }

  // Keep only what the app renders. The agent may be a one-line cron piping raw
  // midclt output, so it is not to be trusted to send a tidy shape.
  const apps = Array.isArray(data.apps) ? data.apps.slice(0, 200).map((a) => ({
    id: String(a.id || a.name || "").slice(0, 80),
    name: String(a.name || a.id || "").slice(0, 80),
    state: String(a.state || "").slice(0, 20),
    portals: a.portals && typeof a.portals === "object" ? a.portals : undefined,
    active_workloads: a.active_workloads && typeof a.active_workloads === "object"
      ? { used_ports: Array.isArray(a.active_workloads.used_ports) ? a.active_workloads.used_ports.slice(0, 20) : [] }
      : undefined
  })) : [];
  // Capacity comes through as numbers or not at all: the app warns on a pool
  // filling up, and a string "12345" or a NaN would silently disable that. ZFS
  // reports these as strings in some versions, hence Number() rather than a
  // typeof check.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  const pools = Array.isArray(data.pools) ? data.pools.slice(0, 20).map((p) => ({
    name: String(p.name || "").slice(0, 60),
    status: String(p.status || "").slice(0, 20),
    healthy: typeof p.healthy === "boolean" ? p.healthy : undefined,
    free: num(p.free),
    allocated: num(p.allocated),
    size: num(p.size)
  })) : [];
  const info = data.info && typeof data.info === "object" ? {
    hostname: String(data.info.hostname || "").slice(0, 80),
    version: String(data.info.version || "").slice(0, 60),
    uptime: String(data.info.uptime || "").slice(0, 60)
  } : null;

  const report = { info, apps, pools, ts: new Date().toISOString(), agent: String(data.agent || "").slice(0, 40) };
  await env.SYNC_KV.put(`nas:${code}`, JSON.stringify(report), { expirationTtl: NAS_TTL });
  return json({ ok: true, apps: apps.length, pools: pools.length, ttl: NAS_TTL });
}
__name(handleNasPush, "handleNasPush");

async function handleNasGet(request, env, code) {
  const raw = await env.SYNC_KV.get(`nas:${code}`);
  // Absent means either nothing has ever pushed or the last report aged out.
  // Both are "we do not know right now", which the app must say rather than
  // showing yesterday's states as though they were current.
  if (!raw) return json({ present: false, ttl: NAS_TTL });
  const report = JSON.parse(raw);
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(report.ts).getTime()) / 1000));
  return json({ present: true, ageSeconds, stale: ageSeconds > NAS_TTL, ...report });
}
__name(handleNasGet, "handleNasGet");


// ── Recovering a group whose owner is gone ──────────────────────────────────
// Transfer (above) needs a LIVING owner to hand the group over. That leaves the
// case it cannot touch: the device that created the group is lost, wiped, or its
// browser storage cleared. The raw admin token existed only there, so the group
// was orphaned permanently — every member frozen on the last thing that was
// published, unable even to promote each other, because promotion needs admin
// auth.
//
// One way back in, requiring proof rather than just the group code:
//
//   MEMBER   — a device already IN the group, proving it with the member token
//              issued once at registration, can take over IF the owner has shown
//              no sign of life for RECOVERY_DORMANT_DAYS. Knowing the code is not
//              enough; you must be a device that actually joined.
//
// Recovery rotates the admin token, so if the old owner does come back its next
// action fails with the "ownership was transferred" message the app already
// handles. And the takeover is recorded on the group and shown to everyone —
// a wrongful one should be visible, not silent.
var RECOVERY_DORMANT_DAYS = 7;

function daysSince(iso) {
  const t = Date.parse(iso || "");
  return isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : Infinity;
}
// The most recent sign the owner is alive: an admin action, or failing that the
// last publish. Old groups have no lastAdminAt, so `updated` carries them.
function ownerIdleDays(group) {
  return Math.min(daysSince(group.lastAdminAt), daysSince(group.updated));
}

// ── Web Push, from first principles ─────────────────────────────────────────
//
// A notification has to reach a phone that is asleep with the app closed, which
// rules out anything the app itself does. That means the Push API, and the Push
// API means the worker has to speak RFC 8291 (message encryption), RFC 8188
// (aes128gcm content coding) and RFC 8292 (VAPID) by hand: there is no npm in a
// Worker, and pulling a library in would be a lot of unread code holding the
// keys to everyone's phone.
//
// The shape of it: the browser hands us an endpoint URL plus two keys — p256dh,
// its ECDH public key, and auth, 16 bytes of shared secret. We make a throwaway
// keypair, agree a secret with theirs, mix in auth and both public keys, and
// derive an AES-128-GCM key and nonce. The push service forwards the ciphertext
// without being able to read it, which is the entire point.
//
// Everything here is WebCrypto, which Workers and Node both have.

var PUSH_TTL = 6 * 3600;   // how long the push service should hold an undelivered one

function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - b64.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64urlToBytes, "b64urlToBytes");

function bytesToB64url(b) {
  let s = "";
  const a = new Uint8Array(b);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bytesToB64url, "bytesToB64url");

function concatBytes(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
__name(concatBytes, "concatBytes");

async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
__name(hmac, "hmac");

// HKDF as RFC 8291 uses it: always one 32-byte block, so expand is a single
// HMAC over info||0x01 rather than the general loop.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const out = await hmac(prk, concatBytes(info, new Uint8Array([1])));
  return out.slice(0, length);
}
__name(hkdf, "hkdf");

var UTF8 = new TextEncoder();

/**
 * RFC 8291 §3.4. Returns the aes128gcm body ready to POST.
 * p256dh / auth are the base64url strings the browser's PushSubscription gives.
 */
async function encryptPush(payloadStr, p256dhB64, authB64, fixedSalt, fixedServerKeys) {
  const uaPublic = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);
  const salt = fixedSalt || crypto.getRandomValues(new Uint8Array(16));

  const serverKeys = fixedServerKeys || await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));

  // The auth secret is what stops the push service, which sees the endpoint and
  // both public keys, from deriving the same key we just did.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concatBytes(UTF8.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concatBytes(keyInfo, new Uint8Array([1])));

  const cek = await hkdf(salt, ikm, UTF8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, UTF8.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 is the last-record delimiter from RFC 8188. One record, so it is the
  // only one, and there is no padding to speak of.
  const plaintext = concatBytes(UTF8.encode(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));

  // Header: salt(16) | record size(4, big-endian) | key id length(1) | key id
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, ciphertext);
}
__name(encryptPush, "encryptPush");

// VAPID (RFC 8292): an ES256 JWT proving the sender is who the subscription was
// issued to, so a stolen endpoint cannot be used by anyone else.
async function vapidAuth(endpoint, env, nowSec) {
  const priv = env.VAPID_PRIVATE_KEY, pub = env.VAPID_PUBLIC_KEY;
  if (!priv || !pub) throw new Error("VAPID keys are not configured on this worker");
  const aud = new URL(endpoint).origin;
  const now = nowSec || Math.floor(Date.now() / 1000);
  const header = bytesToB64url(UTF8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(UTF8.encode(JSON.stringify({
    aud, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com"
  })));
  const signingInput = UTF8.encode(header + "." + body);

  // The private key is stored as the raw 32-byte scalar, base64url. Rebuilt into
  // a JWK here with the public point, because WebCrypto will not import a bare d.
  const d = b64urlToBytes(priv);
  const pubBytes = b64urlToBytes(pub);          // 65 bytes, 0x04 || X || Y
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    d: bytesToB64url(d),
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65))
  };
  const key = await crypto.subtle.importKey("jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, signingInput));
  const jwt = header + "." + body + "." + bytesToB64url(sig);
  return "vapid t=" + jwt + ", k=" + pub;
}
__name(vapidAuth, "vapidAuth");

/**
 * Returns { ok, status, gone }. `gone` means the subscription is dead and should
 * be dropped — a push service answering 404 or 410 is telling us the browser
 * threw the subscription away, and retrying it forever is how a worker ends up
 * burning its whole cron budget on someone's old phone.
 */
async function sendPush(sub, payloadObj, env) {
  try {
    const body = await encryptPush(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(PUSH_TTL),
        "Urgency": payloadObj.critical ? "high" : "normal",
        "Authorization": await vapidAuth(sub.endpoint, env)
      },
      body
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e && e.message || e) };
  }
}
__name(sendPush, "sendPush");

// ── Down alerts: the decision engine ────────────────────────────────────────
//
// Dave cut this feature on 2026-09-13: "I'd get multiple alerts a day, I don't
// trust the down/not-down on the app." That was a bug report about the HTTP
// probe, and the probe is no longer what decides: the NAS itself reports
// RUNNING / STOPPED / CRASHED through the bridge. But being right about the
// state is only half of it. An alert that fires whenever something is wrong is
// still useless, because most of what is wrong at any moment is either already
// known, about to fix itself, or not actually about the thing it names.
//
// So everything below exists to NOT send an alert:
//
//   1. Transitions only. Alert when something goes bad, never while it stays
//      bad. A container that has been stopped for a week is not news.
//   2. Confirm twice. One bad report is a scrape, not an outage. The bridge
//      pushes every ~5 minutes, so a real outage costs ≤10 minutes of latency,
//      which is a fair price for never crying wolf.
//   3. Blame the NAS, not the apps. Several apps going down in the same tick is
//      one event — a reboot, a pool going away, an update. Sending five
//      notifications for one event is exactly what made this unbearable.
//   4. Cooldowns. A flapping container gets one alert every six hours.
//   5. Silence is its own alert, and it silences everything else. If the NAS
//      stops reporting we say so once — and evaluate no app states at all,
//      because the last report is stale and stale data must never produce an
//      alert about what is happening now.
//   6. Nothing on the first tick. Turning alerts on must not fire a notification
//      for everything already down; the first pass only records.
//
// This function is pure — no KV, no fetch, no Date.now() — so it can be tested
// against a decade of made-up outages in a second, which is the only way to have
// any confidence in rules whose whole job is to stay quiet.

// Three, not two, and the difference is the whole feature. Simulated a month of
// a NAS with nothing actually wrong — 8 apps, 8928 five-minute reports — and
// counted alerts, which are false alarms by construction. 20 seeds each:
//
//   feed noise:        0.5%      1.5%       3%        6%
//   confirm 2:      1.7/mo    14.8/mo   60.9/mo   195.8/mo
//   confirm 3:      0.0/mo     0.1/mo    1.5/mo    13.6/mo
//   confirm 4:      0.0/mo     0.0/mo    0.1/mo     1.1/mo
//
// Confirm 2 is unusable the moment the feed is anything but perfect, and nothing
// has ever pushed from a real NAS, so we do not know what its noise floor is.
// Three costs 15 minutes of latency instead of 10 — irrelevant for a home NAS —
// and survives a feed 6x noisier than seems plausible. If reality turns out
// worse than 3%, 4 is the dial to turn; it caught all three scripted outages in
// the same simulation, including a 20-minute one.
//
// (The first run of this measurement reported a flat zero for confirm 3 at 3%,
// against a theoretical ~2. That was an LCG whose lattice structure made three
// draws 8 apart never all land under 3%. Swapped for mulberry32, which now
// matches theory. A very convincing wrong answer, caught only by checking it
// against the arithmetic.)
var ALERT_CONFIRM = 3;              // consecutive bad reports before believing it
var ALERT_APP_COOLDOWN_MS = 6 * 3600 * 1000;
var ALERT_POOL_COOLDOWN_MS = 24 * 3600 * 1000;
var ALERT_SILENCE_MS = 20 * 60 * 1000;   // no report for this long = the NAS is gone
var ALERT_COALESCE_AT = 3;          // this many at once is one event, not N events
var BAD_STATES = ["STOPPED", "CRASHED", "FAILED", "ERROR"];

function isBadState(s) {
  return BAD_STATES.includes(String(s || "").toUpperCase());
}
__name(isBadState, "isBadState");

function inQuietHours(now, quiet, tzOffsetMin) {
  if (!quiet || quiet.from == null || quiet.to == null) return false;
  const local = new Date(now - (tzOffsetMin || 0) * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const from = quiet.from, to = quiet.to;
  return from <= to ? (mins >= from && mins < to) : (mins >= from || mins < to);
}
__name(inQuietHours, "inQuietHours");

/**
 * prev   previous alert state, or null on the very first tick
 * report the last NAS report ({ ts, apps, pools }) or null if nothing is stored
 * now    milliseconds
 * cfg    { watch: [appId]|null, quiet: {from,to}|null, tzOffsetMin, quietCoversHardware }
 * returns { alerts: [{kind, tag, title, body, critical}], state }
 */
function decideAlerts(prev, report, now, cfg) {
  cfg = cfg || {};
  const state = {
    apps: {},
    pools: (prev && prev.pools) || {},
    silentAlertedAt: (prev && prev.silentAlertedAt) || null,
    lastReportTs: (prev && prev.lastReportTs) || null,
    firstTickDone: !!(prev && prev.firstTickDone),
    lastTick: now
  };
  const alerts = [];
  const first = !state.firstTickDone;
  const prevApps = (prev && prev.apps) || {};

  const reportTs = report && report.ts ? Date.parse(report.ts) : null;
  const age = reportTs ? now - reportTs : Infinity;

  // ── Rule 5: silence outranks everything ───────────────────────────────────
  if (!report || !reportTs || age > ALERT_SILENCE_MS) {
    // Carry app confirmation counters forward untouched. They describe the last
    // thing we actually knew, and we are deliberately learning nothing now.
    state.apps = prevApps;
    state.lastReportTs = reportTs || state.lastReportTs;
    state.firstTickDone = true;
    const everReported = !!(prev && prev.lastReportTs);
    if (!first && everReported && !state.silentAlertedAt) {
      state.silentAlertedAt = now;
      alerts.push({
        kind: "silent", tag: "nas-silent", critical: true,
        title: "Your NAS stopped reporting",
        body: "No report for " + Math.round(age / 60000) + " minutes. Either the NAS is off, the cron job stopped, or it has no route out. App alerts are paused until it is back."
      });
    }
    return { alerts, state };
  }
  // A report arrived, so any silence is over and can alert again next time.
  state.silentAlertedAt = null;
  state.lastReportTs = reportTs;
  state.firstTickDone = true;

  // ── Apps ──────────────────────────────────────────────────────────────────
  const watch = Array.isArray(cfg.watch) && cfg.watch.length ? new Set(cfg.watch) : null;
  const quiet = inQuietHours(now, cfg.quiet, cfg.tzOffsetMin);
  const newlyBad = [];
  for (const a of report.apps || []) {
    const id = String(a.id || a.name || "");
    if (!id) continue;
    if (watch && !watch.has(id)) continue;
    const was = prevApps[id] || {};
    const bad = isBadState(a.state);
    if (!bad) {
      // Recovered, or never down. Deliberately silent: an "all clear" for every
      // container that blipped is half the noise problem on its own.
      //
      // But the record is NOT dropped, and that matters more than it looks. The
      // first version deleted it, which reset the cooldown — so a container
      // flapping down-up-down-up alerted on every single cycle. Measured: 20
      // cycles, 20 notifications. That IS the "multiple alerts a day" Dave was
      // complaining about, rebuilt faithfully in new code. The cooldown has to
      // outlive the recovery or it is not a cooldown at all. Only the
      // confirmation counter resets.
      if (was.alertedAt && now - was.alertedAt < ALERT_APP_COOLDOWN_MS) {
        state.apps[id] = { state: "OK", seen: 0, alertedAt: was.alertedAt, name: was.name || id };
      }
      continue;
    }
    // Rule 2: the same bad state has to show up twice running.
    // On the very first tick everything already broken is recorded as ALREADY
    // PAST the crossing, not as the start of one. Otherwise turning alerts on
    // fires a notification two ticks later for every container that has been
    // stopped since June — which is the worst possible first impression of a
    // feature whose entire promise is that it stays quiet. If it recovers and
    // fails again later, that is a real transition and it will alert then.
    const seen = first
      ? ALERT_CONFIRM + 1
      : (was.state === String(a.state).toUpperCase() ? (was.seen || 0) : 0) + 1;
    const rec = { state: String(a.state).toUpperCase(), seen, alertedAt: was.alertedAt || null,
                  name: String(a.name || id) };
    state.apps[id] = rec;
    if (seen < ALERT_CONFIRM) continue;
    if (seen > ALERT_CONFIRM) continue;          // Rule 1: only on the crossing
    // Rule 4: and not if we already said so recently.
    if (rec.alertedAt && now - rec.alertedAt < ALERT_APP_COOLDOWN_MS) continue;
    newlyBad.push(rec);
  }

  if (newlyBad.length) {
    if (quiet) {
      // Suppressed, but still stamped as alerted. Holding them back to deliver a
      // pile at 7am is the same mistake in a trench coat.
      for (const r of newlyBad) r.alertedAt = now;
    } else if (newlyBad.length >= ALERT_COALESCE_AT) {
      // Rule 3. Five containers do not fail independently in the same minute.
      const host = (report.info && report.info.hostname) || "your NAS";
      const names = newlyBad.slice(0, 4).map((r) => r.name).join(", ");
      alerts.push({
        kind: "many", tag: "nas-many", critical: true,
        title: newlyBad.length + " apps stopped on " + host,
        body: names + (newlyBad.length > 4 ? " and " + (newlyBad.length - 4) + " more" : "") +
              ". That many at once is usually the NAS, a pool, or an update — not the apps."
      });
      for (const r of newlyBad) r.alertedAt = now;
    } else {
      for (const r of newlyBad) {
        alerts.push({
          kind: "app", tag: "app-" + r.name, critical: false,
          title: r.name + " " + (r.state === "CRASHED" ? "crashed" : "stopped"),
          body: r.state === "CRASHED"
            ? "Your NAS reports it as crashed. It will not come back on its own."
            : "Your NAS reports it as stopped."
        });
        r.alertedAt = now;
      }
    }
  }

  // ── Pools ─────────────────────────────────────────────────────────────────
  // The one thing worth waking someone for, so quiet hours do not cover it
  // unless the user says otherwise. Confirmation is not required: ZFS does not
  // report DEGRADED by accident, and the cost of being slow here is real.
  for (const p of report.pools || []) {
    const name = String(p.name || "");
    if (!name) continue;
    const status = String(p.status || "").toUpperCase();
    const unhealthy = status && status !== "ONLINE";
    const was = state.pools[name] || {};
    if (!unhealthy) { delete state.pools[name]; continue; }
    const same = was.status === status;
    const cooled = !was.alertedAt || now - was.alertedAt >= ALERT_POOL_COOLDOWN_MS;
    // Same reasoning as the apps above: a pool already degraded when alerts were
    // switched on is not news — the home screen has been shouting about it in red
    // all along. Stamping it as alerted means the 24-hour reminder still arrives.
    state.pools[name] = { status, alertedAt: first ? now : (was.alertedAt || null) };
    if (first) continue;
    if (same && !cooled) continue;
    if (quiet && cfg.quietCoversHardware) { state.pools[name].alertedAt = now; continue; }
    alerts.push({
      kind: "pool", tag: "pool-" + name, critical: true,
      title: "Pool " + name + " is " + status,
      body: status === "DEGRADED"
        ? "A disk has failed or dropped out. Your data is still there, but there is no redundancy left to lose — replace the drive before a second one goes."
        : "This pool is not healthy. Open TrueNAS → Storage before writing anything else to it."
    });
    state.pools[name].alertedAt = now;
  }

  // Rule 6: the first tick only learns.
  if (first) return { alerts: [], state };
  return { alerts, state };
}
__name(decideAlerts, "decideAlerts");

// ── Down alerts: storage, subscriptions and the cron tick ───────────────────
//
// Everything about a group's alerts lives in one key, `alerts:<code>`:
//   subs  { deviceId -> {endpoint, p256dh, auth, name, addedAt} }
//   prefs { watch, quiet, tzOffsetMin, quietCoversHardware }
//   state  whatever decideAlerts() handed back last tick
//
// The cron has to know WHICH groups to look at without a KV list(), which lags
// writes by over a minute and would mean a device could enable alerts and get
// nothing for the first few ticks. So subscribing adds the code to a small index
// key, exactly as the members roster does.

var ALERT_INDEX_KEY = "alert-index";
var ALERT_TTL = 60 * 60 * 24 * 400;
var ALERT_MAX_SUBS = 10;          // devices per group
var ALERT_CRON_BUDGET = 60;       // groups per tick, so one huge account cannot starve the rest

async function loadAlerts(env, code) {
  const raw = await env.SYNC_KV.get(`alerts:${code}`);
  return raw ? JSON.parse(raw) : { subs: {}, prefs: {}, state: null };
}
__name(loadAlerts, "loadAlerts");

async function saveAlerts(env, code, rec) {
  await env.SYNC_KV.put(`alerts:${code}`, JSON.stringify(rec), { expirationTtl: ALERT_TTL });
}
__name(saveAlerts, "saveAlerts");

async function alertIndex(env) {
  const raw = await env.SYNC_KV.get(ALERT_INDEX_KEY);
  const a = raw ? JSON.parse(raw) : [];
  return Array.isArray(a) ? a : [];
}
__name(alertIndex, "alertIndex");

async function setAlertIndex(env, codes) {
  await env.SYNC_KV.put(ALERT_INDEX_KEY, JSON.stringify(codes.slice(0, 5000)));
}
__name(setAlertIndex, "setAlertIndex");

// A member token or the admin token both qualify: anyone trusted enough to see
// the catalog is trusted enough to be told when it breaks. Returns the deviceId.
async function requireMemberOrAdmin(request, env, code) {
  const auth = request.headers.get("Authorization") || "";
  const deviceId = request.headers.get("X-Device-Id") || "";
  if (!auth.startsWith("Bearer ")) return { error: err("Unauthorized", 401) };
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return { error: err("Group not found", 404) };
  const group = JSON.parse(raw);
  const hash = await hashStr(auth.slice(7));
  if (hash === group.adminTokenHash) return { group, deviceId, admin: true };
  if (!deviceId) return { error: err("Missing X-Device-Id", 400) };
  const mRaw = await env.SYNC_KV.get(`member:${code}:${deviceId}`);
  if (!mRaw) return { error: err("Not a member of this group", 403) };
  if (JSON.parse(mRaw).tokenHash !== hash) return { error: err("Invalid member token", 403) };
  return { group, deviceId, admin: false };
}
__name(requireMemberOrAdmin, "requireMemberOrAdmin");

function sanitizePrefs(p) {
  p = p && typeof p === "object" ? p : {};
  const out = {};
  if (Array.isArray(p.watch)) out.watch = p.watch.slice(0, 200).map((x) => String(x).slice(0, 80));
  const n = (v) => (Number.isInteger(v) && v >= 0 && v < 1440 ? v : null);
  if (p.quiet && n(p.quiet.from) !== null && n(p.quiet.to) !== null) {
    out.quiet = { from: p.quiet.from, to: p.quiet.to };
  }
  if (Number.isInteger(p.tzOffsetMin) && Math.abs(p.tzOffsetMin) <= 900) out.tzOffsetMin = p.tzOffsetMin;
  if (typeof p.quietCoversHardware === "boolean") out.quietCoversHardware = p.quietCoversHardware;
  return out;
}
__name(sanitizePrefs, "sanitizePrefs");

async function handleAlertsGet(request, env, code) {
  const { group, deviceId, error } = await requireMemberOrAdmin(request, env, code);
  if (error) return error;
  const rec = await loadAlerts(env, code);
  return json({
    tier: tierLimits().tier,
    subscribed: !!rec.subs[deviceId],
    devices: Object.keys(rec.subs).length,
    maxDevices: ALERT_MAX_SUBS,
    prefs: rec.prefs || {},
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    // What the last tick actually knew, so the settings screen can say "watching
    // 8 apps, last report 2 min ago" rather than claiming it works and hoping.
    lastTick: rec.state ? rec.state.lastTick || null : null,
    lastReport: rec.state ? rec.state.lastReportTs || null : null
  });
}
__name(handleAlertsGet, "handleAlertsGet");

async function handleAlertsSubscribe(request, env, code) {
  const { group, deviceId, error } = await requireMemberOrAdmin(request, env, code);
  if (error) return error;
  if (!deviceId) return err("Missing X-Device-Id", 400);
  if (!env.VAPID_PUBLIC_KEY) return err("Push is not configured on this server", 503);

  const body = await request.json().catch(() => ({}));
  const sub = body.subscription || {};
  const keys = sub.keys || {};
  if (!sub.endpoint || !keys.p256dh || !keys.auth) return err("Incomplete push subscription", 400);
  if (!/^https:\/\//.test(sub.endpoint)) return err("Push endpoint must be https", 400);

  const rec = await loadAlerts(env, code);
  if (!rec.subs[deviceId] && Object.keys(rec.subs).length >= ALERT_MAX_SUBS) {
    return err(`That is already ${ALERT_MAX_SUBS} devices getting alerts for this group`, 403);
  }
  rec.subs[deviceId] = {
    endpoint: String(sub.endpoint).slice(0, 1000),
    p256dh: String(keys.p256dh).slice(0, 200),
    auth: String(keys.auth).slice(0, 100),
    name: String(request.headers.get("X-Device-Name") || "").slice(0, 60),
    addedAt: new Date().toISOString()
  };
  if (body.prefs) rec.prefs = sanitizePrefs(body.prefs);
  await saveAlerts(env, code, rec);

  const idx = await alertIndex(env);
  if (!idx.includes(code)) await setAlertIndex(env, idx.concat(code));
  return json({ ok: true, devices: Object.keys(rec.subs).length, prefs: rec.prefs });
}
__name(handleAlertsSubscribe, "handleAlertsSubscribe");

async function handleAlertsUnsubscribe(request, env, code) {
  const { deviceId, error } = await requireMemberOrAdmin(request, env, code);
  if (error) return error;
  const rec = await loadAlerts(env, code);
  delete rec.subs[deviceId];
  const left = Object.keys(rec.subs).length;
  if (left) {
    await saveAlerts(env, code, rec);
  } else {
    // Nobody is listening any more, so stop spending cron ticks on this group —
    // but keep the record, because the alert state is what stops a re-subscribe
    // from immediately firing for everything that was already down.
    rec.state = rec.state || null;
    await saveAlerts(env, code, rec);
    const idx = await alertIndex(env);
    if (idx.includes(code)) await setAlertIndex(env, idx.filter((c) => c !== code));
  }
  return json({ ok: true, devices: left });
}
__name(handleAlertsUnsubscribe, "handleAlertsUnsubscribe");

async function handleAlertsPrefs(request, env, code) {
  const { error } = await requireMemberOrAdmin(request, env, code);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const rec = await loadAlerts(env, code);
  rec.prefs = sanitizePrefs(body.prefs || body);
  await saveAlerts(env, code, rec);
  return json({ ok: true, prefs: rec.prefs });
}
__name(handleAlertsPrefs, "handleAlertsPrefs");

// Nobody should have to wait for something to break to find out whether they set
// this up correctly.
async function handleAlertsTest(request, env, code) {
  const { deviceId, error } = await requireMemberOrAdmin(request, env, code);
  if (error) return error;
  const rec = await loadAlerts(env, code);
  const sub = rec.subs[deviceId];
  if (!sub) return err("This device is not subscribed to alerts", 404);
  const res = await sendPush(sub, {
    kind: "test", tag: "test", title: "Alerts are working",
    body: "This is what an alert looks like. Real ones only arrive when your NAS says something is actually wrong."
  }, env);
  if (res.gone) {
    delete rec.subs[deviceId];
    await saveAlerts(env, code, rec);
    return err("The push service says this device's subscription has expired — turn alerts off and on again", 410);
  }
  if (!res.ok) return err("The push service refused it (HTTP " + res.status + ")" + (res.error ? ": " + res.error : ""), 502);
  return json({ ok: true });
}
__name(handleAlertsTest, "handleAlertsTest");

async function tickGroup(env, code, now) {
  const rec = await loadAlerts(env, code);
  const subs = Object.entries(rec.subs || {});
  if (!subs.length) return { sent: 0, alerts: 0 };

  const rawReport = await env.SYNC_KV.get(`nas:${code}`);
  const report = rawReport ? JSON.parse(rawReport) : null;
  // KV budget (2026-11-03): this tick runs every 5 minutes, and saving the record every
  // time was ~288 writes a day per group, about a third of the free tier's 1,000. The
  // record is now saved only when something real changed (alert state, subscriptions,
  // an alert sent) or once an hour to refresh lastReportTs. lastReportTs only feeds
  // "has this NAS ever reported", so an hour-old copy decides exactly the same.
  const volatile = (st) => JSON.stringify({ ...(st || {}), lastReportTs: undefined });
  const beforeKey = volatile(rec.state) + JSON.stringify(Object.keys(rec.subs || {}).sort());
  const { alerts, state } = decideAlerts(rec.state, report, now, rec.prefs || {});
  rec.state = state;

  let sent = 0;
  const dead = [];
  for (const a of alerts) {
    for (const [deviceId, sub] of subs) {
      const res = await sendPush(sub, a, env);
      if (res.gone) dead.push(deviceId);
      else if (res.ok) sent++;
    }
  }
  for (const d of dead) delete rec.subs[d];
  const afterKey = volatile(rec.state) + JSON.stringify(Object.keys(rec.subs || {}).sort());
  const stale = !rec.savedAt || now - Date.parse(rec.savedAt) >= 60 * 60 * 1000;
  if (afterKey !== beforeKey || alerts.length || dead.length || stale) {
    rec.savedAt = new Date(now).toISOString();
    await saveAlerts(env, code, rec);
  }
  return { sent, alerts: alerts.length, dropped: dead.length };
}
__name(tickGroup, "tickGroup");

async function runAlertCron(env, now) {
  const idx = await alertIndex(env);
  let groups = 0, sent = 0, alerts = 0;
  const stillActive = [];
  for (const code of idx.slice(0, ALERT_CRON_BUDGET)) {
    try {
      const r = await tickGroup(env, code, now);
      groups++; sent += r.sent; alerts += r.alerts;
      stillActive.push(code);
    } catch (e) {
      // One broken group must not stop the rest of the tick.
      console.error("alert tick failed for " + code, e);
      stillActive.push(code);
    }
  }
  // Anything past the budget keeps its place in the queue for next time.
  if (idx.length > ALERT_CRON_BUDGET) {
    await setAlertIndex(env, idx.slice(ALERT_CRON_BUDGET).concat(stillActive));
  }
  return { groups, alerts, sent };
}
__name(runAlertCron, "runAlertCron");

async function handleRecover(request, env, code) {
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON"); }
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);
  const idle = ownerIdleDays(group);

  let via = null;
  {
    const deviceId = String(body.deviceId || "");
    const memberToken = String(body.memberToken || "");
    if (!deviceId || !memberToken) return err('Send {"deviceId","memberToken"}');
    const mRaw = await env.SYNC_KV.get(`member:${code}:${deviceId}`);
    if (!mRaw) return err("This device is not a member of that group.", 403);
    const m = JSON.parse(mRaw);
    if (!m.tokenHash || await hashStr(memberToken) !== m.tokenHash) return err("This device is not a member of that group.", 403);
    if (idle < RECOVERY_DORMANT_DAYS) {
      // Deliberately tells them how long is left. The honest answer to "can I take
      // this over" is "not yet, and here is when" — not a flat refusal they will
      // retry blindly.
      return json({
        error: `The owner of this group was active ${idle} day${idle === 1 ? "" : "s"} ago. A member can only take over after ${RECOVERY_DORMANT_DAYS} days of silence — ${RECOVERY_DORMANT_DAYS - idle} to go. If you can still reach the owner's device, use Transfer ownership there instead; it works straight away.`,
        idleDays: idle,
        requiredDays: RECOVERY_DORMANT_DAYS,
        daysRemaining: RECOVERY_DORMANT_DAYS - idle
      }, 403);
    }
    via = "member";
    m.role = "editor";
    await env.SYNC_KV.put(`member:${code}:${deviceId}`, JSON.stringify(m), { expirationTtl: 60 * 60 * 24 * 400 });
  }

  const adminToken = generateToken();
  group.adminTokenHash = await hashStr(adminToken);
  group.lastAdminAt = new Date().toISOString();
  group.recoveredAt = group.lastAdminAt;
  group.recoveredVia = via;
  group.recoveredBy = String(body.deviceName || "a device").slice(0, 40);
  await env.SYNC_KV.put(`group:${code}`, JSON.stringify(group), { expirationTtl: 60 * 60 * 24 * 400 });

  const rlim = await groupLimits(env, group);
  return json({ adminToken, code, name: group.name, version: group.version, tier: rlim.tier, maxMembers: rlim.maxMembers, via, idleDays: idle });
}
__name(handleRecover, "handleRecover");

// Read-only: lets the app say "you can recover this in 3 days" without anyone
// having to attempt a takeover to find out.
async function handleRecoverStatus(request, env, code) {
  const raw = await env.SYNC_KV.get(`group:${code}`);
  if (!raw) return err("Group not found", 404);
  const group = JSON.parse(raw);
  const idle = ownerIdleDays(group);
  return json({
    name: group.name,
    idleDays: isFinite(idle) ? idle : null,
    requiredDays: RECOVERY_DORMANT_DAYS,
    memberRecoveryAvailable: idle >= RECOVERY_DORMANT_DAYS,
    daysRemaining: Math.max(0, RECOVERY_DORMANT_DAYS - idle),
    recoveredAt: group.recoveredAt || null,
    recoveredBy: group.recoveredBy || null,
    recoveredVia: group.recoveredVia || null
  });
}
__name(handleRecoverStatus, "handleRecoverStatus");

// ── Short share links and encrypted online backups (2026-09-17) ────────────────
// A share link used to carry the whole setup in the URL: 12,591 characters for 25
// apps, which text messages cut in half. A short link stores the same credential-free
// app list here for 30 days and the URL carries only a 6-character code.
// An online backup is encrypted in the browser with the user's passphrase before it
// is sent (AES-GCM, PBKDF2). This worker only ever sees ciphertext and refuses a body
// that is not in that shape, so it cannot become a store of plaintext passwords.
var SHARE_TTL = 60 * 60 * 24 * 30;
var BACKUP_TTL = 60 * 60 * 24 * 400;
var SHARE_MAX_BYTES = 64 * 1024;
var BACKUP_MAX_BYTES = 512 * 1024;
var SHARE_DROP = ["username", "password", "apiKey", "notes"];
// Writes are rate-limited per IP per hour. Reads are not: a KV write on every read
// would cost more than the abuse it prevents, and backup ids carry 50 bits of
// randomness in front of a passphrase.
async function rateLimit(env, request, bucket, max) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = parseInt(await env.SYNC_KV.get(key) || "0", 10);
  if (n >= max) return false;
  await env.SYNC_KV.put(key, String(n + 1), { expirationTtl: 7200 });
  return true;
}
function cleanSharedApps(apps) {
  return (Array.isArray(apps) ? apps : [])
    .filter((a) => a && typeof a === "object" && typeof a.id === "string" && a.id !== SYNC_SETTINGS_ID)
    .slice(0, 300)
    .map((a) => { const o = { ...a }; for (const k of SHARE_DROP) delete o[k]; return o; });
}
async function readLimited(request, max) {
  const text = await request.text();
  if (text.length > max) return { tooBig: true };
  try { return { body: JSON.parse(text) }; } catch { return { bad: true }; }
}
async function handleShareCreate(request, env) {
  const r = await readLimited(request, SHARE_MAX_BYTES);
  if (r.tooBig) return err("That setup is too big for a short link", 413);
  if (r.bad) return err("Invalid JSON");
  const apps = cleanSharedApps(r.body.apps);
  if (!apps.length) return err("Nothing to share");
  if (!await rateLimit(env, request, "share", 30)) return err("Too many share links from here. Try again in an hour.", 429);
  let code;
  for (let i = 0; i < 10; i++) {
    code = randChars(6);
    if (!await env.SYNC_KV.get(`share:${code}`)) break;
    if (i === 9) return err("Could not generate a code", 500);
  }
  const now = new Date();
  const expires = new Date(now.getTime() + SHARE_TTL * 1000).toISOString();
  await env.SYNC_KV.put(`share:${code}`, JSON.stringify({ apps, created: now.toISOString(), expires }), { expirationTtl: SHARE_TTL });
  return json({ code, expires });
}
async function handleShareGet(env, code) {
  const raw = await env.SYNC_KV.get(`share:${code}`);
  if (!raw) return err("That share link has expired or never existed", 404);
  const rec = JSON.parse(raw);
  return json({ apps: cleanSharedApps(rec.apps), created: rec.created, expires: rec.expires });
}
function validSealedBlob(b) {
  return !!b && typeof b === "object" && b.v === 1 &&
    typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string" &&
    b.salt.length >= 16 && b.salt.length <= 64 && b.iv.length >= 12 && b.iv.length <= 64 &&
    /^[A-Za-z0-9+/=]+$/.test(b.ct) && /^[A-Za-z0-9+/=]+$/.test(b.salt) && /^[A-Za-z0-9+/=]+$/.test(b.iv);
}
async function handleBackupSave(request, env) {
  const r = await readLimited(request, BACKUP_MAX_BYTES);
  if (r.tooBig) return err("That backup is too large to store online", 413);
  if (r.bad) return err("Invalid JSON");
  const body = r.body;
  if (!validSealedBlob(body.blob)) return err("A backup must be encrypted by the app before it is uploaded");
  const now = new Date().toISOString();
  if (body.id) {
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(body.id)) return err("No online backup with that ID", 404);
    const raw = await env.SYNC_KV.get(`backup:${body.id}`);
    if (!raw) return err("That online backup no longer exists", 404);
    const rec = JSON.parse(raw);
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ") || await hashStr(auth.slice(7)) !== rec.writeTokenHash) {
      return err("Only the device that created this backup can update it", 403);
    }
    rec.blob = body.blob;
    rec.updated = now;
    await env.SYNC_KV.put(`backup:${body.id}`, JSON.stringify(rec), { expirationTtl: BACKUP_TTL });
    return json({ id: body.id, updated: now });
  }
  if (!await rateLimit(env, request, "backup", 10)) return err("Too many new backups from here. Try again in an hour.", 429);
  let id;
  for (let i = 0; i < 10; i++) {
    id = randChars(10);
    if (!await env.SYNC_KV.get(`backup:${id}`)) break;
    if (i === 9) return err("Could not generate a backup ID", 500);
  }
  const writeToken = generateToken();
  const rec = { blob: body.blob, created: now, updated: now, writeTokenHash: await hashStr(writeToken) };
  await env.SYNC_KV.put(`backup:${id}`, JSON.stringify(rec), { expirationTtl: BACKUP_TTL });
  return json({ id, writeToken, updated: now });
}
async function handleBackupGet(env, id) {
  const raw = await env.SYNC_KV.get(`backup:${id}`);
  if (!raw) return err("No online backup with that ID", 404);
  const rec = JSON.parse(raw);
  return json({ blob: rec.blob, updated: rec.updated });
}
async function handleBackupDelete(request, env, id) {
  const raw = await env.SYNC_KV.get(`backup:${id}`);
  if (!raw) return err("No online backup with that ID", 404);
  const rec = JSON.parse(raw);
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ") || await hashStr(auth.slice(7)) !== rec.writeTokenHash) {
    return err("Only the device that created this backup can delete it", 403);
  }
  await env.SYNC_KV.delete(`backup:${id}`);
  return json({ deleted: true });
}

// ── Speed log ────────────────────────────────────────────────────────────────
// Every device writes ONLY its own key (speed:{code}:{deviceId}), so two phones
// logging at the same moment can never overwrite each other — a single shared
// array would be a read-modify-write race. Reads gather the roster's keys by
// get(), never list(), for the same reason as everywhere else in this file:
// list() lags writes by over a minute and the entry you just logged is the one
// you want to see.
var SPEED_PER_DEVICE = 1000;
var SPEED_MAX_BATCH = 100;
var SPEED_MAX_DEVICES = 50;
function speedNum(v, lo, hi, dp) {
  // null / "" / undefined mean "not measured" — Number(null) is 0, which would store a
  // failed download as 0 Mbps and a missing location as 0,0.
  if (v === null || v === void 0 || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  const k = Math.pow(10, dp);
  return Math.round(n * k) / k;
}
__name(speedNum, "speedNum");
// Untrusted input from a client: clamp every field, drop markup, and round
// coordinates to 3 decimals (~110 m) so the group learns which street a slow
// spot is on without holding an exact doorstep.
function sanitizeSpeedEntry(e) {
  if (!e || typeof e !== "object") return null;
  const id = String(e.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const ts = Date.parse(e.ts);
  if (!id || !Number.isFinite(ts)) return null;
  if (ts > Date.now() + 24 * 3600 * 1000 || ts < Date.UTC(2020, 0, 1)) return null;
  const txt = (v, n) => String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, n);
  const net = ["wifi", "cellular", "ethernet", "other"].includes(e.net) ? e.net : "other";
  const out = {
    id,
    ts: new Date(ts).toISOString(),
    down: speedNum(e.down, 0, 100000, 2),
    up: speedNum(e.up, 0, 100000, 2),
    ping: speedNum(e.ping, 0, 60000, 0),
    nas: speedNum(e.nas, 0, 100000, 2),
    nasPing: speedNum(e.nasPing, 0, 60000, 0),
    lat: speedNum(e.lat, -90, 90, 3),
    lon: speedNum(e.lon, -180, 180, 3),
    place: txt(e.place, 60),
    note: txt(e.note, 120),
    net
  };
  if (out.down === null && out.up === null && out.ping === null && out.nas === null) return null;
  if (out.lat === null || out.lon === null) { out.lat = null; out.lon = null; }
  return out;
}
__name(sanitizeSpeedEntry, "sanitizeSpeedEntry");
async function handleSpeedPost(request, env, code) {
  const a = await requireMemberOrAdmin(request, env, code);
  if (a.error) return a.error;
  if (!a.deviceId) return err("Missing X-Device-Id", 400);
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON", 400); }
  const list = Array.isArray(body && body.entries) ? body.entries.slice(0, SPEED_MAX_BATCH) : [];
  const clean = list.map(sanitizeSpeedEntry).filter(Boolean);
  const key = `speed:${code}:${a.deviceId}`;
  const raw = await env.SYNC_KV.get(key);
  let have = [];
  try { have = raw ? JSON.parse(raw).entries || [] : []; } catch { have = []; }
  // Same id from the same device REPLACES the stored entry — that is how an edit
  // (renamed room, GPS removed) reaches the other phones. The key is per-device, so
  // nobody can overwrite anybody else's entries.
  const idx = new Map(have.map((x, i) => [x.id, i]));
  let added = 0;
  for (const e of clean) {
    if (idx.has(e.id)) have[idx.get(e.id)] = e;
    else { idx.set(e.id, have.length); have.push(e); added++; }
  }
  have.sort((x, y) => (x.ts < y.ts ? 1 : -1));
  have = have.slice(0, SPEED_PER_DEVICE);
  const mRaw = await env.SYNC_KV.get(`member:${code}:${a.deviceId}`);
  const devName = (mRaw ? JSON.parse(mRaw).deviceName : request.headers.get("X-Device-Name")) || "Unknown device";
  await env.SYNC_KV.put(key, JSON.stringify({ deviceName: String(devName).slice(0, 40), entries: have }), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ ok: true, added, kept: have.length });
}
__name(handleSpeedPost, "handleSpeedPost");
async function handleSpeedGet(request, env, code) {
  const a = await requireMemberOrAdmin(request, env, code);
  if (a.error) return a.error;
  const roster = Array.isArray(a.group.roster) ? a.group.roster.slice(0, SPEED_MAX_DEVICES) : [];
  // The admin may never have polled as a member, so include the caller explicitly.
  if (a.deviceId && !roster.includes(a.deviceId)) roster.push(a.deviceId);
  const recs = await Promise.all(roster.map((d) => env.SYNC_KV.get(`speed:${code}:${d}`)));
  const entries = [];
  recs.forEach((raw, i) => {
    if (!raw) return;
    try {
      const r = JSON.parse(raw);
      for (const e of r.entries || []) entries.push({ ...e, dev: roster[i], devName: r.deviceName || "Unknown device" });
    } catch {}
  });
  entries.sort((x, y) => (x.ts < y.ts ? 1 : -1));
  return json({ entries: entries.slice(0, 2000) });
}
__name(handleSpeedGet, "handleSpeedGet");
async function handleSpeedDelete(request, env, code) {
  const a = await requireMemberOrAdmin(request, env, code);
  if (a.error) return a.error;
  if (!a.deviceId) return err("Missing X-Device-Id", 400);
  const key = `speed:${code}:${a.deviceId}`;
  const one = new URL(request.url).searchParams.get("id");
  if (one) {
    // Delete a single entry of THIS device's log (a test you know was bad).
    const raw = await env.SYNC_KV.get(key);
    if (!raw) return json({ ok: true, removed: 0 });
    const r = JSON.parse(raw);
    const before = (r.entries || []).length;
    r.entries = (r.entries || []).filter((e) => e.id !== one);
    await env.SYNC_KV.put(key, JSON.stringify(r), { expirationTtl: 60 * 60 * 24 * 400 });
    return json({ ok: true, removed: before - r.entries.length });
  }
  await env.SYNC_KV.delete(key);
  return json({ ok: true });
}
__name(handleSpeedDelete, "handleSpeedDelete");

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { headers: CORS });
    const codeMatch = path.match(/^\/sync\/([A-Z0-9]{3}-[A-Z0-9]{3})(\/(.+))?$/);
    const code = codeMatch?.[1];
    const sub = codeMatch?.[3];
    const shareMatch = path.match(/^\/share\/([A-HJ-NP-Z2-9]{6})$/);
    const backupMatch = path.match(/^\/backup\/([A-HJ-NP-Z2-9]{10})$/);
    try {
      // The app's "Save and test" asks this to be sure the address is a NAS Hub sync server.
      if (method === "GET" && path === "/") return json({ service: "nashub-sync", version: SERVER_VERSION });
      if (method === "POST" && path === "/share") return handleShareCreate(request, env);
      if (method === "GET" && shareMatch) return handleShareGet(env, shareMatch[1]);
      if (method === "POST" && path === "/backup") return handleBackupSave(request, env);
      if (method === "GET" && backupMatch) return handleBackupGet(env, backupMatch[1]);
      if (method === "DELETE" && backupMatch) return handleBackupDelete(request, env, backupMatch[1]);
      if (method === "POST" && path === "/sync/create") return handleCreate(request, env);
      if (method === "GET" && code && !sub) return handleGet(request, env, code);
      if (method === "POST" && code && sub === "publish") return handlePublish(request, env, code);
      if (method === "GET" && code && sub === "members") return handleMembers(request, env, code);
      if (method === "GET" && code && sub === "history") return handleHistory(request, env, code);
      if (method === "POST" && code && sub === "restore") return handleRestore(request, env, code);
      if (method === "POST" && code && sub === "member-role") return handleMemberRole(request, env, code);
      if (method === "POST" && code && sub === "recover") return handleRecover(request, env, code);
      if (method === "GET" && code && sub === "recover") return handleRecoverStatus(request, env, code);
      if (method === "POST" && code && sub === "nas-token") return handleNasToken(request, env, code);
      if (method === "POST" && code && sub === "nas") return handleNasPush(request, env, code);
      if (method === "GET" && code && sub === "nas") return handleNasGet(request, env, code);
      if (method === "POST" && code && sub === "speed") return handleSpeedPost(request, env, code);
      if (method === "GET" && code && sub === "speed") return handleSpeedGet(request, env, code);
      if (method === "DELETE" && code && sub === "speed") return handleSpeedDelete(request, env, code);
      if (method === "GET" && code && sub === "alerts") return handleAlertsGet(request, env, code);
      if (method === "POST" && code && sub === "alerts/subscribe") return handleAlertsSubscribe(request, env, code);
      if (method === "DELETE" && code && sub === "alerts/subscribe") return handleAlertsUnsubscribe(request, env, code);
      if (method === "POST" && code && sub === "alerts/prefs") return handleAlertsPrefs(request, env, code);
      if (method === "POST" && code && sub === "alerts/test") return handleAlertsTest(request, env, code);
      if (method === "POST" && code && sub === "transfer") return handleTransferStart(request, env, code);
      if (method === "POST" && code && sub === "transfer/claim") return handleTransferClaim(request, env, code);
      if (method === "DELETE" && code && sub === "transfer") return handleTransferCancel(request, env, code);
      if (method === "DELETE" && code && !sub) return handleDelete(request, env, code);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Internal server error" }, 500);
    }
  },
  // The cron trigger. Every 5 minutes, matching the bridge's own cadence — there
  // is no point checking more often than the NAS reports.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertCron(env, Date.now()).then((r) => {
      if (r.alerts) console.log("alerts tick: " + JSON.stringify(r));
    }));
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
