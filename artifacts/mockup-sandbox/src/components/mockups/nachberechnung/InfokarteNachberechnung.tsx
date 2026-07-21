import { AlertTriangle } from "lucide-react";

const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const signedEuro = (n: number) => `${n > 0 ? "+" : ""}${euro(n)}`;
const signedH = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;
const h = (n: number) =>
  `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;

const ROWS = [
  {
    userId: 1,
    userName: "Anna Schmidt",
    reportedHours: 152,
    reportedPay: 2432.0,
    currentHours: 144,
    currentPay: 2304.0,
    diffHours: -8,
    diffPay: -128.0,
    vacationHours: 8,
    vacationPay: 128.0,
    sickHours: 0,
    sickPay: 0,
  },
  {
    userId: 2,
    userName: "Max Müller",
    reportedHours: 160,
    reportedPay: 2560.0,
    currentHours: 160,
    currentPay: 2560.0,
    diffHours: 0,
    diffPay: 0,
    vacationHours: 0,
    vacationPay: 0,
    sickHours: 16,
    sickPay: 256.0,
  },
  {
    userId: 3,
    userName: "Lisa Weber",
    reportedHours: 128,
    reportedPay: 2116.5,
    currentHours: 140,
    currentPay: 2314.0,
    diffHours: 12,
    diffPay: 197.5,
    vacationHours: 8,
    vacationPay: 132.0,
    sickHours: 4,
    sickPay: 66.0,
  },
];

export function InfokarteNachberechnung() {
  return (
    <div className="min-h-screen w-full bg-background p-6 flex justify-center">
      <div className="w-full max-w-3xl">
        <div className="rounded-xl border border-amber-300/60 bg-card shadow-sm">
          <div className="p-5 md:p-6">
            <div className="flex items-start gap-2 mb-1">
              <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-lg font-semibold">Nachberechnung Juni 2026</h3>
                <p className="text-sm text-muted-foreground">
                  Der Monat Juni 2026 wurde nach dem Abschluss (05.07.2026, 14:32 Uhr)
                  geändert. Differenz zwischen gemeldeter und aktueller Auswertung:
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Assistenzkraft</th>
                    <th className="py-2 pr-3 font-medium text-right">Gemeldet</th>
                    <th className="py-2 pr-3 font-medium text-right">Aktuell</th>
                    <th className="py-2 pr-3 font-medium text-right">Differenz</th>
                    <th className="py-2 font-medium text-right">
                      davon Urlaub / Krankheit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.userId} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 font-medium">{row.userName}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {h(row.reportedHours)}
                        <div className="text-xs text-muted-foreground">
                          {euro(row.reportedPay)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {h(row.currentHours)}
                        <div className="text-xs text-muted-foreground">
                          {euro(row.currentPay)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                        <span
                          className={
                            row.diffHours !== 0
                              ? row.diffHours > 0
                                ? "text-green-700"
                                : "text-red-700"
                              : ""
                          }
                        >
                          {signedH(row.diffHours)}
                        </span>
                        <div
                          className={`text-xs ${
                            row.diffPay > 0
                              ? "text-green-700"
                              : row.diffPay < 0
                                ? "text-red-700"
                                : "text-muted-foreground"
                          }`}
                        >
                          {signedEuro(row.diffPay)}
                        </div>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {row.vacationHours > 0 && (
                          <div>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                              <span className="text-muted-foreground">Urlaub</span>
                              <span className="font-medium">{h(row.vacationHours)}</span>
                            </span>
                            <div className="text-xs text-muted-foreground">
                              {euro(row.vacationPay)}
                            </div>
                          </div>
                        )}
                        {row.sickHours > 0 && (
                          <div className={row.vacationHours > 0 ? "mt-1" : ""}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />
                              <span className="text-muted-foreground">Krankheit</span>
                              <span className="font-medium">{h(row.sickHours)}</span>
                            </span>
                            <div className="text-xs text-muted-foreground">
                              {euro(row.sickPay)}
                            </div>
                          </div>
                        )}
                        {row.vacationHours === 0 && row.sickHours === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Urlaubs- und Krankheitsstunden aus dem Vormonat werden als
              Lohnfortzahlung fortgezahlt. Die Nachberechnung ist bei der
              Abrechnung dieses Monats zu berücksichtigen.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
