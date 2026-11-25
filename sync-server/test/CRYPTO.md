# Why the worker implements Web Push by hand

A Worker has no npm at runtime, and pulling a push library in would mean a lot
of unread code holding the keys to everyone's phone. So `worker.js` implements
RFC 8291 (message encryption), RFC 8188 (aes128gcm content coding) and RFC 8292
(VAPID) directly on WebCrypto.

Hand-written crypto is only trustworthy if something independent agrees with it,
so `cryptotest.js` encrypts with **the same salt and the same sender keypair**
using both the worker's code and the `web-push` npm package, and requires the
output to be **byte-identical**. It then decrypts the worker's output with
`http_ece`'s decryptor — the receiving half — and checks the plaintext comes
back. The VAPID JWT is verified against its own public key, and against a
tampered payload to confirm the check can fail.

`e2e.mjs` goes further: it runs the actual worker module against an in-memory KV
and a fake push service that **really decrypts** what it is sent. Nothing that
matters is stubbed. That is what proves the notification a phone receives says
`sonarr crashed` and not a pile of bytes.

Run `npm install` here first; the worker ships with no dependencies.
