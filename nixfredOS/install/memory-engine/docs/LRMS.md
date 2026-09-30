# LRMS — git history as searchable memory

Your `~/.claude` directory lives in a private git repo (the installer sets it up). Every commit message is a search index entry. LRMS adds short `LR-` trailers to commit messages so the assistant can find past work precisely instead of grepping prose.

## Writing: trailers on every meaningful commit

```
fix: session extract parses commit topics

WHAT: SessionExtract reads git log for topics
WHY: session folders had generic timestamp names

LR-T: hook, session, extraction        # tags
LR-D: memory                           # domain
LR-K: session-topic-extraction         # concept key
```

Required: `LR-T` (tags), `LR-D` (domains), `LR-K` (concept keys). Optional: `LR-R` (related SHAs), `LR-L` (rules involved).

For milestones (more than an hour of work, or a new component), also create an annotated tag `milestone/<slug>-YYYY-MM-DD` and a CHANGELOG line that names the tag.

## Reading: search fast to slow, stop at the first solid hit

```bash
rg -i 'KEYWORD' ~/.claude/CHANGELOG.md                       # 1. curated changelog
git -C ~/.claude log --grep='LR-T:.*KEYWORD' --oneline        # 2. tag trailers
git -C ~/.claude log --grep='LR-K:.*KEYWORD' --oneline        #    concept keys
git -C ~/.claude log --all -S 'KEYWORD' --oneline             #    code changes (pickaxe)
git -C ~/.claude tag -l '*KEYWORD*'                           # 3. milestone tags
mem search "KEYWORD"                                          # 4. memory.db (FTS5)
rg -i 'KEYWORD' ~/.claude/MEMORY/                             # 5. flat memory files
```

Always cite what you found (the SHA, tag or file) so the user can check it.

## The rule behind it

Search history before asking the user to repeat anything. If all five layers come up empty, then ask, and say which layers you searched.
