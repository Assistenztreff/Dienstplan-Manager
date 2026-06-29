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
  // Der volle Render-+Speichern-Flow im jest-expo-Harness ist beim ersten
  // (kalten) Lauf gelegentlich langsamer als das Standard-Timeout von 5000 ms,
  // wodurch der erste Test sporadisch mit einem Timeout fehlschlug und beim
  // erneuten Lauf (warmer Harness) grün durchlief. Ein großzügigeres globales
  // Timeout adressiert die Ursache, ohne die geprüfte Logik aufzuweichen.
  testTimeout: 20000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/.pnpm/(?!(.*?(jest-)?react-native|.*?@react-native|.*?@react-native-community|.*?expo|.*?@expo|.*?react-native-|.*?@testing-library|.*?react-clone-referenced-element|.*?@react-navigation))",
  ],
};
