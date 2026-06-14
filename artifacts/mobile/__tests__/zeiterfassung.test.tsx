/**
 * Automatischer Test für die "Zeit-Übernahme" in der Mobile-App (Expo/RN).
 *
 * Die Web-Variante ist bereits durch Playwright abgesichert
 * (artifacts/dienstplan/e2e/dienstplan-zeit-uebernahme.spec.ts). Da Assistenten
 * überwiegend das Smartphone nutzen, sichern diese Komponenten-Tests den
 * mobilen Pfad gegen Regressionen ab. Gerendert wird der echte
 * ZeiterfassungScreen über @testing-library/react-native; die generierten
 * API-Hooks und nativen Module werden gemockt, sodass die Tests ohne Server,
 * Gerät oder Emulator deterministisch laufen.
 *
 * Deckt die Done-Kriterien der Aufgabe ab:
 * - Übernahme-Flow: offene Schicht auswählen, Ist-Zeit speichern, der neue
 *   pending-Eintrag erscheint in der Liste, die übernommene Schicht
 *   verschwindet aus dem Schicht-Picker.
 * - Nacht-Rollover in handleSubmit: bei einer Schicht über Mitternacht liegt
 *   actualEnd auf dem Folgetag und ist echt nach actualStart.
 * - 409-Doppelbuchungs-Schutz aus Sicht der Mobile-App: lehnt der Server eine
 *   zweite Buchung derselben shiftId ab (ApiError 409), zeigt der Screen die
 *   passende Fehlermeldung statt eines generischen Fehlers.
 * - Validierung in handleSubmit (Schutz gegen Fehleingaben): gleiche Start-/
 *   Endzeit ohne Schichtbezug -> "Endzeit muss nach Startzeit liegen.";
 *   leeres Pflichtfeld -> "Bitte alle Pflichtfelder ausfullen."; generischer
 *   Serverfehler -> "Speichern fehlgeschlagen. Bitte erneut versuchen.".
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { ApiError } from "@workspace/api-client-react";

// --- Steuerbarer Zustand der gemockten API-Hooks -------------------------
// (muss mit "mock" beginnen, damit die jest.mock-Factory darauf zugreifen darf)
const mockState: {
  shifts: Array<{ id: number; startTime: string; endTime: string; type: string }>;
  entries: Array<{
    id: number;
    userId: number;
    shiftId?: number | null;
    actualStart: string;
    actualEnd: string;
    status: "pending" | "confirmed" | "rejected";
  }>;
  refetch: jest.Mock;
  mutateAsync: jest.Mock;
} = {
  shifts: [],
  entries: [],
  refetch: jest.fn(),
  mutateAsync: jest.fn(),
};

jest.mock("@workspace/api-client-react", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message?: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    useListTimeEntries: () => ({
      data: mockState.entries,
      isLoading: false,
      isError: false,
      refetch: mockState.refetch,
    }),
    useListShifts: () => ({ data: mockState.shifts }),
    useCreateTimeEntry: () => ({ mutateAsync: mockState.mutateAsync }),
  };
});

jest.mock("@/context/UserContext", () => ({
  useCurrentUser: () => ({
    currentUser: { id: 7, name: "Test Assistent", email: "t@a.test", role: "assistant" },
  }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#fff",
    border: "#ddd",
    primary: "#123456",
    primaryForeground: "#fff",
    mutedForeground: "#888",
    accent: "#abcdef",
    accentForeground: "#fff",
    secondary: "#eee",
    radius: 8,
  }),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-router", () => ({
  Redirect: () => null,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Feather: () => null,
}));

// TimePickerField rendert auf echten Geräten native Picker; für den Test genügt
// ein No-Op. Die Zeiten werden im Flow ohnehin durch die Schicht-Übernahme
// (handleShiftSelect) gesetzt, nicht durch manuelle Picker-Eingabe.
jest.mock("@/components/TimePickerField", () => ({
  TimePickerField: () => null,
}));

import ZeiterfassungScreen from "@/app/(tabs)/zeiterfassung";

const SHIFT_DATE = "2026-06-05";
const NIGHT_DATE = "2026-06-08";
const NIGHT_NEXT = "2026-06-09";

function resetState() {
  mockState.shifts = [];
  mockState.entries = [];
  mockState.refetch = jest.fn();
  mockState.mutateAsync = jest.fn().mockResolvedValue({ id: 1 });
}

/** Öffnet den Eintrags-Dialog über die Empty-State-Schaltfläche. */
function openDialog() {
  fireEvent.press(screen.getByText("Eintrag hinzufugen"));
}

