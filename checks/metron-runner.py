"""Synthetic tests for the real Python updater; no network or real credentials."""
import importlib.util
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from email.message import Message

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("runner", root / "scripts/metron_catalog_sync.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
TOKEN = "synthetic-site-service-token"


def args(**changes):
    defaults = dict(site=runner.DEFAULT_SITE, mode="nightly", publisher="",
                    start_date="", end_date="", max_steps=10, max_seconds=100)
    return SimpleNamespace(**(defaults | changes))


def status(**changes):
    return dict(configured=True, accessReady=True, stage="scanning", active=True,
                pausedByOwner=False, imported=0, checkedRecords=0, retryAfter=0) | changes


class Fixture:
    def __init__(self, responses):
        self.responses, self.calls, self.seconds = list(responses), [], 0

    def api(self, site, token, action=None, scope=None):
        self.calls.append((site, token, action, scope))
        return self.responses.pop(0)

    def wait(self, seconds):
        assert seconds <= 30
        self.seconds += seconds

    def run(self, **changes):
        return runner.run(args(**changes), TOKEN, api=self.api,
                          clock=lambda: self.seconds, wait=self.wait)


class Tests(unittest.TestCase):
    def test_exact_site_boundary_prevents_token_exfiltration(self):
        self.assertEqual(runner.safe_site(runner.DEFAULT_SITE + "/"), runner.DEFAULT_SITE)
        for url in ("http://comichuddle.aztooeasy.chatgpt.site", "https://evil.test",
                    runner.DEFAULT_SITE + ".evil.test", runner.DEFAULT_SITE + "/evil",
                    runner.DEFAULT_SITE + "?token=x", runner.DEFAULT_SITE + "#fragment",
                    "https://user:secret@comichuddle.aztooeasy.chatgpt.site"):
            with self.assertRaises(ValueError):
                runner.safe_site(url)

    def test_request_uses_only_site_service_auth_and_bounded_json(self):
        requests = []
        class Response(io.BytesIO):
            code = 200
            headers = Message()
        Response.headers["Content-Type"] = "application/json"
        class Opener:
            def open(self, req, timeout):
                requests.append((req, timeout))
                return Response(b'{"stage":"idle"}')
        code, data = runner.request(runner.DEFAULT_SITE, TOKEN, "start",
                                    {"publisherName": "Marvel"}, opener=Opener())
        self.assertEqual((code, data["stage"]), (200, "idle"))
        req, timeout = requests[0]
        self.assertEqual(req.full_url, runner.DEFAULT_SITE + "/api/catalog-sync")
        self.assertEqual(req.get_header("Oai-sites-authorization"), "Bearer " + TOKEN)
        self.assertEqual(req.get_header("X-comichuddle-catalog-run"), "owner-private-service")
        self.assertIsNone(req.get_header("Authorization"))
        self.assertNotIn(TOKEN, req.data.decode())
        self.assertNotIn(TOKEN, req.full_url)
        self.assertEqual(json.loads(req.data)["scope"], {"publisherName": "Marvel"})
        self.assertEqual(timeout, 55)
        self.assertIsNone(runner.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.test"))

    def test_missing_provider_setup_never_mutates_or_starts_import(self):
        f = Fixture([(200, status(configured=False, accessReady=False, stage="idle"))])
        code, result = f.run()
        self.assertEqual(code, 0)
        self.assertEqual(result["outcome"], "waiting-for-operator-metron-configuration")
        self.assertEqual(len(f.calls), 1)

    def test_nightly_respects_owner_pause_and_status_never_writes(self):
        for change in ({"mode": "nightly"}, {"mode": "status"}):
            f = Fixture([(200, status(pausedByOwner=True, stage="paused"))])
            self.assertEqual(f.run(**change)[0], 0)
            self.assertEqual(len(f.calls), 1)

    def test_first_scope_and_completion_stop_extra_jobs(self):
        f = Fixture([(200, status(stage="idle")), (200, status()),
                     (200, status(stage="complete", imported=17))])
        code, result = f.run(publisher="Marvel")
        self.assertEqual((code, result["outcome"], result["imported"]), (0, "complete", 17))
        self.assertEqual(f.calls[1][2:], ("start", {"publisherName": "Marvel"}))
        self.assertEqual(f.calls[2][2], "nightly_step")
        self.assertEqual(len(f.calls), 3)

    def test_checkpointed_scope_cannot_silently_change(self):
        f = Fixture([(200, status())])
        self.assertEqual(f.run(publisher="DC")[0], 1)
        self.assertEqual(len(f.calls), 1)

    def test_quota_wait_is_short_and_daily_limit_leaves_checkpoint(self):
        f = Fixture([(200, status(retryAfter=45)), (200, status(retryAfter=15)),
                     (200, status()), (200, status(stage="complete"))])
        self.assertEqual(f.run()[1]["outcome"], "complete")
        self.assertEqual(f.seconds, 45)
        f = Fixture([(200, status(retryAfter=86400))])
        self.assertEqual(f.run()[1]["outcome"], "checkpointed-waiting-for-quota")
        self.assertEqual(f.seconds, 0)

    def test_429_reloads_authoritative_state_before_retry(self):
        f = Fixture([(200, status()), (429, {"retryAfter": 2}),
                     (200, status(retryAfter=2)), (200, status()),
                     (200, status(stage="complete"))])
        self.assertEqual(f.run()[1]["outcome"], "complete")
        self.assertEqual([call[2] for call in f.calls], [None, "nightly_step", None, None, "nightly_step"])

    def test_failed_step_budget_and_reconciliation_do_not_spin_or_leak(self):
        f = Fixture([(200, status()), (502, {"error": TOKEN, "rawMetadata": TOKEN})])
        code, result = f.run()
        self.assertEqual(code, 1)
        self.assertNotIn(TOKEN, json.dumps(result))
        f = Fixture([(200, status()), (200, status(stage="paused"))])
        self.assertEqual(f.run()[1]["outcome"], "checkpointed-reconciliation-needed")
        f = Fixture([(200, status()), (200, status())])
        self.assertEqual(f.run(max_steps=1)[1]["outcome"], "checkpointed-run-budget-reached")


if __name__ == "__main__":
    unittest.main(verbosity=2)
