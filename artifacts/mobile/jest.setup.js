/**
 * Globales Test-Setup. @testing-library/react-native erweitert die
 * Jest-Matcher automatisch beim Import; hier werden nur störende
 * Konsolenausgaben aus React-Native-Internas im Testlauf reduziert.
 */
/* eslint-env jest */
jest.spyOn(console, "error").mockImplementation((...args) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("useNativeDriver") || msg.includes("not wrapped in act")) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(...args);
});
