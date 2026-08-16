---
name: pnpm workspace-member package install
description: installLanguagePackages fails for a pnpm workspace member; how to add a devDependency to one artifact correctly.
---

`installLanguagePackages({ language: "nodejs", packages: [...] })` runs a bare
`pnpm add` at the monorepo root. In this pnpm-workspace project that always
fails with `ERR_PNPM_ADDING_TO_ROOT` when the intent is to add a dependency to
one workspace member (e.g. `artifacts/dienstplan`), not the root.

**Why:** pnpm refuses to silently add a dependency to the workspace root from
inside what looks like a member-scoped install; there is no way to pass
`--filter` through `installLanguagePackages`.

**How to apply:** for a single workspace member, edit that member's
`package.json` directly (add the dependency/devDependency entry with a real
version, matched against `npm view <pkg> version` if unsure), then run
`pnpm install --filter <workspace-package-name>...` from the repo root
(the trailing `...` pulls in its dependents so the lockfile resolves
correctly). Watch the peer-dependency warnings in the install output — e.g.
`@testing-library/react` needs `@testing-library/dom` as an explicit peer or
pnpm reports it as unmet (though it still installs).
