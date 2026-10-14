#!/usr/bin/env python3
"""Continue ComicHuddle's central GCD checkpoint from a private operator job.

Requires Python 3.10+ and standard library only. The Site owns supplier quota,
validation, D1 writes and durable cursors. This runner never calls GCD directly,
uses a Metron credential, downloads covers or derives valuations.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SITE = "https://comichuddle.aztooeasy.chatgpt.site"
BODY_LIMIT = 65536


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_site(value: str) -> str:
    url = urllib.parse.urlsplit(value)
    if (url.scheme != "https" or url.netloc != urllib.parse.urlsplit(DEFAULT_SITE).netloc
            or url.path not in ("", "/") or url.query or url.fragment
            or url.username or url.password):
        raise ValueError("Use this project's exact HTTPS Site origin.")
    return value.rstrip("/")


def request(site: str, token: str, action: str | None = None, *, opener=None):
    headers = {"Accept": "application/json",
               "OAI-Sites-Authorization": "Bearer " + token,
               "X-ComicHuddle-Catalog-Run": "owner-private-service"}
    payload = None
    if action is not None:
        payload = json.dumps({"action": action}).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(safe_site(site) + "/api/gcd-sync", data=payload, headers=headers)
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(req, timeout=55)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        data = response.read(BODY_LIMIT + 1)
        if len(data) > BODY_LIMIT:
            raise ValueError("The Site returned an oversized GCD status response.")
        if "application/json" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("The Site did not return JSON; verify private service access.")
        body = json.loads(data)
        if not isinstance(body, dict):
            raise ValueError("The Site returned an unreadable GCD status response.")
        return response.code, body


def summary(status: dict, steps: int, outcome: str) -> dict:
    # Explicit allowlist: no request headers, raw supplier records or error echo.
    daily, backfill = status.get("daily", {}), status.get("backfill", {})
    return {"outcome": outcome, "steps": steps,
            "importedIssueCount": status.get("importedIssueCount"),
            "lastGcdSyncedAt": status.get("lastGcdSyncedAt"),
            "dailyStage": daily.get("stage"),
            "dailyLastCompletedAt": daily.get("lastCompletedAt"),
            "dailyPending": daily.get("pending"),
            "dailyUnavailable": daily.get("unavailable"),
            "backfillStage": backfill.get("stage"),
            "backfillObservedSeriesCount": backfill.get("observedSeriesCount"),
            "backfillProcessedSeriesCount": backfill.get("processedSeriesCount"),
            "historicalCoverageComplete": False,
            "retryAfter": status.get("retryAfter", 0)}


def run(args, token: str, *, api=request, clock=time.monotonic, wait=time.sleep):
    code, status = api(args.site, token)
    if code != 200:
        return 1, {"outcome": "private-site-service-access-failed", "httpStatus": code}
    if args.mode == "status":
        return 0, summary(status, 0, "status")
    deadline, steps = clock() + args.max_seconds, 0
    while steps < args.max_steps and clock() < deadline:
        if status.get("pausedByOwner"):
            return 0, summary(status, steps, "paused-by-owner")
        retry = status.get("retryAfter", 0)
        if isinstance(retry, int) and retry > 0:
            if retry >= deadline - clock():
                return 0, summary(status, steps, "checkpointed-waiting-for-quota")
            wait(min(retry, 30))
            code, status = api(args.site, token)
            if code != 200:
                return 1, {"outcome": "status-read-failed", "httpStatus": code}
            continue
        daily, backfill = status.get("daily", {}), status.get("backfill", {})
        action = "daily_step"
        if (args.mode == "backfill" and daily.get("stage") == "complete"
                and not backfill.get("deferredForRecentRefresh", True)):
            if backfill.get("stage") == "pass_complete":
                return 0, summary(status, steps, "observed-series-pass-finished")
            action = "backfill_step"
        code, latest = api(args.site, token, action)
        steps += 1
        if code == 429:
            code, status = api(args.site, token)
            if code != 200:
                return 1, {"outcome": "quota-status-read-failed", "httpStatus": code}
            continue
        if code != 200:
            return 1, {"outcome": "step-failed-checkpoint-retained", "httpStatus": code, "steps": steps}
        status = latest
        if args.mode == "daily" and status.get("daily", {}).get("stage") == "complete":
            return 0, summary(status, steps, "recent-release-sweep-complete")
    return 0, summary(status, steps, "checkpointed-run-budget-reached")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--mode", choices=("daily", "backfill", "status"), default="daily")
    parser.add_argument("--max-steps", type=int, default=12)
    parser.add_argument("--max-seconds", type=int, default=45)
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 100 or not 1 <= args.max_seconds <= 3600:
        parser.error("Use 1–100 steps and 1–3600 seconds per run.")
    args.site = safe_site(args.site)
    token = os.environ.get("COMICHUDDLE_SERVICE_TOKEN", "")
    if not token or len(token) > 8192 or any(ord(c) < 32 for c in token):
        print(json.dumps({"outcome": "missing-private-site-service-credential"}))
        return 2
    try:
        code, result = run(args, token)
    except (OSError, ValueError, urllib.error.URLError):
        code, result = 1, {"outcome": "runner-failed-checkpoint-retained"}
    print(json.dumps(result))
    return code


if __name__ == "__main__":
    sys.exit(main())
