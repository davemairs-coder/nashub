#!/usr/bin/env python3
"""
NAS Hub bridge agent — runs ON the NAS, pushes what it sees to the NAS Hub
worker, so the phone app can read it from anywhere without reaching into
your network.

Why this exists instead of a one-line cron job:

  A phone cannot talk to TrueNAS directly. The middleware sends no CORS
  headers, answers the preflight with 405, and ships a self-signed cert, so
  a browser refuses the request before it leaves the device. Every one of
  those walls exists because the PHONE is the one reaching in. Reverse the
  arrow and they all disappear: the NAS makes an ordinary outbound HTTPS
  request, and the phone reads the result from the same origin as the app.

  The one-liner this replaces did work, but it was a single long pipe with
  no error handling. If `midclt` was missing, or its output shape differed,
  or the network was down, it printed nothing and the phone just kept
  saying "nothing has arrived yet" — with no way to find out why. This
  script says what happened, retries what is worth retrying, and has a
  `check` mode that diagnoses the whole chain in one command.

Usage
  python3 nashub-agent.py check        # diagnose everything, change nothing
  python3 nashub-agent.py push         # collect and send once (cron runs this)
  python3 nashub-agent.py install CODE TOKEN SERVER   # write the config and print the cron line

Configuration, in order of precedence: command line, environment, config file.
  NASHUB_CODE    your sync group code, the XXX-XXX the app shows, e.g. ABC-123
  NASHUB_TOKEN   the agent token the app generated (password-equivalent)
  NASHUB_API     address of your own sync server (required since 1.1.0; there is no shared one)
  NASHUB_TN_KEY  optional TrueNAS API key, only used if `midclt` is missing

Requires python3 and nothing else. TrueNAS SCALE ships python3 — its own
middleware is written in it — so there is nothing to install.
"""

import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

AGENT_VERSION = "1.1.0"
CONF_PATHS = [
    os.path.expanduser("~/.nashub-agent.conf"),
    "/root/.nashub-agent.conf",
    "/etc/nashub-agent.conf",
]
LOG_PATH = os.environ.get("NASHUB_LOG", "/var/log/nashub-agent.log")
LOG_MAX = 256 * 1024
# The worker refuses anything over 128KB. Raw `app.query` on a busy NAS is far
# larger than that, which is the main reason this script exists rather than a
# straight pipe: we send only the handful of fields the app actually renders.
MAX_BYTES = 120 * 1024
TIMEOUT = 20


# ── plumbing ────────────────────────────────────────────────────────────────

