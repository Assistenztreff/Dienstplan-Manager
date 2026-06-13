export type ShiftModelColor = {
  value: string;
  label: string;
  badge: string;
  dot: string;
};

export const SHIFT_MODEL_COLORS: ShiftModelColor[] = [
  { value: "primary", label: "Primär", badge: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20", dot: "bg-primary" },
  { value: "amber", label: "Bernstein", badge: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100", dot: "bg-amber-500" },
  { value: "blue", label: "Blau", badge: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100", dot: "bg-blue-500" },
  { value: "indigo", label: "Indigo", badge: "bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100", dot: "bg-indigo-500" },
  { value: "purple", label: "Violett", badge: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100", dot: "bg-purple-500" },
  { value: "teal", label: "Türkis", badge: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100", dot: "bg-teal-500" },
  { value: "green", label: "Grün", badge: "bg-green-50 text-green-800 border-green-200 hover:bg-green-100", dot: "bg-green-500" },
  { value: "rose", label: "Rosé", badge: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100", dot: "bg-rose-500" },
  { value: "orange", label: "Orange", badge: "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100", dot: "bg-orange-500" },
  { value: "slate", label: "Grau", badge: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200", dot: "bg-slate-500" },
];

const FALLBACK = SHIFT_MODEL_COLORS[SHIFT_MODEL_COLORS.length - 1]!;

export function colorBadgeClass(color: string): string {
  return (SHIFT_MODEL_COLORS.find((c) => c.value === color) ?? FALLBACK).badge;
}

export function colorDotClass(color: string): string {
  return (SHIFT_MODEL_COLORS.find((c) => c.value === color) ?? FALLBACK).dot;
}
