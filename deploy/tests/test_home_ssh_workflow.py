from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class WorkflowTests(unittest.TestCase):
    def test_manual_mode_defaults_to_read_only(self):
        workflow = yaml.load((ROOT / '.github/workflows/deploy-home-ssh.yml').read_text(), Loader=yaml.BaseLoader)
        manual = workflow['on']['workflow_dispatch']['inputs']['mode']
        self.assertEqual(manual['default'], 'preflight')
        self.assertEqual(manual['options'], ['preflight', 'deploy'])

    def test_only_main_can_deploy_and_requires_gate(self):
        workflow = yaml.load((ROOT / '.github/workflows/deploy-home-ssh.yml').read_text(), Loader=yaml.BaseLoader)
        job = workflow['jobs']['deploy']
        self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertIn("HOME_SSH_DEPLOY_ENABLED == 'true'", job['if'])
        self.assertIn("inputs.mode == 'preflight'", job['if'])
        self.assertEqual(job['environment'], 'home-production')
        self.assertEqual(workflow['concurrency']['cancel-in-progress'], 'false')

    def test_pull_requests_never_get_deployment_secrets(self):
        text = (ROOT / '.github/workflows/deploy-home-ssh.yml').read_text()
        self.assertNotIn('pull_request_target', text)
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        validation = workflow['jobs']['validate']
        self.assertNotIn('environment', validation)
        self.assertNotIn('secrets.', str(validation))
        for job in workflow['jobs'].values():
            checkout = next(step for step in job['steps'] if step.get('uses', '').startswith('actions/checkout'))
            self.assertEqual(checkout['with']['persist-credentials'], 'false')

    def test_tests_and_build_precede_deploy(self):
        workflow = yaml.load((ROOT / '.github/workflows/deploy-home-ssh.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(workflow['jobs']['deploy']['needs'], 'validate')
        steps = str(workflow['jobs']['validate']['steps'])
        self.assertIn('vitest run --config vitest.ci.config.ts', steps)
        self.assertIn('intentionally NOT run here', steps)
        self.assertIn('pnpm check', steps)
        self.assertIn('pytest supabase-sync/tests deploy/tests', steps)
        self.assertIn('package_home_release.py', steps)

    def test_pinned_installer_does_not_depend_on_old_corepack(self):
        workflow = yaml.load((ROOT / '.github/workflows/deploy-home-ssh.yml').read_text(), Loader=yaml.BaseLoader)
        steps = workflow['jobs']['validate']['steps']
        installer = next(step for step in steps if step.get('name') == 'Install isolated pinned pnpm without Corepack')
        self.assertIn('pnpm@10.4.1', installer['run'])
        self.assertIn('GITHUB_PATH', installer['run'])
        self.assertNotIn('corepack enable', str(steps))
        self.assertNotIn('pnpm/action-setup', str(steps))

    def test_status_notification_is_separate_and_opt_in(self):
        workflow = yaml.load((ROOT / '.github/workflows/deploy-home-ssh.yml').read_text(), Loader=yaml.BaseLoader)
        step = next(step for step in workflow['jobs']['deploy']['steps'] if step.get('name', '').startswith('Send one deployment-status'))
        self.assertIn("HOME_TELEGRAM_NOTIFY_ENABLED == 'true'", step['if'])
        self.assertIn('not a prediction card', step['name'])


if __name__ == '__main__':
    unittest.main()
