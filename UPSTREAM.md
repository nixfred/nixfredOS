# Syncing with upstream

Upstream: https://github.com/danielmiessler/LifeOS

Nothing here syncs automatically, and nothing should. A sync is a manual job: fetch, merge on a branch, review, then open a pull request that a person reads. Never push to upstream.

## Set up the remote once

The `upstream` remote is fetch-only. In a fresh clone:

```bash
git remote add upstream https://github.com/danielmiessler/LifeOS.git
git remote set-url --push upstream DISABLED-public-upstream
git remote -v
```

The second line makes a push to upstream fail on purpose.

## Sync by hand

1. Fetch and compare.

```bash
git fetch upstream
git rev-list --left-right --count origin/main...upstream/main
git log --oneline origin/main..upstream/main
```

The first number counts commits only nixfredOS has. The second counts commits only upstream has. If the second is 0 there is nothing to bring in.

2. Merge on a branch, never on main.

```bash
git switch -c sync/upstream-YYYY-MM-DD origin/main
git merge --no-commit --no-ff upstream/main
```

If it conflicts, resolve by hand. Many files were renamed from the upstream names, so expect rename conflicts. To back out, run `git merge --abort`.

3. Review the result like any outside change. Read the diff, above all hooks, install scripts and anything that runs commands. Run the tests with `bun test src` inside `nixfredOS/install/NIXFREDOS/VOICE/talk`.

4. Commit, push the branch, and open a pull request into main.

```bash
git commit
git push -u origin sync/upstream-YYYY-MM-DD
gh pr create --base main
```

Merge it only after review. Keep Daniel Miessler's copyright line in LICENSE untouched.

## State when this file was written

On 2026-10-20 the count command printed `32 0`. Upstream main was 5e2f2e8c from 2026-09-03 and was already contained in nixfredOS main. A test merge printed "Already up to date." with no conflicts.
