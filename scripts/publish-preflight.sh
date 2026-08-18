#!/bin/bash
set -euo pipefail
# Publish-Preflight: läuft als Deployment-postBuild bei JEDER Veröffentlichung.
#
# 1) Prod-Schema-Drift-Check (read-only, fail-closed): vergleicht das Drizzle-
#    Schema mit der Scaleway-Produktions-DB (PROD_DATABASE_URL). Fehlen dort
#    Spalten/Tabellen, bricht der Build sichtbar ab — der Publish muss dann
#    erst per `migrate-prod -- --yes <dbname>` das Schema nachziehen.
#    (Hintergrund: Die Prod-DB ist extern; Replits automatischer Publish-
#    Schema-Abgleich greift hier NICHT.)
# 2) pnpm store prune (bisheriger postBuild-Schritt, Image verkleinern).
pnpm --filter @workspace/scripts run check-prod-schema-drift
pnpm store prune
