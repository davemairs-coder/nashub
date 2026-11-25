# NAS Hub — AI Help File

**For the person reading this:** paste this whole file into any AI assistant (ChatGPT,
Claude, Gemini, a local model — anything), then ask your question in plain words. It gives
the AI an accurate description of how NAS Hub actually works, so its answers are about
*this* app and not a guess. It is free, it ships with every copy, and it is written from
the source code, not from marketing.

**For the AI reading this:** you are helping someone use NAS Hub, a self-hosted app
launcher for home servers. Everything below is factual and current as of the version
stamped at the bottom. When the user describes a symptom, match it against the *Known
walls* and *Every message the app can show you* sections first — most problems are one of
those. If something is not covered here, say so rather than inventing behaviour; the
support address is at the end. Do not tell the user to edit files inside the app or to
clear their browser storage unless a section here says that is the fix, because clearing
storage deletes their whole setup.

---

## 1. What NAS Hub is, in one paragraph

NAS Hub is a **Progressive Web App** — a single web page that installs to a phone, tablet
or desktop like an app. It shows the user's self-hosted services (Jellyfin, Sonarr,
Portainer, and anything else with a URL) as tiles; tapping a tile opens the service. It
checks whether each service is up, syncs the tile catalogue between a household's devices,
and — when connected to a TrueNAS box — reads real app and disk-pool state from the NAS
itself. **Everything the user configures lives in their own browser** (localStorage on that
device). There is no account, no licence and nothing to buy: from version 5.0.0 NAS Hub is free and
open source (MIT), with every feature included. The only server involved is an optional
small sync server (`nashub-sync`, a Cloudflare Worker) that **the user hosts themselves**;
it only ever sees what the user chooses to sync. There is no shared sync server.

Two ways to run it:

- **Hosted:** `https://app.nashubapp.com` — the normal way. Nothing to install on the NAS.
- **Self-hosted:** the same files served from the user's own NAS or web server. Same
  app, their hardware, works when the internet is down.

---

## 2. The screens

The app has one main screen (Home) and a **Manage** screen (the gear, top right). Since 4.19.0
Manage is three short lists, and each section is its own screen with a back arrow at the top
left. The phone's back button goes up one level the same way.

