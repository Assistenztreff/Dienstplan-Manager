---
name: drizzle-kit push ändert ON-DELETE-Regeln bestehender Fremdschlüssel NICHT
description: Warum eine geänderte FK-Löschregel nur über pre-push-sql.ts ankommt — und warum setup-test-db das mitlaufen lassen muss.
---

# `drizzle-kit push` fasst bestehende Fremdschlüssel nicht an

**Verifiziert am 30.08.2026** beim Umbau von `shift_changes.shift_id` von
`ON DELETE CASCADE` auf `ON DELETE SET NULL` (Stufe 4, Änderungshistorie).

Im Drizzle-Schema steht die neue Regel, `push` meldet „Changes applied" — und
`pg_constraint.confdeltype` steht danach **unverändert** auf `c` (cascade).
Push erkennt nur neue/entfallene Constraints, nicht die geänderte Aktion eines
vorhandenen. Exit-Code 0, keine Warnung.

**Konsequenz:** jede Änderung an einer FK-Aktion (`ON DELETE`/`ON UPDATE`)
gehört als expliziter `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` nach
`scripts/src/lib/pre-push-sql.ts`. Das ist die gemeinsame Quelle für
`post-merge.sh` UND `migrate-prod` — nur so kommt sie auf Dev und Produktion an.

**Die Falle dahinter:** `scripts/src/setup-test-db.ts` rief `pre-push-sql`
lange NICHT auf, sondern nur `db push`. Die E2E-Test-DB lief damit auf einem
ANDEREN Schema als das ausgelieferte — ein Test, der die neue Löschregel
prüft, wäre dort grün geblieben, obwohl in der Test-DB noch die alte stand
(hier andersherum aufgefallen: der Test blieb rot, obwohl der Code stimmte).
`pushAndVerify()` führt `pre-push-sql` jetzt vor jedem Push aus, exakt in der
Reihenfolge von post-merge.sh.

**Erkennungsmerkmal:** ein E2E-Test zum Löschverhalten verhält sich nicht wie
der Code. Gegenprobe:

```sql
SELECT conname, confdeltype FROM pg_constraint WHERE conname = '<fk_name>';
-- a = no action, r = restrict, c = cascade, n = set null, d = set default
```

**Auch beachten:** `verify-test-db-schema` und der Publish-Guard
(`check-prod-schema-drift`) prüfen Tabellen und Spalten — eine abweichende
FK-Aktion melden sie nicht.