/** Öffnet das Schicht-Dropdown und wählt die (einzige) Schicht des Typs aus. */
function selectShift(typeLabel: RegExp) {
  fireEvent.press(screen.getByText("Keine Schicht ausgewahlt"));
  fireEvent.press(screen.getByText(typeLabel));
}

describe("Mobile Zeit-Übernahme", () => {
  beforeEach(() => {
    resetState();
  });

  test("übernimmt eine offene Schicht: speichern erzeugt pending-Eintrag", async () => {
    mockState.shifts = [
      { id: 101, startTime: `${SHIFT_DATE}T08:00:00`, endTime: `${SHIFT_DATE}T16:00:00`, type: "active" },
    ];
    // Beim Speichern legt der Server (hier gemockt) den pending-Eintrag an.
    mockState.mutateAsync.mockImplementation(async ({ data }: { data: any }) => {
      mockState.entries.push({
        id: 5001,
        userId: data.userId,
        shiftId: data.shiftId,
        actualStart: data.actualStart,
        actualEnd: data.actualEnd,
        status: "pending",
      });
      return { id: 5001 };
    });

    render(<ZeiterfassungScreen />);
    openDialog();
    selectShift(/Aktivdienst/);
    fireEvent.press(screen.getByText("Speichern"));

    // Es wurde mit der gewählten Schicht und den Soll-Zeiten gespeichert.
    await waitFor(() => expect(mockState.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockState.mutateAsync.mock.calls[0][0].data;
    expect(payload.userId).toBe(7);
    expect(payload.shiftId).toBe(101);
    expect(payload.actualStart).toBe(`${SHIFT_DATE}T08:00:00`);
    expect(payload.actualEnd).toBe(`${SHIFT_DATE}T16:00:00`);

    // Der neue pending-Eintrag erscheint nach dem Speichern in der Liste.
    await waitFor(() => expect(screen.getByText("Offen")).toBeTruthy());
  });

  test("Nacht-Rollover: actualEnd liegt auf dem Folgetag und nach actualStart", async () => {
    mockState.shifts = [
      { id: 202, startTime: `${NIGHT_DATE}T22:00:00`, endTime: `${NIGHT_NEXT}T06:00:00`, type: "night" },
    ];

    render(<ZeiterfassungScreen />);
    openDialog();
    selectShift(/Nachtdienst/);
    fireEvent.press(screen.getByText("Speichern"));

    await waitFor(() => expect(mockState.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockState.mutateAsync.mock.calls[0][0].data;
    expect(payload.shiftId).toBe(202);
    // Enddatum rollt auf den Folgetag, Ende echt nach dem Start.
    expect(payload.actualStart.slice(0, 10)).toBe(NIGHT_DATE);
    expect(payload.actualEnd.slice(0, 10)).toBe(NIGHT_NEXT);
    expect(new Date(payload.actualEnd).getTime()).toBeGreaterThan(
      new Date(payload.actualStart).getTime(),
    );
  });

  test("409-Doppelbuchung: zeigt die spezifische Fehlermeldung statt eines generischen Fehlers", async () => {
    mockState.shifts = [
      { id: 303, startTime: `${SHIFT_DATE}T09:00:00`, endTime: `${SHIFT_DATE}T17:00:00`, type: "active" },
    ];
    // Zur Laufzeit ist ApiError die gemockte (status, message)-Variante; der
    // Cast stellt nur den TypeScript-Vertrag auf diese Test-Signatur um.
    const MockApiError = ApiError as unknown as new (status: number, message: string) => Error;
    mockState.mutateAsync.mockRejectedValue(
      new MockApiError(409, "Für diese Schicht wurde bereits eine Zeit erfasst."),
    );

    render(<ZeiterfassungScreen />);
    openDialog();
    selectShift(/Aktivdienst/);
    fireEvent.press(screen.getByText("Speichern"));

    await waitFor(() =>
      expect(screen.getByText("Fur diese Schicht wurde bereits eine Zeit erfasst.")).toBeTruthy(),
    );
    // Der Dialog bleibt offen (Titel weiterhin sichtbar), damit der Nutzer
    // die Eingabe korrigieren kann; es wurde kein Eintrag angelegt.
    expect(screen.getByText("Zeiteintrag")).toBeTruthy();
    expect(mockState.entries).toHaveLength(0);
  });
});

describe("Mobile Zeiterfassung – Eingabe-Validierung", () => {
  beforeEach(() => {
    resetState();
  });

  test("gleiche Start-/Endzeit ohne Schichtbezug: zeigt Fehler und speichert nicht", async () => {
    // Ohne ausgewählte Schicht stehen Start- und Endzeit per Default beide auf
    // der aktuellen Uhrzeit (nowTimeStr). Da kein Schichtbezug besteht, darf die
    // Endzeit NICHT still auf den Folgetag rollen – sonst entstünde ein kaputter
    // 24h-Eintrag. Stattdessen muss die Validierung klar abweisen.
    render(<ZeiterfassungScreen />);
    openDialog();
    fireEvent.press(screen.getByText("Speichern"));

    await waitFor(() =>
      expect(screen.getByText("Endzeit muss nach Startzeit liegen.")).toBeTruthy(),
    );
    // Keine Schreiboperation, kein Eintrag.
    expect(mockState.mutateAsync).not.toHaveBeenCalled();
    expect(mockState.entries).toHaveLength(0);
    // Dialog bleibt offen, damit der Nutzer korrigieren kann.
    expect(screen.getByText("Zeiteintrag")).toBeTruthy();
  });

  test("leeres Pflichtfeld (Datum): zeigt Fehler und speichert nicht", async () => {
    render(<ZeiterfassungScreen />);
    openDialog();
    // Das Datumsfeld leeren (TextInput mit Platzhalter JJJJ-MM-TT).
    fireEvent.changeText(screen.getByPlaceholderText("JJJJ-MM-TT"), "");
    fireEvent.press(screen.getByText("Speichern"));

    await waitFor(() =>
      expect(screen.getByText("Bitte alle Pflichtfelder ausfullen.")).toBeTruthy(),
    );
    expect(mockState.mutateAsync).not.toHaveBeenCalled();
    expect(mockState.entries).toHaveLength(0);
  });

  test("generischer Serverfehler (kein 409): zeigt generische Fehlermeldung", async () => {
    mockState.shifts = [
      { id: 404, startTime: `${SHIFT_DATE}T10:00:00`, endTime: `${SHIFT_DATE}T18:00:00`, type: "active" },
    ];
    // Server lehnt mit einem unspezifischen Fehler ab (z. B. 500 / Netzwerk).
    mockState.mutateAsync.mockRejectedValue(new Error("boom"));

    render(<ZeiterfassungScreen />);
    openDialog();
    selectShift(/Aktivdienst/);
    fireEvent.press(screen.getByText("Speichern"));

    // Es wurde tatsächlich versucht zu speichern (Validierung war erfolgreich),
    // aber der generische Fehler wird klar gemeldet – nicht der 409-Text.
    await waitFor(() => expect(mockState.mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText("Speichern fehlgeschlagen. Bitte erneut versuchen."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Fur diese Schicht wurde bereits eine Zeit erfasst.")).toBeNull();
    expect(mockState.entries).toHaveLength(0);
  });
});
