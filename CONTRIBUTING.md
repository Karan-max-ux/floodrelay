# Contributing

## Branch naming

Use one of these prefixes:

- `feature/<short-name>` — new functionality
- `fix/<short-name>` — bug fixes
- `docs/<short-name>` — documentation changes

## Pull requests

- `main` is protected and changed only through pull requests.
- At least one teammate must review each PR before merging.
- Keep PRs small and focused on a single change.
- Update `progress.md` in the same PR that finishes a task.

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
