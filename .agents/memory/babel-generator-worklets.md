---
name: react-native-worklets needs @babel/generator via packageExtensions
description: Mobile production build fails with "Cannot find module '@babel/generator'" from the worklets babel plugin; fix is a pnpm packageExtensions declaration.
---

# react-native-worklets missing @babel/generator

`react-native-worklets/plugin/index.js` does `require("@babel/generator")` at
bundle/transform time (loaded by `babel-preset-expo`), but the package only
declares `@babel/core` (peer) — never `@babel/generator`. Under pnpm's strict,
symlinked layout a package can only resolve modules symlinked into its own
`.pnpm/<pkg>/node_modules/@babel/` dir, so the require fails unless something
hoists generator to the root `node_modules`.

**Symptom:** dev works, but the mobile **production build** (Metro bundling in
`artifacts/mobile/scripts/build.js`) fails with:
`[BABEL] expo-router/entry.js: Cannot find module '@babel/generator'`
Require stack starts at `react-native-worklets/plugin/index.js`. This surfaces
as a *deployment build* failure (publish), not a typecheck/dev failure.

**Root cause is layout, not a missing install.** `@babel/generator` is present
in the pnpm store; it just isn't symlinked beside worklets. A `@babel/core`
override (e.g. from a security-audit pin) can change the dependency graph so a
previously-hoisted generator is no longer reachable — a clean publish that
worked before suddenly breaks.

**Fix (durable):** add a pnpm `packageExtensions` entry in `pnpm-workspace.yaml`
so pnpm symlinks generator into worklets' own dep dir:
```yaml
packageExtensions:
  react-native-worklets:
    dependencies:
      '@babel/generator': ^7.25.2
```
Then `pnpm install`. Adding `@babel/generator` to `artifacts/mobile/package.json`
does NOT help — worklets resolves from the root `.pnpm` store, not the artifact.

**Why:** the worklets plugin requires generator directly but doesn't declare it;
packageExtensions repairs the missing declaration at the workspace level.

**How to verify without running the multi-minute Metro build:** use
`createRequire(<path to react-native-worklets/plugin/index.js>)` and call
`.resolve('@babel/generator')` — it must resolve. Also confirm the symlink:
`ls node_modules/.pnpm/react-native-worklets@*/node_modules/@babel/ | grep generator`.
