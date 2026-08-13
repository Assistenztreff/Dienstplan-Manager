/**
 * TEMPORÄRER Notfall-Passwort-Reset-Endpunkt.
 * MUSS nach Gebrauch sofort entfernt und neu deployed werden.
 *
 * GET /api/emergency-reset-xK9pQ7mR2t/status
 *   → zeigt E-Mail + role des gefundenen Nutzers (kein Passwort-Reset)
 *
 * POST /api/emergency-reset-xK9pQ7mR2t/reset
 *   Body: { email: string, password: string }
 *   → setzt das Passwort des Nutzers mit der angegebenen E-Mail
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth-utils";

const SECRET_PATH = "xK9pQ7mR2t";
const router = Router();

router.get(`/api/emergency-reset-${SECRET_PATH}/status`, async (_req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        name: usersTable.name,
      })
      .from(usersTable)
      .limit(20);

    const userList = users
      .map((u) => `<li>id=${u.id} | ${u.email} | role=${u.role} | ${u.name}</li>`)
      .join("\n");

    res.send(`<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Notfall-Reset</title>
<style>body{font-family:sans-serif;max-width:500px;margin:40px auto;padding:0 16px}
input{width:100%;padding:8px;margin:6px 0 14px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{background:#1d4ed8;color:#fff;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;font-size:1rem}
#result{margin-top:16px;padding:12px;border-radius:4px;display:none}
.ok{background:#d1fae5;color:#065f46}.err{background:#fee2e2;color:#991b1b}
ul{font-size:0.85rem;background:#f9f9f9;padding:12px 12px 12px 28px;border-radius:4px}
</style>
</head>
<body>
<h2>🔑 Notfall Passwort-Reset</h2>
<p>Gefundene Nutzer in der DB:</p>
<ul>${userList}</ul>
<hr>
<label>E-Mail</label>
<input id="email" type="email" value="admin@dienstplan.local">
<label>Neues Passwort</label>
<input id="pw" type="password" value="" placeholder="Mindestens 8 Zeichen">
<button onclick="doReset()">Passwort setzen</button>
<div id="result"></div>
<script>
async function doReset() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('pw').value;
  const r = document.getElementById('result');
  r.style.display = 'block';
  r.className = '';
  r.textContent = 'Wird gesetzt…';
  try {
    const resp = await fetch('/api/emergency-reset-${SECRET_PATH}/reset', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password})
    });
    const data = await resp.json();
    r.className = data.ok ? 'ok' : 'err';
    r.textContent = data.ok ? '✅ ' + data.message : '❌ ' + data.error;
  } catch(e) {
    r.className = 'err';
    r.textContent = '❌ Fehler: ' + e;
  }
}
</script>
</body></html>`);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post(`/api/emergency-reset-${SECRET_PATH}/reset`, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ ok: false, error: "email und password erforderlich" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ ok: false, error: "Passwort zu kurz (min. 8 Zeichen)" });
    return;
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user) {
      res.status(404).json({ ok: false, error: `Nutzer '${email}' nicht gefunden` });
      return;
    }

    const newHash = hashPassword(password);
    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, user.id));

    res.json({
      ok: true,
      message: `Passwort für '${email}' (id=${user.id}, role=${user.role}) erfolgreich gesetzt.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
