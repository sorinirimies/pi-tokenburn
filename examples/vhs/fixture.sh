#!/usr/bin/env bash
# Builds the throw-away data the pi-tokenburn demos (VHS tapes) run on, so no real
# session log, path or setting ever ends up in a recording.
#
#   examples/vhs/fixture.sh            create /tmp/pi-tokenburn-demo (900 days of pi
#                                      session logs, a demo config) — deterministic
#   examples/vhs/fixture.sh append     add one fresh assistant turn "now"
#   examples/vhs/fixture.sh env        print the environment the demos run with
#
# Run pi against it with:   eval "$(examples/vhs/fixture.sh env)"
set -euo pipefail

# Resolve symlinks (/tmp is /private/tmp on macOS) so pi's footer can show `~/…` for the project.
mkdir -p /tmp/pi-tokenburn-demo
DEMO="$(cd /tmp/pi-tokenburn-demo && pwd -P)"

if [ "${1:-}" = "env" ]; then
    cat <<ENV
export HOME=$DEMO/home
export PI_CODING_AGENT_DIR=$DEMO/agent
export PI_OFFLINE=1
export TZ=UTC
ENV
    exit 0
fi

if [ "${1:-}" = "append" ]; then
    # (sed, not head: `head` closing the pipe early would SIGPIPE `ls` under pipefail with 900+ files)
    f=$(ls -t "$DEMO"/agent/sessions/*/*.jsonl | sed -n 1p)
    python3 - "$f" <<'PY'
import json, sys, random, datetime
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
inp, out = random.randint(2, 12), random.randint(400, 2400)
cr, cw = random.randint(40_000, 160_000), random.randint(0, 9_000)
cost = round(cr * 0.0000003 + out * 0.000015 + cw * 0.00000375 + inp * 0.000003, 4)
line = {"timestamp": now, "message": {"role": "assistant", "usage": {
    "input": inp, "output": out, "cacheRead": cr, "cacheWrite": cw, "cost": {"total": cost}}}}
open(sys.argv[1], "a").write(json.dumps(line) + "\n")
PY
    exit 0
fi

rm -rf "$DEMO"
mkdir -p "$DEMO/home/projects/my-app" "$DEMO/agent/sessions"

python3 - "$DEMO" <<'PY'
import datetime as dt, json, os, random, sys
root = sys.argv[1]
rnd = random.Random(20261009)          # deterministic: same demo every time
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
DAYS = 900                             # ~2.5 years: enough for the year and all-time charts
PROJECTS = ["android-app", "api-gateway", "pi-extensions", "docs-site", "data-pipeline"]

def iso(t): return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
def day_weight(d):
    # busier on weekdays, a steady upward trend, the odd quiet day
    w = 0.2 if d.weekday() >= 5 else 1.0
    w *= 0.2 + 0.9 * (DAYS - (now.date() - d).days) / DAYS
    return w * rnd.choice([0.15, 0.6, 1, 1, 1.2, 1.7])

for ago in range(DAYS - 1, -1, -1):
    day = now.date() - dt.timedelta(days=ago)
    turns = max(1, int(70 * day_weight(day)))
    if ago == 0:
        turns = max(turns, 14)         # today always has something to show
    project = rnd.choice(PROJECTS)
    sess_dir = os.path.join(root, "agent", "sessions", f"--home-demo-projects-{project}--")
    os.makedirs(sess_dir, exist_ok=True)
    start = dt.datetime.combine(day, dt.time(8, 30), tzinfo=dt.timezone.utc)
    lines = []
    for i in range(turns):
        t = start + dt.timedelta(minutes=rnd.randint(0, 600))
        if t > now:                    # never write the future
            t = now - dt.timedelta(minutes=rnd.randint(1, 240))
        lines.append((t, {"timestamp": iso(t), "message": {"role": "user", "content": "…"}}))
        inp, out = rnd.randint(2, 14), rnd.randint(300, 3200)
        cr, cw = rnd.randint(30_000, 190_000), rnd.randint(0, 11_000)
        cost = round(cr * 0.0000003 + out * 0.000015 + cw * 0.00000375 + inp * 0.000003, 4)
        lines.append((t + dt.timedelta(seconds=20), {"timestamp": iso(t + dt.timedelta(seconds=20)), "message": {
            "role": "assistant", "usage": {"input": inp, "output": out, "cacheRead": cr, "cacheWrite": cw, "cost": {"total": cost}}}}))
    lines.sort(key=lambda x: x[0])
    name = f"{day.isoformat()}T08-30-00-000Z_{rnd.getrandbits(32):08x}.jsonl"
    with open(os.path.join(sess_dir, name), "w") as f:
        for _, rec in lines:
            f.write(json.dumps(rec) + "\n")

agent = os.path.join(root, "agent")
# demo config: a quick refresh so the live behaviour is visible, no panel to start with
with open(os.path.join(agent, "tokenburn.json"), "w") as f:
    json.dump({"enabled": True, "statusWindow": "today", "showWidget": False, "refreshMs": 250}, f, indent=2)
# A local demo model served by examples/vhs/mock-llm.ts: pi starts without a "no models / please
# log in" banner (which would print real install paths), and the live-refresh demo gets a real reply.
with open(os.path.join(agent, "models.json"), "w") as f:
    json.dump({"providers": {"demo": {"baseUrl": "http://127.0.0.1:8989/v1", "api": "openai-completions",
               "apiKey": "demo", "models": [{"id": "demo-model", "name": "demo-model", "contextWindow": 200000,
               "maxTokens": 8192, "cost": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}}]}}}, f, indent=2)
with open(os.path.join(agent, "settings.json"), "w") as f:
    json.dump({"defaultProvider": "demo", "defaultModel": "demo-model", "theme": "dark",
               "defaultThinkingLevel": "off", "lastChangelogVersion": "9.9.9"}, f, indent=2)
PY
echo "fixture ready: $DEMO"
