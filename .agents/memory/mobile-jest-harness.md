---
name: Mobile (Expo) jest test harness
description: How the Expo/React-Native mobile artifact runs component tests under pnpm, and the gotchas that made it work.
---

The mobile artifact (`artifacts/mobile`, Expo + RN + React 19) is tested with `jest-expo` + `@testing-library/react-native` via `pnpm --filter @workspace/mobile run test`. Component tests render the real screen and mock the native/API surface — no device, emulator, or running server needed.

**pnpm transformIgnorePatterns gotcha:** jest-expo's default `transformIgnorePatterns` whitelists `node_modules/<pkg>`, but pnpm nests everything under `node_modules/.pnpm/<pkg>@ver/...`, so RN/Expo packages go untransformed and fail with syntax errors. Fix is a custom pattern in `jest.config.js` of the form `node_modules/.pnpm/(?!(.*?react-native|.*?@react-native|.*?expo|.*?@expo|...))` — match the package names *after* the `.pnpm/` segment.

**Mock the native edges, render the logic:** mock `@workspace/api-client-react` hooks (`useListShifts`/`useListTimeEntries`/`useCreateTimeEntry`) via a `mock*`-prefixed mutable state object (jest.mock hoisting forbids non-`mock` outer refs), plus `expo-haptics`, `expo-router`, `react-native-safe-area-context`, `@expo/vector-icons`, `@/hooks/useColors`, `@/context/UserContext`, and `@/components/TimePickerField`. `moduleNameMapper` maps `^@/(.*)$` to `<rootDir>/$1`.

**Why:** lets us regression-test mobile-specific logic (e.g. the time-takeover night-rollover in `zeiterfassung.tsx`) deterministically; full Detox/Maestro E2E isn't viable in the Replit container.

**ApiError in tests:** real `ApiError` ctor takes `(response, data, requestInfo)`. The runtime mock uses `(status, message)` and the component only reads `.status` + `instanceof`. Cast the imported class to the test signature (`as unknown as new (status, message) => Error`) so TS is happy while runtime uses the mock.
