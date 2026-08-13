-- ================================================================
-- PRODUKTIONSDATENBANK: Vollstaendige Datenmigration Juni-Oktober 2026
-- Erstellt: 2026-08-13  |  Ersetzt: prod-migration-2026-08-13.sql
-- Ausfuehren im Replit-Datenbankbereich -> Production -> SQL-Konsole
-- Alle INSERTs sind idempotent (uebersprungen wenn Eintrag schon vorhanden)
-- 139 Dienste fuer: Tolga(2), Florian(3), Camillo(4), Romain(7), Timo(24), Toni(26), Oliver K.(28)
-- ================================================================

-- SCHRITT 1: Admin-Passwort zuruecksetzen
-- Temporaeres Passwort: Dienstplan2026!  -> bitte nach dem Login sofort aendern
UPDATE users
SET password_hash = '70b721758420e43ce046d8630a4db7a1:f95a431d7a272c86cbf51b0c1261e2ef5803fd8736e897705ef7adf01ae984cfd242b80e9ce679ae46c82089944746611ea166163610a61561f435b973e80c83'
WHERE email = 'admin@dienstplan.local';

-- SCHRITT 2: Vertrags-Korrekturen
-- Romain Appler: Vertrag besteht seit 2019
UPDATE contracts SET start_date = '2019-01-01' WHERE id = 6;
-- Oliver Kennedy: Vertrag ab 1. Juni 2026
UPDATE contracts SET start_date = '2026-06-01' WHERE id = 12;

-- SCHRITT 3: 139 Dienste einfuegen (1. Juni - 8. Oktober 2026)
-- Team-ID = 1 | Assistenzkraefte: Tolga=2, Florian=3, Camillo=4, Romain=7, Timo=24, Toni=26, Oliver K=28

-- ---- 2026-06 ----
INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-06-01 07:00:00', '2026-06-02 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-06-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-06-02 07:00:00', '2026-06-03 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-06-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-06-03 07:00:00', '2026-06-04 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-06-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 24, '2026-06-04 07:00:00', '2026-06-05 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 24 AND team_id = 1 AND start_time = '2026-06-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 24, '2026-06-05 07:00:00', '2026-06-06 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 24 AND team_id = 1 AND start_time = '2026-06-05 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-06 07:00:00', '2026-06-07 07:00:00', 'full_day', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-06 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-07 07:00:00', '2026-06-08 07:00:00', 'full_day', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-07 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-08 07:00:00', '2026-06-09 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-08 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-09 07:00:00', '2026-06-10 07:00:00', 'full_day', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-09 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-06-10 07:00:00', '2026-06-11 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-06-10 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-06-11 07:00:00', '2026-06-12 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-06-11 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-06-12 07:00:00', '2026-06-13 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-06-12 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-06-13 07:00:00', '2026-06-14 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-06-13 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-06-14 07:00:00', '2026-06-14 15:00:00', 'work', 'FIX', 8, 0, 8, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-06-14 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-14 15:00:00', '2026-06-15 07:00:00', 'work', 'FIX', 16, 7, 9, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-14 15:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-15 07:00:00', '2026-06-16 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-15 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-16 07:00:00', '2026-06-17 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-16 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-17 07:00:00', '2026-06-18 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-17 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-18 07:00:00', '2026-06-19 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-18 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-19 07:00:00', '2026-06-20 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-19 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-06-20 07:00:00', '2026-06-21 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-06-20 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-06-21 07:00:00', '2026-06-22 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-06-21 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-06-22 07:00:00', '2026-06-23 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-06-22 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-06-23 07:00:00', '2026-06-24 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-06-23 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-06-24 07:00:00', '2026-06-25 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-06-24 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-06-25 07:00:00', '2026-06-26 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-06-25 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-26 07:00:00', '2026-06-27 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-26 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-27 07:00:00', '2026-06-28 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-27 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-28 07:00:00', '2026-06-29 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-28 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-29 07:00:00', '2026-06-30 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-29 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-06-30 07:00:00', '2026-06-30 17:00:00', 'work', 'FIX', 10, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-06-30 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 28, '2026-06-30 17:00:00', '2026-07-01 07:00:00', 'work', 'FIX', 14, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-06-30 17:00:00');

