# Maintenance & Monitoring Workflow

This repository is maintained with automated CI, alerts, hygiene, and metrics.

## 1. Commit & Push Schedule

- Commit in small, logical units with descriptive messages.
- Push at least every `vars.MAX_DAYS_WITHOUT_PUSH` days (default: 7). A scheduled job opens a notice issue if the repo is idle longer.
- Follow semantic versioning for releases (`vMAJOR.MINOR.PATCH`) and branch naming: feature/…, bugfix/…, hotfix/….

## 2. Error Monitoring

- On any CI or Android Build failure, an alert issue is created with run details.
- Review logs via the run URL in the alert and fix promptly.

## 3. Repository Hygiene

- Stale issues/PRs are auto-labeled after 30 days and closed after 14 more.
- Use the PR template to keep documentation updated and track tests.

## 4. Quality Gates

- All PRs to `main`, `master`, or `release/*` must request at least one reviewer (enforced by workflow).
- CI builds and tests must pass before merge.
- Keep a simple rollback plan per change (e.g., revert commit or rollback release tag).

## 5. Monitoring Dashboards

- Weekly metrics are generated to `docs/metrics.md`: commit frequency, contributor activity, CI success rates, and issue stats.

## Security & Vulnerabilities

- CodeQL runs on pushes, PRs, and weekly schedule to flag code-level issues for JavaScript and Python.
- Dependabot checks npm, pip, and GitHub Actions dependencies and opens update PRs.
- Security audit workflow runs `pip-audit` and `npm audit` daily and on PRs to surface dependency CVEs.

### Configuration

- Adjust the no‑commit interval via repository variable `MAX_DAYS_WITHOUT_PUSH`.
- Secrets are optional; current workflows use built‑in permissions.
