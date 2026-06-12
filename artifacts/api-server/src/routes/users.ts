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

const router = Router();

router.get("/users", async (req, res) => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }
  let rows = await db.select().from(usersTable);
  if (query.data.role) {
    rows = rows.filter((u) => u.role === query.data.role);
  }
  res.json(rows);
});

router.post("/users", async (req, res) => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const [user] = await db.insert(usersTable).values(body.data).returning();
  res.status(201).json(user);
});

router.get("/users/:id", async (req, res) => {
  const params = GetUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

router.patch("/users/:id", async (req, res) => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const [user] = await db
    .update(usersTable)
    .set(body.data)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

router.delete("/users/:id", async (req, res) => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.status(204).send();
});

export default router;
