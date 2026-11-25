# NAS Hub app — changelog

Newest first. Started at 4.16.0.

## 5.0.0 — 2026-11-24 — free and open source

Asked for by Dave (2026-11-23): no sales, so the app becomes a free open source project.

**Why:** there is no paying market for NAS Hub. One free build with everything in it is simpler to keep and more useful to people.

- **Every feature is included.** The licence check, the Pro tier, the licence screen and the Unlock Pro flow are removed. Kid mode, 24 hour uptime, down alerts, rollback, editor rights and making your own tile packs need no key.
- **Group Sync is something you host yourself.** There is no shared sync server any more. Manage → Sync & backup → Group Sync has a **Sync server** box: enter the address of your own copy (the `sync-server` folder), tap Save and test. Short share links, online backup, the NAS bridge and down alerts use the same address. With no address set those features say "Set your sync server first" and send nothing anywhere.
- **Invite links carry the server.** A link that names a server this device has not used asks first.
- **About** replaces License in Manage: version, MIT license, a link to the code and the one credit line.
- The "Is NAS Hub working out for you?" prompt is off: it sent people to the closed store's review page.
- The bridge agent is 1.1.0: `install` takes the sync server address as a third value, and nothing is sent without one.
- Sync server 5.0.0: licence and store routes removed, every group gets the same 999 device cap, `GET /` answers with the service name so the app can test an address.
- Tests: `test/redesign/manage.mjs` covers About, the unlocked features and the server box; new `test/redesign/invite.mjs` covers invite links. The licence tests (`unlock.mjs`, `e2e-unlock.mjs`, `rate.js`, the sync server's `claim.mjs`) are removed with the code they tested.
- Version 5.0.0 in `index.html` and the `sw.js` cache name.

**If you used Group Sync before 5.0.0:** your group lived on the old shared server. Set up your own sync server and create the group again there, or keep the old address in the Sync server box for as long as that server stays up.

## 4.22.0 — 2026-11-21 — real app logos


**Why:** the redesign used simple line icons for every app until a logo licence was checked; people recognise their apps by logo.

- Tiles, the app sheet, the status list, All apps, the catalog, the custom app form, kid mode and search show each app's real logo.
- 51 logos from Dashboard Icons (Apache-2.0) are bundled in `logos/` with `logos/LICENSE.txt`, cached for offline use, and included in the deploy list and the self-host zip. Nothing is loaded from a CDN.
- Custom apps get a logo when the name plainly names the product (Homebox; GL.iNet routers such as Flint and Opal). Others keep their simple icon.
- Choose icon starts with "App logos"; picking a simple icon or an emoji turns the logo off for that app.
- A logo name from a share link, sync or backup is accepted only if it is one of the bundled files.
- Version 4.22.0 in `index.html` and the `sw.js` cache name.

## 4.21.0 — 2026-11-21 — Tailscale: settings and a separate setup guide


**Why:** the Tailscale screen mixed your settings with a long how-to, in one scroll. It was the one screen phase 4 left as it was.

- **Tailscale** (Manage → Access → Tailscale) shows only the settings: hostname and protocol, home NAS IP, the apps on a Tailscale address, and four "Setup guide" rows.
- **Setup guide** is its own screen with the four numbered steps and the tips. Back returns to Tailscale.
- Fixed two untrue lines: the guide promised a "TS badge" on tiles (removed in 4.17.0), and the hostname text called the network button a switch.
- Search finds "Tailscale setup guide".
- Version 4.21.0 in `index.html` and the `sw.js` cache name.

## 4.20.0 — 2026-11-21 — redesign phase 5: adding apps

Spec phase 5, the last (Quiet Shelf).

**Why:** a new user met a five-step welcome, a two-column catalog of small cards, a form with a wall of 40 icons, and a Save button that ignored the first tap.

- **First run** is one screen: "Put your NAS apps one tap away", with four ways in (catalog, find them for me, shared link, sync code), a link to the demo, and "Start with an empty shelf".
- **Add apps** has three groups: Pick them yourself (catalog, Starter packs, Custom app), Find what's already running (TrueNAS, Portainer, network scanner), Bring a list (shared link, spreadsheet).
- **App catalog** is a one-column list with search, category buttons and Add / Added.
- **Starter packs** restyled with readable chips and buttons.
- **Custom app and edit form:** calmer, with sentence-case labels at 15 px; the icon is chosen in a sheet ("Choose an icon", or type any emoji); colours are radio buttons.
- **Fixed (also in the live app):** the first tap on "Add to NAS Hub" right after typing in a box did nothing. The form's redraw now waits until the tap is over.
- **Fixed:** the yellow colour swatch showed brown in light mode.
- Version 4.20.0 in `index.html` and the `sw.js` cache name.

## 4.19.0 — 2026-11-21 — redesign phase 4: Manage as screens

Spec phase 4 (Quiet Shelf).

**Why:** Manage was six accordions of colour-washed buttons, the browser's own grey boxes asked the questions, and there was no consistent way back.

- **Manage** is three short lists (Your apps, Connection, NAS Hub). Each row shows what's inside and its state. Appearance, the welcome screen and the AI help file are rows; the version shows once, in the header.
- **Five section screens:** Add apps, Organize, Access, Sync & backup, Monitoring, each with a back arrow. Face ID is a switch. Monitoring with no sync group offers "Set up a sync group".
- **Back:** every screen except Home has a back arrow beside its title that goes up one level, or back to where the screen was opened from. The phone's back button does the same and stops at Home (not in the demo).
- **No more browser confirm boxes:** restore, remove licence, leave or delete a group, restore a version, editor rights, delete a pack or online backup, and a new agent token all ask in the app's own sheet, with the same wording.
- **Restore from code** is a sheet. **Addresses → Change** is a sheet ("My NAS moved").
- **All apps** has a drag handle; the arrow keys still move a row for keyboard and screen-reader users.
- **Groups** with none shows one card with "Create a group".
- Online backup, spreadsheet and down-alert controls restyled to match; their text is 15 px.
- Search finds Backup & restore, Down alerts and Face ID lock.
- Version 4.19.0 in `index.html` and the `sw.js` cache name.

## 4.18.0 — 2026-11-21 — redesign phase 3: status list and app sheet

Spec phase 3 (Quiet Shelf).

**Why:** the Home sentence said something was wrong but gave nowhere to go, and the app panel was a stack of boxed buttons and shouting capital labels.

- **Status list:** tapping the Home sentence ("11 of 12 apps are up ›") opens a list with the apps that need attention first (with their recent checks and when a down app last answered), then every answering app as one plain row, then apps not set up yet. Each row opens the app's sheet.
- **App sheet:** the app panel is now a bottom sheet: big icon and name, status, the saved sign-in with Copy beside each line, one "Open" button, "Jump straight to" shortcuts as pills, the address with Copy, then the existing live info, recent checks and 24-hour history. Favourite and Edit sit at the foot.
- **Drag down to close** the app sheet and the network chooser (from the grab bar or the header). Tap outside, ✕ and Escape still work.
- The demo strip hides while a sheet is open, so its buttons can be tapped.
- Version 4.18.0 in `index.html` and the `sw.js` cache name.

## 4.17.0 — 2026-11-21 — redesign phase 2: the new Home

Spec phase 2 (Quiet Shelf). Dave decided on 2026-11-21 that Home loses the per-tile dots and bars.

**Why:** Home carried six status marks per tile and three bars saying the same thing; a stranger couldn't see at a glance whether anything was wrong.

- **Status sentence** ("All 12 apps are up" / "11 of 12 apps are up" + "qBittorrent isn't answering. Check again") replaces the online strip and the per-section counts. The trouble banners underneath are unchanged.
- **New tile:** the icon on a light plate and the name. No dot, star, coloured edge, uptime bars, Tailscale or Jellyfin badge. A down app greys out with a red-tinted plate and a "Down" badge; slow, stopped and similar states show as a word under the name. Names wrap to two lines.
- **Favourites appear once:** a favourite is left out of the sections below. Starring moved to the app's panel.
- **Network pill and chooser:** the Home / Away / Auto bar is one pill that opens a sheet with the three choices (Escape and tapping outside close it). Without a Tailscale host the pill offers "Set up Away".
- **Bottom bar:** search and the + add button moved from the header to the bottom of Home, where a thumb reaches them. Other screens keep their header buttons.
- **Wide windows** (900 px and up): status on the left, the apps on the right, wider grid.
- The Add App / Custom App buttons at the foot of Home are gone; both are in the catalog (+).
- Version 4.17.0 in `index.html` and the `sw.js` cache name. 4.16.0 was never deployed; this release carries it.

## 4.16.0 — 2026-11-21 — redesign phase 1: new look, nothing moved

Spec (Quiet Shelf).

**Why:** the app looked clunky: emoji as icons, four typefaces, two half-matching colour sets and a dark band in light mode. Phase 1 fixes the look without moving anything, so it can ship on its own.

- **One set of colours for light and dark.** New tokens (`--ground`, `--surface`, `--ink`, `--accent` …) on `:root` and `:root.light`; the old `--t1 … --bad` names now point at them. Every hard-coded colour in a style was mapped to a token by `test/redesign/recolor.py` (hue + lightness + which property it sets). Bright status fills (uptime bars, live badges) are left as they were for phase 2.
- **Three bundled typefaces** in `fonts/` (Syne for titles, Instrument Sans for text, IBM Plex Mono for addresses and codes), OFL, licences in `fonts/LICENSES.txt`. The Google Fonts link is gone, so fonts work offline; the service worker precaches them.
- **Line icons instead of emoji** (Lucide, ISC). Swapped at draw time by a small observer, so saved apps, share links, backups and copied text keep their emoji. A person's own typed emoji with no line icon is left alone. Icon-only buttons keep a spoken name.
- **Light mode no longer has a dark band** under short screens: the theme class is now on `<html>` too, and the page background comes from the ground colour. The phone's status-bar colour follows the theme.
- **320 px header fits** (it was 7 px too wide; the bolt is hidden below 340 px).
- Version 4.16.0 in `index.html` and the `sw.js` cache name. 4.15.0 (Unlock Pro, switched off) was never deployed; this release carries it, still switched off.
- Deploy lists updated: the README `wrangler` copy step and `make-selfhost.sh` include `fonts/`. `_headers` lets phones keep the font files for a year.
