# GitLab Supplemental Validation

The repository is hosted on GitHub. GitHub Actions is the only release
authority and the only system allowed to publish Content Hub images to GHCR.

The optional GitLab external-pull-request pipeline runs supplemental builds,
tests, linting, dependency audits, and GitLab dependency scanning. It contains
no Docker-in-Docker service, GHCR credentials, image publishing, release-tag
rules, or deployment jobs.

## Setup

1. Connect the GitHub repository as a GitLab CI/CD project or mirror.
2. Enable external pull-request pipelines for `master` and `develop` if they
   are useful to the team.
3. Do not configure `GHCR_USERNAME` or `GHCR_TOKEN`; GitLab must not publish
   packages for this repository.
4. Treat GitHub's required `release-gate` check as authoritative. GitLab jobs
   may add feedback but are not release prerequisites unless GitHub branch
   protection explicitly requires their external status.

Release candidates and stable releases are documented in
[`docs/operations/releases.md`](docs/operations/releases.md).
