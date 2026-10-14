"""Run: python checks/gcd-runner.py. Synthetic private-Site HTTP only."""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("gcd_runner", Path("scripts/gcd_catalog_sync.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
TOKEN = "SYNTHETIC_PRIVATE_SITE_CREDENTIAL"
args = SimpleNamespace(site=runner.DEFAULT_SITE, mode="daily", max_steps=12, max_seconds=45)


def status(**values):
    return {"pausedByOwner": False, "retryAfter": 0, "importedIssueCount": 1,
            "daily": {"stage": "importing", "pending": 5},
            "backfill": {"stage": "idle", "deferredForRecentRefresh": True}, **values}


passed = 0


def test(name, run):
    global passed
    run()
    passed += 1
    print("PASS: " + name)


def access_case():
    calls = []
    class Reply(io.BytesIO):
        code = 200
        headers = {"Content-Type": "application/json"}
    class Opener:
        def open(self, req, timeout):
            calls.append((req, timeout))
            return Reply(json.dumps(status()).encode())
    code, value = runner.request(runner.DEFAULT_SITE, TOKEN, "daily_step", opener=Opener())
    assert code == 200 and value["daily"]["stage"] == "importing"
    req, timeout = calls[0]
    assert req.full_url == runner.DEFAULT_SITE + "/api/gcd-sync"
    assert req.get_header("Oai-sites-authorization") == "Bearer " + TOKEN
    assert req.get_header("X-comichuddle-catalog-run") == "owner-private-service"
    assert req.get_header("Origin") is None
    assert json.loads(req.data) == {"action": "daily_step"} and timeout == 55
    for unsafe in ("http://comichuddle.aztooeasy.chatgpt.site", "https://evil.test", runner.DEFAULT_SITE + "/else", runner.DEFAULT_SITE + "?x=1"):
        try:
            runner.safe_site(unsafe)
            raise AssertionError("Unsafe service origin accepted")
        except ValueError:
            pass


def response_case():
    class Reply(io.BytesIO):
        code = 200
    class Opener:
        def __init__(self, data, content_type):
            self.data, self.content_type = data, content_type
        def open(self, req, timeout):
            r = Reply(self.data)
            r.headers = {"Content-Type": self.content_type}
            return r
    for data, content_type in ((b"x" * (runner.BODY_LIMIT + 1), "application/json"), (b"{}", "text/html"), (b"[]", "application/json")):
        try:
            runner.request(runner.DEFAULT_SITE, TOKEN, opener=Opener(data, content_type))
            raise AssertionError("Invalid service response accepted")
        except ValueError:
            pass


def paused_case():
    calls = []
    def api(site, token, action=None):
        calls.append(action)
        return 200, status(pausedByOwner=True)
    code, result = runner.run(args, TOKEN, api=api, clock=lambda: 0)
    assert code == 0 and result["outcome"] == "paused-by-owner" and calls == [None]


def quota_case():
    calls = []
    def api(site, token, action=None):
        calls.append(action)
        if action is None:
            return 200, status(retryAfter=3600 if len(calls) > 1 else 0)
        return 429, {"error": TOKEN}
    code, result = runner.run(args, TOKEN, api=api, clock=lambda: 0)
    assert code == 0 and result["outcome"] == "checkpointed-waiting-for-quota"
    assert calls == [None, "daily_step", None] and TOKEN not in json.dumps(result)


def complete_case():
    calls = []
    def api(site, token, action=None):
        calls.append(action)
        return 200, status(daily={"stage": "complete"} if action else {"stage": "importing"})
    code, result = runner.run(args, TOKEN, api=api, clock=lambda: 0)
    assert code == 0 and result["outcome"] == "recent-release-sweep-complete"
    assert calls == [None, "daily_step"] and result["historicalCoverageComplete"] is False


def backfill_case():
    calls = []
    def api(site, token, action=None):
        calls.append(action)
        if action == "backfill_step":
            return 200, status(daily={"stage": "complete"}, backfill={"stage": "pass_complete", "deferredForRecentRefresh": False})
        if action == "daily_step":
            return 200, status(daily={"stage": "complete"}, backfill={"stage": "idle", "deferredForRecentRefresh": False})
        return 200, status()
    code, result = runner.run(SimpleNamespace(**{**vars(args), "mode": "backfill"}), TOKEN, api=api, clock=lambda: 0)
    assert code == 0 and calls == [None, "daily_step", "backfill_step"]
    assert result["outcome"] == "observed-series-pass-finished" and not result["historicalCoverageComplete"]


def bounded_case():
    calls = []
    def api(site, token, action=None):
        calls.append(action)
        return 200, status()
    code, result = runner.run(SimpleNamespace(**{**vars(args), "max_steps": 2}), TOKEN, api=api, clock=lambda: 0)
    assert code == 0 and calls == [None, "daily_step", "daily_step"]
    assert result["outcome"] == "checkpointed-run-budget-reached" and result["steps"] == 2
    code, result = runner.run(args, TOKEN, api=lambda *a: (403, {"error": TOKEN}), clock=lambda: 0)
    assert code == 1 and TOKEN not in json.dumps(result)


for name, case in (("Exact private Site service request", access_case), ("Bounded JSON service response", response_case), ("Owner pause respected", paused_case), ("Quota returns checkpoint without secret echo", quota_case), ("Recent sweep completes", complete_case), ("Daily priority before historical backfill", backfill_case), ("Bounded run and sanitized access failure", bounded_case)):
    test(name, case)
print("GCD operator runner results: " + str(passed) + " passed, 0 failed")
print("QA_RESULT " + json.dumps({"suite": "gcd-runner", "passed": passed, "failed": 0, "genuineProviderRequests": 0}))
