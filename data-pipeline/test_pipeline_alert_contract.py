#!/usr/bin/env python3
"""Ensure a failed daily refresh creates an actionable GitHub notification event."""

from __future__ import annotations

import unittest
from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "daily-data-refresh.yml"


class PipelineAlertContractTests(unittest.TestCase):
    def test_failure_job_creates_an_idempotent_repository_alert(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("notify-on-failure:", source)
        self.assertIn("needs['build-validate-publish'].result == 'failure'", source)
        self.assertIn("gh issue create", source)
        self.assertIn("github.run_id", source)
        self.assertIn("force_failure_drill:", source)
        self.assertIn("Controlled failure drill", source)


if __name__ == "__main__":
    unittest.main()