-- ---- 2026-07 ----
INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-01 07:00:00', '2026-07-02 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-02 07:00:00', '2026-07-03 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-03 07:00:00', '2026-07-04 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-04 07:00:00', '2026-07-05 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-05 07:00:00', '2026-07-06 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-05 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 28, '2026-07-06 07:00:00', '2026-07-07 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-06 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 28, '2026-07-07 07:00:00', '2026-07-08 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-07 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 28, '2026-07-08 07:00:00', '2026-07-09 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 28 AND team_id = 1 AND start_time = '2026-07-08 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-07-09 07:00:00', '2026-07-10 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-09 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-07-10 07:00:00', '2026-07-11 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-10 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-07-11 07:00:00', '2026-07-12 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-11 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-07-12 07:00:00', '2026-07-13 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-12 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-07-13 07:00:00', '2026-07-14 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-07-13 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-07-14 07:00:00', '2026-07-15 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-14 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-07-15 07:00:00', '2026-07-16 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-15 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-15 22:00:00', '2026-07-16 21:59:59', 'vacation', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-15 22:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-07-16 07:00:00', '2026-07-17 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-16 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-16 22:00:00', '2026-07-17 21:59:59', 'vacation', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-16 22:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-07-17 07:00:00', '2026-07-18 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-07-17 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-18 07:00:00', '2026-07-19 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-18 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-07-19 07:00:00', '2026-07-20 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-07-19 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-20 07:00:00', '2026-07-21 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-20 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-21 07:00:00', '2026-07-22 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-21 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-22 07:00:00', '2026-07-23 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-22 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-23 07:00:00', '2026-07-24 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-23 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-24 07:00:00', '2026-07-25 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-24 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-25 07:00:00', '2026-07-26 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-25 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-07-26 07:00:00', '2026-07-26 17:00:00', 'work', 'FIX', 10, 0, 10, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-07-26 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-26 17:00:00', '2026-07-27 07:00:00', 'work', 'FIX', 14, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-26 17:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-27 07:00:00', '2026-07-28 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-27 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-28 07:00:00', '2026-07-29 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-28 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-29 07:00:00', '2026-07-30 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-29 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-30 07:00:00', '2026-07-31 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-30 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-07-31 07:00:00', '2026-08-01 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-07-31 07:00:00');

-- ---- 2026-08 ----
INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-08-01 07:00:00', '2026-08-02 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-08-02 07:00:00', '2026-08-03 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-08-03 07:00:00', '2026-08-04 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-08-04 07:00:00', '2026-08-05 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 7, '2026-08-05 07:00:00', '2026-08-06 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 7 AND team_id = 1 AND start_time = '2026-08-05 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-06 07:00:00', '2026-08-07 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-06 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-07 07:00:00', '2026-08-08 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-07 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-08 07:00:00', '2026-08-09 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-08 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-09 07:00:00', '2026-08-10 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-09 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-10 07:00:00', '2026-08-11 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-10 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-11 07:00:00', '2026-08-12 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-11 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-12 07:00:00', '2026-08-13 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-12 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-13 07:00:00', '2026-08-14 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-13 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-14 07:00:00', '2026-08-15 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-14 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-15 07:00:00', '2026-08-16 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-15 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-16 07:00:00', '2026-08-17 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-16 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-17 07:00:00', '2026-08-18 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-17 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-18 07:00:00', '2026-08-19 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-18 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-19 07:00:00', '2026-08-20 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-19 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-20 07:00:00', '2026-08-21 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-20 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-08-21 07:00:00', '2026-08-22 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-08-21 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-22 07:00:00', '2026-08-23 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-22 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-23 07:00:00', '2026-08-24 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-23 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 2, '2026-08-24 07:00:00', '2026-08-25 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 2 AND team_id = 1 AND start_time = '2026-08-24 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-08-25 07:00:00', '2026-08-26 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-08-25 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-08-26 07:00:00', '2026-08-27 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-08-26 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-08-27 07:00:00', '2026-08-28 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-08-27 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-08-28 07:00:00', '2026-08-29 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-08-28 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-08-29 07:00:00', '2026-08-30 07:00:00', 'work', 'FIX', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-08-29 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-30 07:00:00', '2026-08-31 07:00:00', 'work', 'FIX', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-30 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-08-31 07:00:00', '2026-09-01 07:00:00', 'work', 'FIX', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-08-31 07:00:00');

