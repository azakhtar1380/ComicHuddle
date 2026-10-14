#!/usr/bin/env python3
"""Run the server-owned Metron import; keep provider credentials out of clients.

Requires Python 3.10+ and only the standard library. The server owns catalog
normalization, quotas, leases and durable checkpoints. This runner never fetches
Metron, stores a token on disk, uploads artwork, or substitutes prices for FMV.
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
BODY_LIMIT = 32768


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


def request(site: str, token: str, action: str | None = None,
            scope: dict | None = None, *, opener=None) -> tuple[int, dict]:
    headers = {"Accept": "application/json",
               "OAI-Sites-Authorization": "Bearer " + token,
               "X-ComicHuddle-Catalog-Run": "owner-private-service"}
    payload = None
    if action is not None:
        body = {"action": action}
        if scope is not None:
            body["scope"] = scope
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(safe_site(site) + "/api/catalog-sync",
                                 data=payload, headers=headers)
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(req, timeout=55)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        data = response.read(BODY_LIMIT + 1)
        if len(data) > BODY_LIMIT:
            raise ValueError("The Site returned an oversized sync response.")
        if "application/json" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("The Site did not return sync JSON; verify private service access.")
        body = json.loads(data)
        if not isinstance(body, dict):
            raise ValueError("The Site returned an unreadable sync response.")
        return response.code, body


def summary(status: dict, steps: int, outcome: str) -> dict:
    # Explicit allowlist: do not log request headers, provider data or raw errors.
    return {"outcome": outcome, "steps": steps,
            "stage": status.get("stage"), "imported": status.get("imported"),
            "checkedRecords": status.get("checkedRecords"),
            "lastCompletedAt": status.get("lastCompletedAt"),
            "retryAfter": status.get("retryAfter", 0)}


def run(args, token: str, *, api=request, clock=time.monotonic,
        wait=time.sleep) -> tuple[int, dict]:
    code, status = api(args.site, token)
    if code != 200:
        return 1, {"outcome": "site-access-or-service-error", "httpStatus": code}
    if not status.get("configured") or not status.get("accessReady"):
        return 0, summary(status, 0, "waiting-for-operator-metron-configuration")
    if status.get("pausedByOwner") and args.mode == "nightly":
        return 0, summary(status, 0, "paused-by-owner")
    if args.mode == "status":
        return 0, summary(status, 0, "status")
    if status.get("stage") == "idle":
        scope = {key: value for key, value in {
            "publisherName": args.publisher, "startDate": args.start_date,
            "endDate": args.end_date}.items() if value}
        code, status = api(args.site, token, "start", scope)
        if code != 200:
            return 1, {"outcome": "initial-scope-rejected", "httpStatus": code}
    elif any((args.publisher, args.start_date, args.end_date)):
        requested = {key: value for key, value in {
            "publisherName": args.publisher, "startDate": args.start_date,
            "endDate": args.end_date}.items() if value}
        if any(status.get("scope", {}).get(key) != value for key, value in requested.items()):
            return 1, {"outcome": "scope-already-checkpointed-use-data-studio"}
    if status.get("stage") == "complete" and args.mode == "resume":
        return 0, summary(status, 0, "complete")
    deadline, steps = clock() + args.max_seconds, 0
    action = "nightly_step" if args.mode == "nightly" else "step"
    while steps < args.max_steps and clock() < deadline:
        retry = status.get("retryAfter", 0)
        if isinstance(retry, int) and retry > 0:
            if retry >= deadline - clock():
                return 0, summary(status, steps, "checkpointed-waiting-for-quota")
            # Keep each wait short. Long daily limits leave the checkpoint for
            # the next scheduled run rather than occupying a cloud task.
            wait(min(retry, 30))
            code, status = api(args.site, token)
            if code != 200:
                return 1, {"outcome": "status-read-failed", "httpStatus": code}
            continue
        code, status = api(args.site, token, action)
        steps += 1
        if code == 429:
            code, latest = api(args.site, token)
            if code != 200:
                return 1, {"outcome": "quota-status-read-failed", "httpStatus": code}
            status = latest
            continue
        if code != 200:
            return 1, {"outcome": "step-failed-checkpoint-retained",
                       "httpStatus": code, "steps": steps}
        if status.get("stage") == "complete":
            return 0, summary(status, steps, "complete")
        if status.get("stage") == "paused":
            return 0, summary(status, steps, "checkpointed-reconciliation-needed")
    return 0, summary(status, steps, "checkpointed-run-budget-reached")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--mode", choices=("nightly", "resume", "status"), default="nightly")
    parser.add_argument("--publisher", default="")
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--max-steps", type=int, default=1000)
    parser.add_argument("--max-seconds", type=int, default=1800)
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 2000 or not 1 <= args.max_seconds <= 3600:
        parser.error("Use 1–2000 steps and 1–3600 seconds per run.")
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
