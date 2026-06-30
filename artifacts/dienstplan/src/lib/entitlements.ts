// Die Entitlement-Konfiguration (Free/Premium-Plaene, Features, Limits) lebt im
// gemeinsamen Paket @workspace/entitlements, damit Frontend und API-Server
// dieselbe Single Source of Truth nutzen und nie auseinanderlaufen. Dieses
// Modul re-exportiert sie unveraendert, damit bestehende `@/lib/entitlements`-
// Importe im Frontend weiter funktionieren.
export type {
  Plan,
  PlanFeature,
  PlanLimit,
  EntitledUser,
} from "@workspace/entitlements";
export {
  PLAN_CONFIG,
  resolvePlan,
  hasAccess,
  getLimit,
  isWithinLimit,
  isPremium,
} from "@workspace/entitlements";
