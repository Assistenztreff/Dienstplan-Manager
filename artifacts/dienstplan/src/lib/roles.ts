// "Admin-artig" = Rolle admin ODER superadmin. Der Betreiber (superadmin)
// nutzt die normale App wie ein Admin (eigene Teams/Daten); zusätzlich sieht
// er exklusiv das Operator-Dashboard. Frontend-Gates sind reine UX — die
// Autorisierung passiert serverseitig (isAdminLikeRole in der Middleware).
export function isAdminRole(role: string | undefined): boolean {
  return role === "admin" || role === "superadmin";
}
