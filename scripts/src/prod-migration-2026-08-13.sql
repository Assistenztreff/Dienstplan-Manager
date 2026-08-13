-- ================================================================
-- PRODUKTIONSDATENBANK: Datenmigration 2026-08-13
-- Erstellt: 2026-08-13
-- Ausführen im Replit-Datenbankbereich → Production → SQL-Konsole
-- Alle INSERTs sind idempotent (übersprungen wenn Eintrag schon vorhanden)
-- ================================================================

-- SCHRITT 1: Admin-Passwort zurücksetzen
-- Den password_hash mit setup-admin.ts (ADMIN_EMAIL + ADMIN_PASSWORD env-vars)
-- oder über das "Passwort vergessen"-Formular erzeugen. KEINEN Klartext-Hash
-- oder Klartext-Passwort in SQL-Dateien einchecken.
-- UPDATE users SET password_hash = '<hash>' WHERE email = '<admin-email>';

-- SCHRITT 2: Vertrags-Korrekturen (ursprüngliche Start-Daten wiederherstellen)
-- Assistenzkraft (contract_id=6): Vertrag besteht seit 2019 (nicht erst seit Juni 2026)
UPDATE contracts SET start_date = '2019-01-01' WHERE id = 6;
-- Assistenzkraft (contract_id=12): Vertrag ab 1. Juni 2026 (nicht 29. Juni)
UPDATE contracts SET start_date = '2026-06-01' WHERE id = 12;

-- SCHRITT 3: Fehlende Dienste einfügen (37 Dienste, 3. Juli – 5. August 2026)
-- Team-ID = 1 (Standard-Team)
-- User-IDs: user_id=2, user_id=3, user_id=4, user_id=7, user_id=26, user_id=28

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-03 07:00:00', '2026-07-04 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-04 07:00:00', '2026-07-05 07:00:00', 'work', 'FIX', 24, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-05 07:00:00', '2026-07-06 07:00:00', 'work', 'FIX', 24, 7, 17, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-05 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 28, '2026-07-06 07:00:00', '2026-07-07 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-06 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 28, '2026-07-07 07:00:00', '2026-07-08 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-07 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 28, '2026-07-08 07:00:00', '2026-07-09 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-08 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 2, '2026-07-09 07:00:00', '2026-07-10 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-09 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 2, '2026-07-10 07:00:00', '2026-07-11 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-10 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 2, '2026-07-11 07:00:00', '2026-07-12 07:00:00', 'work', 'FIX', 24, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-11 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 2, '2026-07-12 07:00:00', '2026-07-13 07:00:00', 'work', 'FIX', 24, 7, 17, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-12 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 2, '2026-07-13 07:00:00', '2026-07-14 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-13 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 26, '2026-07-14 07:00:00', '2026-07-15 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-14 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 26, '2026-07-15 07:00:00', '2026-07-16 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-15 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-15 22:00:00', '2026-07-16 21:59:59', 'vacation', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-15 22:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 26, '2026-07-16 07:00:00', '2026-07-17 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-16 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-16 22:00:00', '2026-07-17 21:59:59', 'vacation', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-16 22:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 26, '2026-07-17 07:00:00', '2026-07-18 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-17 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-18 07:00:00', '2026-07-19 07:00:00', 'work', 'FIX', 24, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-18 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 4, '2026-07-19 07:00:00', '2026-07-20 07:00:00', 'work', 'FIX', 24, 7, 17, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-19 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-20 07:00:00', '2026-07-21 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-20 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-21 07:00:00', '2026-07-22 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-21 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-22 07:00:00', '2026-07-23 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-22 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-23 07:00:00', '2026-07-24 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-23 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-24 07:00:00', '2026-07-25 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-24 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-25 07:00:00', '2026-07-26 07:00:00', 'work', 'FIX', 24, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-25 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 3, '2026-07-26 07:00:00', '2026-07-26 17:00:00', 'work', 'FIX', 10, 0, 10, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-26 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-26 17:00:00', '2026-07-27 07:00:00', 'work', 'FIX', 14, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-26 17:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-27 07:00:00', '2026-07-28 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-27 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-28 07:00:00', '2026-07-29 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-28 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-29 07:00:00', '2026-07-30 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-29 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-30 07:00:00', '2026-07-31 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-30 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-07-31 07:00:00', '2026-08-01 07:00:00', 'work', 'FIX', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-31 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-08-01 07:00:00', '2026-08-02 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-08-02 07:00:00', '2026-08-03 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 17, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-08-03 07:00:00', '2026-08-04 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-08-04 07:00:00', '2026-08-05 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours)
SELECT 1, 7, '2026-08-05 07:00:00', '2026-08-06 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-05 07:00:00');

-- SCHRITT 4: Überprüfung
SELECT COUNT(*) as gesamt_dienste, MIN(start_time) as von, MAX(start_time) as bis
FROM shifts WHERE team_id = 1;
