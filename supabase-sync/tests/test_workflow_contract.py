from pathlib import Path


def test_hourly_workflow_has_dry_run_retry_and_telegram_secret_contract() -> None:
    workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "main.yml").read_text(encoding="utf-8")
    assert 'cron: "0 * * * *"' in workflow
    assert "workflow_dispatch:" in workflow
    assert "dry_run:" in workflow
    assert "for attempt in 1 2 3" in workflow
    assert "sleep $((attempt * 20))" in workflow
    assert "secrets.TELEGRAM_BOT_TOKEN" in workflow
    assert "secrets.TELEGRAM_CHAT_ID" in workflow
    assert "--kind success" in workflow
    assert "--kind failure" in workflow
    assert "sb_secret_" not in workflow
