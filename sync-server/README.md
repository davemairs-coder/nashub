# NAS Hub sync server

A small Cloudflare Worker that NAS Hub uses for Group Sync, short share links, online backup, the TrueNAS bridge and down alerts. You run your own copy. It fits in Cloudflare's free plan for a household.

It stores only what your devices send it: the shared app list (never passwords), group membership, backups that are encrypted on your device before they leave it, and the short lived status reports from your NAS.

## Set it up (about ten minutes)

You need a free Cloudflare account and Node.js on a computer.

1. Get this folder onto your computer and open a terminal in it.
2. Sign in: `npx wrangler login`
3. Create the storage: `npx wrangler kv namespace create SYNC_KV`
4. Copy the `id` that command prints into `wrangler.toml`, replacing `PASTE-YOUR-KV-NAMESPACE-ID-HERE`.
5. Publish: `npx wrangler deploy`

Wrangler prints the address of your server, for example `https://nashub-sync.yourname.workers.dev`. Open it in a browser. You should see `{"service":"nashub-sync","version":"5.0.0"}`.

## Connect the app

In NAS Hub: Manage, Sync and backup, Group Sync. Paste the address into **Sync server** and tap **Save and test**. Then create your group. The invite link you share with your household carries the server address, so they do not have to type it.

## Down alerts (optional)

Alerts are push notifications when an app or a disk pool on your NAS goes down. They need a key pair that only your server holds.

```
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

For `VAPID_SUBJECT` enter `mailto:` followed by an email address you read. Push services use it to reach you if something goes wrong.

## Good to know

- **Who can use it:** anyone who knows the address can create a group on it. Group codes are random and wrong guesses are rate limited, but treat the address as something you share with people you trust.
- **Limits:** a group holds up to 999 devices and keeps its last 10 versions for rollback. A group that nobody touches for 400 days is removed by Cloudflare.
- **Free plan:** Cloudflare's free plan allows 1,000 storage writes a day. A household with the bridge and alerts on stays well under that.
- **Moving servers:** a group lives on one server. To move, set up the new server, leave the group, change the address and create the group again.

## Tests

```
cd test
npm install
npm test
```