def log(msg):
    line = "%s  %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > LOG_MAX:
            # Truncate rather than rotate: a log nobody configured logrotate for
            # should not be allowed to fill a pool.
            with open(LOG_PATH, "r") as f:
                tail = f.read()[-LOG_MAX // 2:]
            with open(LOG_PATH, "w") as f:
                f.write(tail)
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass  # a NAS with an unwritable /var/log is still a NAS worth reporting on


def load_config():
    cfg = {}
    for path in CONF_PATHS:
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                for raw in f:
                    raw = raw.strip()
                    if not raw or raw.startswith("#") or "=" not in raw:
                        continue
                    k, v = raw.split("=", 1)
                    cfg[k.strip().upper()] = v.strip().strip('"').strip("'")
            break
        except Exception as e:
            log("could not read %s: %s" % (path, e))
    for k in ("NASHUB_CODE", "NASHUB_TOKEN", "NASHUB_API", "NASHUB_TN_KEY"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


# ── collecting, two ways ────────────────────────────────────────────────────
# `midclt` is the local middleware client. It runs as root on the NAS, needs no
# API key and no network, and is the right tool. But it has never been verified
# on a real box by whoever wrote this, so there is a second path: the same
# middleware over its own REST API with an API key. If the primary is missing or
# its output shape has changed, the fallback still gets a report through.

def have_midclt():
    for d in os.environ.get("PATH", "").split(os.pathsep) + ["/usr/bin", "/usr/local/bin", "/bin"]:
        p = os.path.join(d, "midclt")
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def midclt(method, timeout=30):
    path = have_midclt()
    if not path:
        raise RuntimeError("midclt is not on this system")
    proc = subprocess.run([path, "call", method], capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError("midclt call %s failed: %s"
                           % (method, (proc.stderr or b"").decode("utf-8", "replace").strip()[:300]))
    out = (proc.stdout or b"").decode("utf-8", "replace").strip()
    if not out:
        raise RuntimeError("midclt call %s returned nothing" % method)
    return json.loads(out)


def rest(cfg, path, timeout=TIMEOUT):
    key = cfg.get("NASHUB_TN_KEY")
    if not key:
        raise RuntimeError("no TrueNAS API key set (NASHUB_TN_KEY)")
    # Talking to the middleware on this same machine, whose cert is the
    # self-signed one TrueNAS ships. Verification would only be checking the box
    # against itself over loopback, so it is skipped deliberately and ONLY here.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request("https://127.0.0.1/api/v2.0" + path,
                                 headers={"Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# ── normalising ─────────────────────────────────────────────────────────────
# Three different shapes have to end up as one: `app.query` on SCALE 24.10+,
# `chart/release` on older SCALE, and whatever a future version renames them to.
# The app only ever reads name, state and a port, so that is all that is kept —
# which is also what gets the payload under the worker's size cap.

STATE_MAP = {"ACTIVE": "RUNNING", "STARTED": "RUNNING", "STOPPING": "STOPPED", "DEPLOYING": "DEPLOYING"}


def norm_apps(raw):
    out = []
    for a in (raw or [])[:200]:
        if not isinstance(a, dict):
            continue
        name = a.get("name") or a.get("id") or ""
        state = str(a.get("state") or a.get("status") or "").upper()
        rec = {
            "id": str(a.get("id") or name)[:80],
            "name": str(name)[:80],
            "state": STATE_MAP.get(state, state)[:20],
        }
        portals = a.get("portals")
        if isinstance(portals, dict) and portals:
            # Keep one portal. The app only reads a port out of it, and a dozen
            # portals per app is how the payload blew past the cap.
            k = next(iter(portals))
            v = portals[k]
            if isinstance(v, list):
                v = v[0] if v else ""
            rec["portals"] = {str(k)[:40]: str(v)[:200]}
        used = (a.get("active_workloads") or {}).get("used_ports") if isinstance(a.get("active_workloads"), dict) else None
        if isinstance(used, list) and used:
            rec["active_workloads"] = {"used_ports": used[:8]}
        if rec["name"]:
            out.append(rec)
    return out


def norm_pools(raw):
    out = []
    for p in (raw or [])[:20]:
        if not isinstance(p, dict):
            continue
        rec = {"name": str(p.get("name") or "")[:60], "status": str(p.get("status") or "")[:20]}
        if isinstance(p.get("healthy"), bool):
            rec["healthy"] = p["healthy"]
        # ZFS reports these as ints on some versions and strings on others.
        for k in ("free", "allocated", "size"):
            v = p.get(k)
            try:
                n = float(v)
                if n >= 0:
                    rec[k] = int(n)
            except (TypeError, ValueError):
                pass
        if rec["name"]:
            out.append(rec)
    return out


def norm_info(raw):
    if not isinstance(raw, dict):
        return None
    return {
        "hostname": str(raw.get("hostname") or "")[:80],
        "version": str(raw.get("version") or "")[:60],
        "uptime": str(raw.get("uptime") or "")[:60],
    }


def collect(cfg):
    """Returns (report, how, problems). Partial results are kept: a NAS whose
    pools read fine but whose app list failed is still worth reporting."""
    problems = []
    info = apps = pools = None
    how = None

    if have_midclt():
        how = "midclt"
        for label, method, setter in (("info", "system.info", "info"),
                                      ("apps", "app.query", "apps"),
                                      ("pools", "pool.query", "pools")):
            try:
                val = midclt(method)
                if setter == "info":
                    info = val
                elif setter == "apps":
                    apps = val
                else:
                    pools = val
            except Exception as e:
                problems.append("%s: %s" % (method, e))
        # SCALE renamed chart releases to apps. If app.query is not a method on
        # this version, the old name still is.
        if apps is None:
            try:
                apps = midclt("chart.release.query")
                problems.append("app.query unavailable; used chart.release.query")
            except Exception:
                pass

    if info is None and apps is None and pools is None and cfg.get("NASHUB_TN_KEY"):
        how = "rest"
        for label, paths in (("info", ["/system/info"]),
                             ("apps", ["/app", "/chart/release"]),
                             ("pools", ["/pool"])):
            for path in paths:
                try:
                    val = rest(cfg, path)
                    if label == "info":
                        info = val
                    elif label == "apps":
                        apps = val
                    else:
                        pools = val
                    break
                except Exception as e:
                    problems.append("REST %s: %s" % (path, e))

    if how is None:
        problems.append("neither midclt nor a TrueNAS API key is available")

    report = {
        "agent": "script/%s" % AGENT_VERSION,
        "info": norm_info(info),
        "apps": norm_apps(apps),
        "pools": norm_pools(pools),
    }
    return report, how, problems


def shrink(report):
    """Stay under the worker's cap by dropping detail, never whole apps: a
    missing app reads as 'not installed', which is a lie. A missing port reads
    as 'no web port', which is merely less useful."""
    body = json.dumps(report, separators=(",", ":"))
    if len(body) <= MAX_BYTES:
        return body, False
    for a in report["apps"]:
        a.pop("active_workloads", None)
    body = json.dumps(report, separators=(",", ":"))
    if len(body) <= MAX_BYTES:
        return body, True
    for a in report["apps"]:
        a.pop("portals", None)
    return json.dumps(report, separators=(",", ":")), True


def push(cfg, report):
    body, trimmed = shrink(report)
    url = "%s/sync/%s/nas" % (cfg["NASHUB_API"].rstrip("/"), cfg["NASHUB_CODE"])
    req = urllib.request.Request(url, data=body.encode("utf-8"), method="POST", headers={
        "Authorization": "Bearer " + cfg["NASHUB_TOKEN"],
        "Content-Type": "application/json",
        # 1.0.1: Cloudflare refuses Python's default "Python-urllib/3.x" with error 1010
        # (browser signature) before the worker ever sees the report. Found on Dave's
        # TrueNAS 2026-11-01, the first push from a real NAS.
        "User-Agent": "nashub-agent/%s (+https://nashubapp.com)" % AGENT_VERSION,
    })
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8", "replace")), trimmed
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200]
            # 401/403/404 are verdicts, not weather. Retrying a wrong token
            # three times just writes the same failure three times.
            if e.code in (400, 401, 403, 404, 413):
                raise RuntimeError("worker refused the report (HTTP %d): %s" % (e.code, detail))
            last = RuntimeError("HTTP %d: %s" % (e.code, detail))
        except Exception as e:
            last = e
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise last


# ── commands ────────────────────────────────────────────────────────────────

def cmd_push(cfg):
    missing = [k for k in ("NASHUB_CODE", "NASHUB_TOKEN") if not cfg.get(k)]
    if missing:
        log("not configured: %s missing. Run: python3 %s install" % (", ".join(missing), sys.argv[0]))
        return 2
    report, how, problems = collect(cfg)
    for p in problems:
        log("warning: %s" % p)
    if not report["apps"] and not report["pools"] and not report["info"]:
        log("nothing could be collected — not sending an empty report")
        return 1
    try:
        res, trimmed = push(cfg, report)
    except Exception as e:
        log("push failed: %s" % e)
        return 1
    log("pushed via %s: %d apps, %d pools%s"
        % (how, len(report["apps"]), len(report["pools"]), ", trimmed to fit" if trimmed else ""))
    return 0


def cmd_check(cfg):
    ok = True
    print("NAS Hub bridge agent %s\n" % AGENT_VERSION)

    print("1. Reading from TrueNAS")
    path = have_midclt()
    print("   midclt            %s" % (path if path else "NOT FOUND"))
    report, how, problems = collect(cfg)
    for p in problems:
        print("   ! %s" % p)
    print("   method used       %s" % (how or "none"))
    print("   system info       %s" % (report["info"]["hostname"] if report["info"] else "—"))
    print("   apps found        %d%s" % (len(report["apps"]),
          ("  (" + ", ".join("%s:%s" % (a["name"], a["state"]) for a in report["apps"][:6]) + ")") if report["apps"] else ""))
    print("   pools found       %d%s" % (len(report["pools"]),
          ("  (" + ", ".join("%s/%s" % (p["name"], p["status"]) for p in report["pools"]) + ")") if report["pools"] else ""))
    if not report["apps"] and not report["pools"]:
        print("   → Nothing was read. If midclt is missing, set NASHUB_TN_KEY to a")
        print("     TrueNAS API key (top-right account menu → My API Keys) and retry.")
        ok = False

    print("\n2. Configuration")
    for k in ("NASHUB_API", "NASHUB_CODE"):
        print("   %-17s %s" % (k, cfg.get(k) or "NOT SET"))
    print("   %-17s %s" % ("NASHUB_TOKEN", "set (%d chars)" % len(cfg["NASHUB_TOKEN"]) if cfg.get("NASHUB_TOKEN") else "NOT SET"))
    if not cfg.get("NASHUB_CODE") or not cfg.get("NASHUB_TOKEN") or not cfg.get("NASHUB_API"):
        print("   → Run: python3 %s install <code> <token> <your sync server address>" % sys.argv[0])
        return 1 if ok else 1

    print("\n3. Sending to the worker")
    if not report["apps"] and not report["pools"] and not report["info"]:
        # Refuse to push an empty report even from `check`. The phone would
        # accept it as the current truth and show a NAS with no apps and no
        # pools, which is a worse lie than showing nothing at all.
        print("   skipped           nothing was collected, so there is nothing honest to send")
        print("\nFix step 1 first — an empty report would tell your phone the NAS has no apps.")
        return 1
    body, trimmed = shrink(report)
    print("   payload           %d bytes%s" % (len(body), " (trimmed to fit)" if trimmed else ""))
    try:
        res, _ = push(cfg, report)
        print("   result            accepted: %s" % json.dumps(res))
    except Exception as e:
        print("   result            FAILED: %s" % e)
        ok = False

    print("\n%s" % ("Everything works. Add the cron job and you are done."
                    if ok else "Something above needs fixing before this will work."))
    return 0 if ok else 1


def cmd_install(cfg, args):
    code = args[0] if len(args) > 0 else cfg.get("NASHUB_CODE") or input("Sync group code: ").strip()
    token = args[1] if len(args) > 1 else cfg.get("NASHUB_TOKEN") or input("Agent token: ").strip()
    # 1.1.0: there is no shared sync server, so the address is the third thing needed.
    if len(args) > 2:
        cfg["NASHUB_API"] = args[2]
    if not cfg.get("NASHUB_API"):
        cfg["NASHUB_API"] = input("Your sync server address (https://...): ").strip()
    if not cfg["NASHUB_API"].startswith(("https://", "http://")):
        print("The sync server address must start with https:// (the app shows it under Sync).")
        return 2
    if not code or not token:
        print("Both a group code and an agent token are needed. The app shows both:")
        print("Manage → Add apps → TrueNAS → Set up the NAS bridge.")
        return 2
    target = CONF_PATHS[1] if os.access("/root", os.W_OK) else CONF_PATHS[0]
    with open(target, "w") as f:
        f.write("# NAS Hub bridge agent. This file holds a password-equivalent token.\n")
        f.write("NASHUB_CODE=%s\n" % code)
        f.write("NASHUB_TOKEN=%s\n" % token)
        f.write("NASHUB_API=%s\n" % cfg["NASHUB_API"])
        if cfg.get("NASHUB_TN_KEY"):
            f.write("NASHUB_TN_KEY=%s\n" % cfg["NASHUB_TN_KEY"])
    try:
        os.chmod(target, 0o600)
    except Exception:
        pass
    here = os.path.abspath(sys.argv[0])
    print("Wrote %s (mode 600)\n" % target)
    print("Now add this in TrueNAS under Data Protection → Cron Jobs → Add,")
    print("running as root, every 5 minutes:\n")
    print("    /usr/bin/env python3 %s push\n" % here)
    print("Check it works first with:\n")
    print("    python3 %s check\n" % here)
    return 0


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "push"
    if cmd in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cfg = load_config()
    if cmd == "check":
        return cmd_check(cfg)
    if cmd == "install":
        return cmd_install(cfg, args[1:])
    if cmd == "push":
        if not cfg.get("NASHUB_API"):
            print("NASHUB_API is not set. Run: python3 %s install <code> <token> <your sync server address>" % sys.argv[0])
            return 2
        return cmd_push(cfg)
    print("Unknown command %r. Try: check, push, install, --help" % cmd)
    return 2


if __name__ == "__main__":
    sys.exit(main())
