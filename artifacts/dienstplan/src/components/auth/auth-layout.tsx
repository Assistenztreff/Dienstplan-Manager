import { useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * Gemeinsames Seitengerüst für die Auth-Seiten (Login, Registrierung,
 * Passwort-vergessen, Einladung) im AssistenzTreff-Look:
 *
 * - pastellblaues Hintergrundband oben (brand-hellblau)
 * - große dunkelblaue Seitenüberschrift (brand-dark)
 * - weiße, stark abgerundete Karte, die in den weißen Bereich hineinragt
 *
 * Die Farbwahl folgt dem barrierefreien Farbsystem: dunkelblauer Text auf
 * hellen Flächen, weißer Text auf Dunkelblau — Hellgelb nie als Textfarbe.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-white">
      {/* Pastellblaues Band im oberen Bereich */}
      <div className="absolute inset-x-0 top-0 h-[45vh] min-h-72 bg-brand-hellblau" aria-hidden />

      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center px-4 pb-12 pt-10 sm:pt-16">
        <h1 className="text-center text-4xl font-extrabold tracking-tight text-brand-dark sm:text-5xl">
          {title}
        </h1>

        <div className="mt-8 w-full rounded-[2.5rem] border border-slate-200/70 bg-white px-5 py-8 shadow-sm sm:mt-10 sm:px-10 sm:py-10">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Beschriftung im Vorlagen-Stil (dunkelblau, halbfett). */
export function AuthLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-brand-dark">
      {children}
    </label>
  );
}

type AuthInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
};

/** Eingabefeld mit vorangestelltem Icon (Person/Brief/Schloss). */
export function AuthInput({ icon, className: _ignored, ...props }: AuthInputProps) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-brand-dark"
        aria-hidden
      >
        {icon}
      </span>
      <input
        {...props}
        className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-base text-brand-dark placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark disabled:opacity-60 aria-[invalid=true]:border-destructive"
      />
    </div>
  );
}

type AuthPasswordInputProps = Omit<AuthInputProps, "type">;

/** Passwortfeld mit Schloss-Icon und Auge-Toggle zum Einblenden. */
export function AuthPasswordInput({ icon, ...props }: AuthPasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-brand-dark"
        aria-hidden
      >
        {icon}
      </span>
      <input
        {...props}
        type={visible ? "text" : "password"}
        className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-12 text-base text-brand-dark placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark disabled:opacity-60 aria-[invalid=true]:border-destructive"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-brand-dark hover:text-brand-dark/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark"
      >
        {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

/** Dunkelblauer Pill-Button mit weißem Pfeil-Kreis rechts. */
export function AuthSubmitButton({
  children,
  loading,
  loadingText,
  disabled,
}: {
  children: ReactNode;
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="flex h-14 w-full items-center justify-between rounded-full bg-brand-dark px-6 text-base font-semibold text-white shadow-md transition-colors hover:bg-brand-dark/90 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark disabled:opacity-70"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          {loadingText ?? children}
        </span>
      ) : (
        <span>{children}</span>
      )}
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-dark" aria-hidden>
        <ArrowRight className="h-5 w-5" />
      </span>
    </button>
  );
}

/** Unterstrichener dunkelblauer Textlink im Vorlagen-Stil. */
export function AuthTextLink({
  onClick,
  children,
  "data-testid": testId,
}: {
  onClick: () => void;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="font-bold text-brand-dark underline underline-offset-4 hover:text-brand-dark/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
    >
      {children}
    </button>
  );
}

/** Generische Fehlerbox (unverändert zur bisherigen Darstellung). */
export function AuthErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  );
}
