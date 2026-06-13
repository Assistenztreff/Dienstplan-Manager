import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateUserBody,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  GetUserParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  let rows = await db.select().from(usersTable);
  if (query.data.role) {
    rows = rows.filter((u) => u.role === query.data.role);
  }
  res.json(rows);
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [user] = await db.insert(usersTable).values(body.data).returning();
  res.status(201).json(user);
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(body.data)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.status(204).send();
});

export default router;
