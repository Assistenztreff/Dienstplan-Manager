---
name: Codegen drift guard via fingerprint, not git
description: CI-style guards over generated directories must compare before/after content hashes, not git diff.
---

The codegen-drift guard (root `codegen:check`) must NOT use `git diff` to detect stale
generated output.

**Why:** `git diff` against HEAD compares to the last commit, not the working tree the
developer actually has — uncommitted-but-correct regenerated files count as "drift", and
a stale `.git/index.lock` (which the sandbox cannot delete) makes any git invocation fail
outright.

**How to apply:** Hash the generated directories (SHA-256 over sorted relative path +
content) BEFORE running codegen, run codegen, hash again, and fail only if the
fingerprints differ. Side effect: on failure the correct files are already regenerated
in the working tree — the fix is just to keep/commit them.