-- ---- 2026-09 ----
INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-01 07:00:00', '2026-09-02 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-02 07:00:00', '2026-09-03 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-03 07:00:00', '2026-09-04 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-04 07:00:00', '2026-09-05 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-07 00:00:00', '2026-09-07 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-07 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-08 00:00:00', '2026-09-08 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-08 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-09 00:00:00', '2026-09-09 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-09 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-09-09 07:00:00', '2026-09-10 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-09-09 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-10 00:00:00', '2026-09-10 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-10 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-09-10 07:00:00', '2026-09-11 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-09-10 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-11 00:00:00', '2026-09-11 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-11 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-09-11 07:00:00', '2026-09-12 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-09-11 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-12 00:00:00', '2026-09-12 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-12 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-09-12 07:00:00', '2026-09-13 07:00:00', 'work', 'VORLAEUFIG', 24, 7, 7, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-09-12 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-13 00:00:00', '2026-09-13 23:59:59', 'vacation', 'FIX', 24, 0, 24, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-13 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 4, '2026-09-13 07:00:00', '2026-09-13 16:00:00', 'work', 'FIX', 9, 0, 9, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 4 AND team_id = 1 AND start_time = '2026-09-13 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 26, '2026-09-13 16:00:00', '2026-09-14 07:00:00', 'work', 'VORLAEUFIG', 15, 7, 8, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 26 AND team_id = 1 AND start_time = '2026-09-13 16:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-14 00:00:00', '2026-09-14 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-14 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-15 00:00:00', '2026-09-15 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-15 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-16 00:00:00', '2026-09-16 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-16 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-17 00:00:00', '2026-09-17 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-17 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-18 00:00:00', '2026-09-18 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-18 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-19 00:00:00', '2026-09-19 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-19 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-20 00:00:00', '2026-09-20 23:59:59', 'vacation', 'FIX', 24, 0, 24, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-20 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-21 00:00:00', '2026-09-21 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-21 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-22 00:00:00', '2026-09-22 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-22 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-23 00:00:00', '2026-09-23 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-23 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-24 00:00:00', '2026-09-24 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-24 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-25 00:00:00', '2026-09-25 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-25 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-26 00:00:00', '2026-09-26 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-26 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-27 00:00:00', '2026-09-27 23:59:59', 'vacation', 'FIX', 24, 0, 24, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-27 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-28 00:00:00', '2026-09-28 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-28 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-29 00:00:00', '2026-09-29 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-29 00:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-09-30 00:00:00', '2026-09-30 23:59:59', 'vacation', 'FIX', 24, 0, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-09-30 00:00:00');

-- ---- 2026-10 ----
INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-01 07:00:00', '2026-10-02 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-01 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-02 07:00:00', '2026-10-03 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 7, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-02 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-03 07:00:00', '2026-10-04 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 7, 17, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-03 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-04 07:00:00', '2026-10-05 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 17, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-04 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-05 07:00:00', '2026-10-06 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-05 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-06 07:00:00', '2026-10-07 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-06 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-07 07:00:00', '2026-10-08 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-07 07:00:00');

INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, valued_hours, night_hours, sunday_hours, holiday_hours, pause_minutes, is_vertretung)
SELECT 1, 3, '2026-10-08 07:00:00', '2026-10-09 07:00:00', 'work', 'ANGEBOTEN', 24, 7, 0, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE user_id = 3 AND team_id = 1 AND start_time = '2026-10-08 07:00:00');

-- SCHRITT 4: Ueberpruefung (nach dem Ausfuehren sichtbar)
SELECT
  user_id,
  COUNT(*) as dienste,
  MIN(start_time::date) as erster,
  MAX(start_time::date) as letzter
FROM shifts
WHERE team_id = 1 AND start_time >= '2026-06-01'
GROUP BY user_id
ORDER BY user_id;

-- Erwartet: 7 Zeilen fuer user_ids 2, 3, 4, 7, 24, 26, 28
-- Gesamtanzahl aller Dienste in Team 1:
SELECT COUNT(*) as gesamt_team1 FROM shifts WHERE team_id = 1;
