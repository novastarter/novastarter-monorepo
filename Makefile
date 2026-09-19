# Release helpers for the monorepo.
#
# `make release` is the one command to run on `main` after the feature branches are merged. Its steps, in order:
#
#   1. `hooks`   — install the lefthook git hooks from `lefthook.yml`, so the release commit goes through the same
#                  pre-commit checks as any other commit (`pnpm install` does this too; a fresh clone or a new
#                  worktree may lack them).
#   2. `check`   — run the `pre-commit` jobs (ESLint with `--fix`, Prettier with `--write`, the changeset guard)
#                  over every tracked file, so the tree is clean before the versions are touched.
#   3. `version` — build the release notes generator, let changesets bump the versions and consume the pending
#                  `.changeset/*.md` files, and store the printed release notes in `release-notes.md` (the markdown
#                  body only, without the console dividers and the changesets banner).
#
# Each step is also a target of its own. Make runs prerequisites in the listed order, which is what enforces the
# sequence; a failing step stops the chain.

# Bash is needed for `pipefail`; it is set inside the recipe because the make shipped with macOS (3.81) has no
# `.SHELLFLAGS`. Without it a failing `changeset version` would be masked by the pipe and the target would pass.
SHELL := /bin/bash

.PHONY: release hooks check version

release: hooks check version

hooks:
	pnpm exec lefthook install

check:
	pnpm exec lefthook run pre-commit --all-files

version:
	set -o pipefail; pnpm version-packages | tee /dev/stderr | awk '/^=+$$/ { n++; next } n == 2' > release-notes.md
