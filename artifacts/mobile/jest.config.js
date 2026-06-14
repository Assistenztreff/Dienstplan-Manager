/**
 * Jest-Konfiguration für die Expo/React-Native-App.
 *
 * Nutzt das offizielle `jest-expo`-Preset. Da der Monorepo-Workspace von pnpm
 * verwaltet wird, liegen alle Abhängigkeiten unter `node_modules/.pnpm/...`.
 * Das Standard-`transformIgnorePatterns` von jest-expo greift dort nicht, daher
 * wird es hier so überschrieben, dass React-Native-/Expo-Pakete trotz des
 * .pnpm-Pfads transformiert werden.
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/.pnpm/(?!(.*?(jest-)?react-native|.*?@react-native|.*?@react-native-community|.*?expo|.*?@expo|.*?react-native-|.*?@testing-library|.*?react-clone-referenced-element|.*?@react-navigation))",
  ],
};