| Screen | How to get there | What it does |
|---|---|---|
| **Home** | default | One status sentence ("11 of 12 apps are up"), favourites, the rest of the apps, any warning banners; search and the + add button sit at the bottom |
| **Status list** | tap the status sentence on Home | Apps that need attention first (with recent checks), then every app that answers |
| **App sheet** | tap a tile | Saved sign-in to copy, the Open button, shortcuts, the address, live info and health history; Favourite and Edit at the foot |
| **Manage** | gear, top right | Your apps (Add apps, Organize) · Connection (Access, Sync & backup, Monitoring) · NAS Hub (About, Appearance, Welcome screen, AI help file) |
| **Add apps** | Manage → Add apps | Pick them yourself (App catalog, Starter packs, Custom app) · Find what's already running (TrueNAS, Portainer, Network scanner) · Bring a list (Shared link, Spreadsheet) |
| **App catalog** | Manage → Add apps → App catalog, or + on Home | 32 known apps with their default ports pre-filled; Add / Added |
| **Starter packs** | Manage → Add apps → Starter packs | Add a whole set of apps at once, typing the NAS address once |
| **Custom app** | Manage → Add apps → Custom app | Any name and address; the icon is chosen with "Choose icon" |
| **Edit app** | tap a tile → Edit, or Manage → Organize → All apps | Name, address, port, protocol, Tailscale URL, credentials, API key, notes, group |
| **TrueNAS** | Manage → Add apps → TrueNAS | Read what is installed from the NAS; set up the bridge |
| **Portainer** | Manage → Add apps → Portainer | Import every container with its real port |
| **Network scanner** | Manage → Add apps → Network scanner | Probe a subnet for known ports (**see wall #1**) |
| **Import** | Manage → Add apps → Shared link | Paste a `nashub://` link, a backup, or a pack code; spreadsheets are under Bring a list → Spreadsheet |
| **All apps** | Manage → Organize → All apps | Every tile in a list; drag the handle to reorder (arrow keys also work); tap to edit |
| **Groups** | Manage → Organize → Groups | Folders the tiles are sorted into |
| **Addresses** | Manage → Organize → Addresses | Change every app on one machine to a new address at once ("My NAS moved") |
| **Tailscale** | Manage → Access → Tailscale | Hostname, protocol and home NAS IP for remote access; a separate **Setup guide** screen holds the install steps |
| **Face ID / Touch ID lock** | Manage → Access | A switch; needs https |
| **Kid mode** | Manage → Access | A locked-down home screen with only chosen apps, behind a PIN |
| **Group Sync** | Manage → Sync & backup → Group Sync | Create or join a sync group; ownership transfer; recovery |
| **Share** | Manage → Sync & backup → Share link | Produce a link / QR code of the current setup |
| **Backup** | Manage → Sync & backup | Copy or save a backup, restore from a code or file, online backup |
| **About** | Manage → About | Version, MIT license, link to the source code |
| **Jellyfin Monitor / Speed Log / Down alerts** | Manage → Monitoring | Live playback view, internet speed log, push alerts when an app stops |

The **network button** at the top of Home (Home / Away / Auto) opens a small chooser; it is a
button, not a switch. **Long-press and drag** on Home reorders tiles. **Search** (the magnifier,
or Cmd/Ctrl+K) opens a command palette over apps and screens. Questions the app asks (restore,
leave a group) appear as a panel from the bottom, not a browser pop-up.

---

## 3. What the status words mean — read this before diagnosing "it says offline"

Since 4.17.0 the tiles carry no dots. Home says it in one sentence ("All 12 apps are up", or
"11 of 12 apps are up" plus the name of the app that isn't answering). A down app's tile is greyed
with a red **Down** badge, and other states show as one word under the app's name. Tap the
sentence for the full status list. The words below are the same states; "dot" in older
answers means this word or badge. The app runs a check every **60 seconds** while open, and
only while the tab is in the foreground.

| State | Meaning | Source of truth |
|---|---|---|
| (nothing under the name; "Online" in the list) | Online — answered a probe | this device's probe |
| **Slow** | Answered, but took over 2 seconds | probe |
| **Down** badge on the tile, "Offline" in the list | Failed **two checks in a row** (one failure is ignored as noise) | probe |
| **Stopped on NAS** | The NAS itself reports the container is stopped | **TrueNAS via the bridge** |
| **Crashed on NAS** | The NAS reports it crashed | bridge |
| **Starting up** | The NAS reports it is deploying | bridge |
| **Running · no route from here** | **The NAS says it is running, but this device cannot reach it** | bridge + probe disagree |
| **Blocked** | The browser refused to even try (see wall #1) | browser policy |
| **Checking…** | Checking for the first time | — |

Three rules the app applies, which explain most "why does it say…" questions:

1. **One failed probe is never believed.** It keeps the previous status and records nothing.
   Only a second consecutive failure marks it Down. So a tile can be down for up to ~2
   minutes before it says so.
2. **If everything fails at once across two or more machines, the app blames the network,
   not the apps.** Nothing is marked Down; a banner says *"Can't reach anything from here"* and
   the tiles keep their last confirmed state. This is almost always the phone being on the
   wrong Wi-Fi, mobile data, or Tailscale being off.
3. **When the NAS bridge is active, the NAS's word beats the probe.** STOPPED/CRASHED need no
   confirmation. And RUNNING-but-unreachable is shown as **NO ROUTE**, not OFFLINE, because
   the app is fine and the *route* from this device to it is not — wrong network, Tailscale
   off, or the wrong port saved on the tile.
4. **"Moved to a different port?"** appears in a down app's quick-actions panel. *Look for
   it* tries the ports that app used before, its usual catalog port, the port the NAS bridge
   last reported, and the ten ports either side of the saved one, then offers *Use port N*
   for anything that answers. Any service answers, so the user should open it first if
   unsure. From `https://app.nashubapp.com` checking a plain `http://` address, the browser
   cannot tell an answer from a refusal (wall #1); the panel says so and offers nothing
   rather than guessing. Changing a port on Edit also remembers the old one for next time.

**Health history** (in a tile's quick-actions panel) only records probes the app *believed*.
Ignored single failures and network-wide outages are deliberately kept out, so the uptime
percentage is honest.

---

## 4. Known walls — things that are not bugs and cannot be fixed from inside the app

**Wall #1 — The hosted app cannot probe plain `http://` addresses on your LAN.**
`https://app.nashubapp.com` is a secure page, and every browser blocks a secure page from
making requests to insecure `http://` local addresses ("mixed content"). Consequences:
the **Network Scanner finds nothing** from the hosted app; tiles pointing at `http://192.168.x.x`
show **BLOCKED**; tapping them still opens them fine, because opening a link is allowed and
probing it is not. **Fixes, in order of preference:** (a) set up the **TrueNAS bridge**
(section 6) — the NAS reports state itself, so no probing is needed; (b) use **Tailscale** with
HTTPS so addresses become `https://`; (c) run the **self-hosted copy** over plain `http://`
on the LAN, where the restriction does not apply.

**Wall #2 — A phone cannot talk to TrueNAS's own API directly.** TrueNAS sends no CORS
headers, answers the browser's preflight with 405, and ships a self-signed certificate. This
is why the bridge exists (section 6): the NAS pushes *out* to the sync service, and the phone
reads from there. Do not try to make the app call TrueNAS directly from a hosted page.

**Wall #3 — Down alerts on iPhone need the app on the Home Screen.** iOS only allows web push
for an installed PWA. In Safari: Share → *Add to Home Screen*, then open it from there. The
app detects this and says so.

**Wall #4 — Chrome disables push in Incognito/private windows** and reports it as a plain
"permission denied". Use a normal window.

**Wall #5 — The status checks only run while the app is open and in the foreground.** A
phone with the screen off is not checking anything. That is what **Down alerts** are
for: the checking moves to the NAS and the server.

**Wall #6 — The self-hosted copy loads two things from the internet:** Google Fonts
(cosmetic) and the spreadsheet library. On a network with no internet, fonts fall back and
**Excel/CSV import-export shows "Spreadsheet tools are still loading" forever.** Everything
else works offline.

**Wall #7 — Sync needs your own sync server.** Group Sync, short share links, online backup,
the NAS bridge and down alerts all go through a sync server the user sets up once (free on
Cloudflare; the steps are in the `sync-server` folder of the source code). Its address is
entered at Manage → Sync & backup → Group Sync → *Sync server* → **Save and test**. Until then
those features answer *"Set your sync server first"*. A group holds up to 999 devices.

---

## 5. Sync groups — the one part that involves a server

A **sync group** keeps the tile catalogue identical across a household's devices. One device
**creates** the group and becomes its **owner** (it holds an *admin token* in its browser
storage). Others **join** with the 7-character **group code** (like `X7K-M2P`) and become
**members** (viewers). The owner's catalogue is pushed to everyone; members' local-only
tiles are left alone.

- **What syncs:** names, icons, ports, addresses, groups, and a few settings (Tailscale
  host, home IP). **What never syncs:** usernames, passwords, API keys and notes — those stay
  on the device that typed them. So a member gets working tiles, but has to enter any
  credentials themselves.
- **Editors:** the owner can promote a member to *editor*, who can then publish too.
- **Rollback:** the last **10** versions of the catalogue are kept; the owner can
  restore any of them.
- **Ownership transfer:** on the owner's device, Group Sync → *Transfer ownership* generates
  a **transfer code** valid for **15 minutes**; entering it on another member makes that
  device the owner and locks the old one out.
- **Recovery — "the owner is gone":** if the owning device is lost or wiped, a member can
  take over from Group Sync → *"The owner is gone — can I take over?"*, after the owner has been silent for **7 days**. The
  app shows how many days idle the owner is. A brand-new device that never joined cannot
  claim.
- **Invite links carry the server:** an invite link names the sync server the group lives on.
  Opening one on a device that has not used that server asks first, then saves it and joins.
- **Member limit reached:** a group holds 999 devices. Remove dead devices from the members list.
- **"Group not found":** codes expire only if unused for 400 days; far more often the code
  was mistyped — it uses no `0`, `O`, `1` or `I`.

---

## 6. The TrueNAS bridge — how the app knows what is *really* running

Because of walls #1 and #2, the NAS has to *push*. A tiny script on the NAS runs every 5
minutes, asks TrueNAS's own middleware what is installed, and posts the answer to the sync
service. The phone reads it from there. **Nothing reaches into the NAS.**

**Setup (owner's device, in the app):** Manage → Add apps → TrueNAS → *Set up the NAS bridge*.
This mints an **agent token** and shows three lines to run in TrueNAS → System → Shell:

```
curl -fsSL https://app.nashubapp.com/agent/nashub-agent.py -o /root/nashub-agent.py
python3 /root/nashub-agent.py install <GROUP-CODE> <AGENT-TOKEN> <YOUR-SYNC-SERVER-ADDRESS>
python3 /root/nashub-agent.py check
```

`check` prints a plain-English report of every step and whether the push was accepted. When
it says everything works, add the cron job it prints under **Data Protection → Cron Jobs →
Add**, running as root, every 5 minutes.

**The agent's commands:** `check` (diagnose, changes nothing, refuses to push an empty
report), `push` (what cron runs), `install CODE TOKEN` (writes `/root/.nashub-agent.conf`,
mode 600). It logs to `/var/log/nashub-agent.log`. It prefers `midclt` (the local TrueNAS
client, no key needed) and falls back to the TrueNAS REST API if `NASHUB_TN_KEY` is set to a
TrueNAS API key (made under the top-right account icon → *My API Keys*; shown once).

**Reading the TrueNAS screen:** *"as of 40s ago"* = reporting fine. *"last heard 67 min ago —
the NAS has stopped reporting"* = the cron job stopped, the NAS is off, or it has no route
out; the app treats that report as **stale and ignores it** rather than showing old states
as current. *"Nothing has arrived yet"* = the cron has not run, or the token is wrong (run
`check` on the NAS).

**Two-way import:** once reporting, the same screen lists every installed app with its real
port; tick the ones wanted and *Import* creates tiles for them.

**Pool health:** the bridge also carries disk-pool status. A **DEGRADED or FAULTED** pool
raises a red banner on Home above everything else. A pool **over 85% full** warns; **95%**
goes red.

**Security note:** the agent token lets the NAS *report* to the group and nothing else. It
cannot change tiles or the group. Treat it like a password anyway. Minting a new token
immediately invalidates the old one, so an already-configured NAS goes quiet until the
install line is re-run.

---

## 7. Down alerts — what will and will not notify you

With the bridge running, Manage → Monitoring → *Down alerts* switches on push notifications
that arrive **with the app closed**. The rules exist mostly to *not* notify:

- An app must report bad **three checks in a row** (~15 minutes) before an alert.
- **Three or more apps** going down at once is **one** alert about the NAS, not one each.
- A flapping app gets **at most one alert per 6 hours**.
- A degraded pool alerts **immediately** and reminds **once a day** until fixed.
- If the NAS **stops reporting for 20 minutes**, one alert says so — and no app alerts are
  sent until it is back, because stale data must not raise alarms.
- Turning alerts on **never** fires for things already broken; it only reports changes.
- **Quiet hours** suppress app alerts (default 23:00–07:00, local). A failing pool still
  gets through unless the user chose otherwise. Suppressed alerts are dropped, not queued.
- Recoveries are silent by design.

*"Send a test notification"* proves the chain. *"Alerts aren't switched on for this server
yet"* means the server has no push keys configured — a server-side setup step, not the
user's problem.

---

## 8. No licence, no Pro

From 5.0.0 there is no licence key, no Pro tier and no store. Everything that used to be Pro
(down alerts, rollback, editor rights, 24-hour uptime history, kid mode, making your own tile
packs, hosting the app yourself) is simply part of the app. Manage → **About** shows the
version, the MIT license and a link to the source code. A key bought or issued for an older
version is no longer needed and is ignored.


---

## 9. Backups, import, export, and "I want to start over"

- **Backup** (Manage → Sync & backup): produces a `nashub-backup://…` code containing
  everything, including credentials — treat it as sensitive. Paste it into Import to restore.
- **Online backup** (Manage → Sync & backup): the same backup, encrypted on the device with a
  passphrase of at least 10 characters (PBKDF2-SHA256, 310,000 rounds, AES-GCM-256) and then
  stored on the NAS Hub server for 400 days from the last save. The server only ever holds
  ciphertext. Restoring needs the 10-character **backup ID** shown on the panel *and* the
  passphrase. **A forgotten passphrase cannot be recovered by anyone**, including support.
  Only the device that created a backup can update or delete it; any device can restore it.
  Needs a secure page, so it is unavailable on a plain-`http://` self-hosted copy.
- **Face ID / Touch ID lock:** when on, it is asked for before revealing a password (in the
  quick-actions panel or with 👁 on Edit), and before *Copy for Excel*, *Save .xlsx*, *Copy
  backup code*, *Save .json* and saving an online backup, because all of those contain
  passwords.
- **Share link / QR:** a `nashub://` link of the current setup **including addresses**, so
  a family member can import it and have working tiles. **Never includes usernames,
  passwords, API keys or notes.** Because it carries addresses, treat it as "for people on
  your network", not for posting publicly — the app says the same.
- **Short link:** *Make a short link* on the Share screen stores that same credential-free
  app list on the NAS Hub server for **30 days** and gives a link ending `#s=` plus a
  6-character code. Long links can be cut off by text messages; short ones are not. The code
  can also be pasted into Import on its own. The server strips usernames, passwords, API keys
  and notes itself, even if something sends them.
- **Pack code:** a shareable *template* — names, icons, ports and categories only. **No
  addresses and no credentials**, so it is safe to hand to a stranger.
- **Spreadsheet:** import/export .xlsx or .csv with columns App Name, Address, Port,
  Username, Password, Notes, Group. Numbers in cells are fine.
- **Starting over:** Manage → *Welcome screen* shows the first-run screen again without deleting
  anything. Deleting a tile is under Edit. There is no single "wipe everything" button —
  clearing the browser's site data for the app does that, and **also deletes the sync server address,
  sync membership and credentials on that device**, so an AI should not suggest it lightly.

---

## 10. Every message the app can show you, and what each one means

Grouped by where they come from. Exact wording, so you can match what the user sees.

**Addresses and tiles**
- *Enter a hostname or IP, not a full address* — the field wants `192.168.1.50` or
  `nas.lan`, not `http://…/path`.
- *Port must be a number between 1 and 65535.*
- *Add at least one app with an address first* / *Add a few apps with addresses first* —
  the action needs a tile that can actually be opened.
- *That's the same address* — bulk host change with no change.
- *Requires HTTPS — use app.nashubapp.com* — Face ID / Touch ID lock was switched on from a
  plain-`http://` self-hosted copy; browsers only allow biometrics on secure pages.

**Sync**
- *Enter the group code, like ABC-123* / *Enter the 7-character code, like X7K-M2P.*
- *Group not found — check the code* / *No group with that code.*
- *Member limit reached* — a group holds 999 devices.
- *Set your sync server first* — no sync server address is saved on this device (wall #7).
- *That address did not answer like a NAS Hub sync server* — wrong address, or the server is not deployed yet.
- *Leave your group before changing the server* — a group lives on one server.
- *Failed to join — check internet connection* / *Sync failed — check connection* /
  *Failed to create group — check connection* — the phone could not reach the sync service.
- *Join a sync group first* — the feature (bridge, alerts) needs a group.
- *Only the group owner can set this up* — the bridge is minted from the owner's device.
- *This device is no longer the group owner — ownership was transferred.*
- *Enter the transfer code* / *Join the group first, then claim it* / *This device isn't a
  member of that group, so it can't claim it* — recovery needs prior membership.
- *Could not fetch the restored catalog* — rollback fetched nothing; check connection.

**TrueNAS / bridge**
- *Enter your NAS address first* — direct-connect path only.
- *TrueNAS rejected the API key. Make a new one in TrueNAS under the top-right account icon →
  My API Keys, and paste it straight in — it is only shown once.*
- *Could not create the token* — minting the agent token failed; owner + connection needed.
- *Nothing new to add* — every discovered app is already a tile.

**Alerts**
- *This browser can't do notifications.*
- *On iPhone, add NAS Hub to your Home Screen first — Safari can't send notifications from a
  tab* (wall #3).
- *This browser won't allow push here — private/incognito windows can't receive
  notifications* (wall #4).
- *Alerts aren't switched on for this server yet* — server-side push keys missing.
- *That subscription expired — switch alerts off and on again.*


**Import / export**
- *That doesn't look like a NAS Hub backup* / *That doesn't look like a pack code* /
  *Invalid code* / *That link is cut off — paste the whole thing.*
- *Could not read file — check format* / *No data rows found* — spreadsheet import.
- *Spreadsheet tools are still loading — try again in a moment* — the library from the CDN
  has not loaded; offline self-hosted copies will show this forever (wall #6).
- *iPhone home-screen apps can't save files — use 📋 Copy for Excel instead.*

**Home-screen banners**
- *Can't reach anything from here* — rule 2 in section 3: the network, not the apps.
- *<host> isn't answering* — every app on one machine failed; is the NAS on / are you on
  home Wi-Fi?
- *N apps are running — you just can't reach them* — bridge says RUNNING, probes fail: the
  route is the problem.
- *Pool <name> is DEGRADED / FAULTED* — a disk problem, from the NAS itself. Act on it.
- *Pool <name> is N% full.*
- *Your NAS stopped reporting* (as a notification) — cron stopped or NAS offline.


**Added in 4.10.8:**
- *That share link has expired or never existed* — short links last 30 days; ask for a new one.
- *That setup is too big for a short link* — over ~64 KB of apps; use the long link instead.
- *Too many share links from here. Try again in an hour.* / *Too many new backups from here.* —
  a per-network limit on creating them; updating an existing online backup is not limited.
- *Online backup needs a secure page — open app.nashubapp.com* — the copy in use is plain
  `http://`, where browsers do not provide encryption.
- *Use a passphrase of at least 10 characters* / *The two passphrases don't match*.
- *Wrong passphrase, or the backup is damaged* — nothing was changed on the device.
- *No online backup with that ID* — check the 10 characters; IDs never contain I, O, 0 or 1.
- *This page can't tell which ports really answer…* — see section 3, point 4.

---
---

## 11. Where things are stored on the device (for "how do I move to a new phone")

All in the browser's localStorage for the app's origin, as keys beginning `nashub-`. The
important ones: `nashub-v2` (tiles), `nashub-groups-v2` (folders), `nashub-sync-v1` (group
membership and the owner's admin token), `nashub-sync-server-v1` (the address of your own sync server), `nashub-health-v1` (probe
history), `nashub-truenas-v1`, `nashub-jellyfin-v1`, `nashub-kid-v1`,
`nashub-cloud-backup-v1` (this device's online backup ID and the token that lets it update
that backup). **Moving to a new phone:** make a Backup code on the old one and Import it on
the new one, or save an online backup and restore it on the new phone with the backup ID and
passphrase — both bring credentials across. Joining the sync group from the new phone brings
tiles and addresses only; credentials then need entering again, which is intentional.

---

## 12. Support

Open an issue on the project's GitHub page (Manage → About → *Get the code*) with the app version (shown at the top of the app), the device and browser, and the exact message from section 10. If it is
a bridge problem, include the output of `python3 /root/nashub-agent.py check`.

---

*NAS Hub AI Help File — written for app version 4.10.8 and agent 1.0.0, September 2026; screens (sections 2 and 3) updated for the 4.21.0 redesign; licence removed and self-hosted sync added for 5.0.0 (agent 1.1.0), November 2026.
Generated from the application source, not from documentation about it. If the version at
the top of your app is newer, check `https://app.nashubapp.com/help/NASHUB-AI-HELP.md` for
the current file.*
