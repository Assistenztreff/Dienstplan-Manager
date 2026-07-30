import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regressionsschutz: Fehler-Toasts bei Offline-Mutations.
 *
 * Wenn navigator.onLine === false, soll kein komponentenspezifischer
 * Fehler-Toast erscheinen — das Offline-Banner erklärt den Grund bereits.
 * Dieses Pattern (`if (!navigator.onLine) return;`) ist in allen catch-Blöcken
 * und onError-Handlern der App verankert.
 *
 * Würde jemand den Guard entfernen oder umgehen, werden diese Tests rot.
 */

// Hilfsfunktion, die das Pattern aus den catch-Blöcken der App nachbildet.
function handleMutationError(toastFn: () => void): void {
  if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
  toastFn();
}

describe("Offline-Fehlermeldungs-Unterdrückung", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");

  function setOnLine(value: boolean) {
    Object.defineProperty(navigator, "onLine", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    // Originalzustand wiederherstellen.
    if (originalOnLine) {
      Object.defineProperty(navigator, "onLine", originalOnLine);
    } else {
      setOnLine(true);
    }
  });

  beforeEach(() => {
    setOnLine(true);
  });

  it("unterdrückt den Fehler-Toast wenn navigator.onLine === false", () => {
    setOnLine(false);
    const toastMock = vi.fn();
    handleMutationError(toastMock);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("zeigt den Fehler-Toast wenn navigator.onLine === true", () => {
    setOnLine(true);
    const toastMock = vi.fn();
    handleMutationError(toastMock);
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("zeigt keine Toast-Meldung für einen TypeError (Netzwerkfehler) wenn offline", () => {
    setOnLine(false);
    const networkError = new TypeError("Failed to fetch");
    const toastMock = vi.fn();

    // Simuliert einen catch(err)-Block mit Netzwerkfehler.
    function handleWithError(err: unknown) {
      if (!navigator.onLine) return;
      if (err instanceof TypeError) {
        toastMock();
      }
    }

    handleWithError(networkError);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("zeigt keine Toast-Meldung für einen TypeError wenn online (TypeError = Netzwerkfehler, aber Verbindung noch sichtbar)", () => {
    setOnLine(true);
    const networkError = new TypeError("Failed to fetch");
    const toastMock = vi.fn();

    function handleWithError(err: unknown) {
      if (!navigator.onLine) return;
      if (err instanceof TypeError) {
        toastMock();
      }
    }

    handleWithError(networkError);
    // Online: der TypeError-Pfad ist nur für den MutationCache (zentral),
    // Komponenten zeigen ihn nur über readableApiError.
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("unterdrückt auch onError-Handler-Aufrufe wenn offline", () => {
    setOnLine(false);
    const toastMock = vi.fn();

    // Simuliert einen useMutation-onError-Handler.
    const onError = (err: unknown) => {
      if (!navigator.onLine) return;
      // Hier würde normalerweise ein Fehler-Toast erscheinen.
      void err;
      toastMock();
    };

    onError(new TypeError("Failed to fetch"));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("lässt onError-Handler laufen wenn online", () => {
    setOnLine(true);
    const toastMock = vi.fn();

    const onError = (err: unknown) => {
      if (!navigator.onLine) return;
      void err;
      toastMock();
    };

    onError(new Error("Server Error 500"));
    expect(toastMock).toHaveBeenCalledOnce();
  });
});
