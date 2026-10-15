# Contributing

## How we work

- **Protected `main`**: `main` is protected. Nobody pushes directly to `main`, including the repository owner. All changes go through a pull request.
- **Teammate review**: Each PR needs at least 1 approval from a teammate other than its author. You cannot approve your own PR.
- **Branch from updated `main`**: Always branch from an up-to-date `main`: run `git checkout main` and `git pull`, then `git checkout -b <type>/<short-name>`.
- **Post-merge cleanup**: After a PR is merged, delete the branch and run `git checkout main` and `git pull` before starting new work.
- **Author merges**: The PR author merges their own PR once it has approval and all checks pass. Do not merge a PR that touches `progress.md` without confirming it still matches the repo.
- **No force push to `main`**: Force pushes (`--force` or `--force-with-lease`) to `main` are never allowed. For feature branches, ask a teammate first.
- **Small PRs**: Keep PRs small and focused on a single purpose per PR, with a short description of what changed and how to verify it.
- **Secrets**: Never commit secrets. `.env` stays git-ignored; only `.env.example` is committed.

## Branch naming

Use one of these prefixes:

- `feature/<short-name>` — new functionality
- `fix/<short-name>` — bug fixes
- `docs/<short-name>` — documentation changes
- `chore/<short-name>` — maintenance, tooling, configuration, and dependencies
- `refactor/<short-name>` — code changes that neither fix a bug nor add a feature
- `test/<short-name>` — adding or updating tests

## Pull requests

- Update `progress.md` in the same PR that finishes a task. Use the emoji status symbols: ⬜ not started, 🟡 in progress, ✅ done.

### PR checklist

Every pull request must include:

- [ ] **Description**: Clear explanation of what changed and why.
- [ ] **How to verify**: Steps, commands, or test instructions to verify the change.
- [ ] **`progress.md` updated**: Task status updated with appropriate emoji (⬜, 🟡, ✅).
- [ ] **`docs/decisions.md` entry**: Added or updated if an architectural decision was introduced or modified.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add citizen request form validation
fix: correct cluster distance calculation
docs: update Phase 1 status in progress.md
test: add solver unit tests for edge cases
chore: update docker-compose Postgres version
refactor: extract TravelTimeProvider interface
```

Allowed prefixes: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`.

## Secrets and environment files

- Never commit secrets (API keys, passwords, tokens).
- Use `.env` files for local configuration. These are git-ignored.
- Provide a `.env.example` file with placeholder values so teammates know which variables are needed.

## Architecture decisions

Record architecture decisions in [docs/decisions.md](docs/decisions.md) using the template provided there. If a PR introduces or changes an architectural choice, add an entry.
