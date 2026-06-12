import { Router } from "express";
import { db } from "@workspace/db";
import { contractsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListContractsQueryParams,
  CreateContractBody,
  GetContractParams,
  UpdateContractParams,
  UpdateContractBody,
  DeleteContractParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/contracts", async (req, res) => {
  const query = ListContractsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
  });
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }
  const rows = await db
    .select({
      id: contractsTable.id,
      userId: contractsTable.userId,
      weeklyHours: contractsTable.weeklyHours,
      vacationDays: contractsTable.vacationDays,
      startDate: contractsTable.startDate,
      endDate: contractsTable.endDate,
      notes: contractsTable.notes,
      createdAt: contractsTable.createdAt,
      user: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        phone: usersTable.phone,
        address: usersTable.address,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      },
    })
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(query.data.userId ? eq(contractsTable.userId, query.data.userId) : undefined);
  res.json(rows);
});

router.post("/contracts", async (req, res) => {
  const body = CreateContractBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const [contract] = await db.insert(contractsTable).values(body.data).returning();
  const [withUser] = await db
    .select({
      id: contractsTable.id,
      userId: contractsTable.userId,
      weeklyHours: contractsTable.weeklyHours,
      vacationDays: contractsTable.vacationDays,
      startDate: contractsTable.startDate,
      endDate: contractsTable.endDate,
      notes: contractsTable.notes,
      createdAt: contractsTable.createdAt,
      user: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        phone: usersTable.phone,
        address: usersTable.address,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      },
    })
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, contract.id));
  res.status(201).json(withUser);
});

router.get("/contracts/:id", async (req, res) => {
  const params = GetContractParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
    .select({
      id: contractsTable.id,
      userId: contractsTable.userId,
      weeklyHours: contractsTable.weeklyHours,
      vacationDays: contractsTable.vacationDays,
      startDate: contractsTable.startDate,
      endDate: contractsTable.endDate,
      notes: contractsTable.notes,
      createdAt: contractsTable.createdAt,
      user: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        phone: usersTable.phone,
        address: usersTable.address,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      },
    })
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.patch("/contracts/:id", async (req, res) => {
  const params = UpdateContractParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateContractBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const [updated] = await db
    .update(contractsTable)
    .set(body.data)
    .where(eq(contractsTable.id, params.data.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [withUser] = await db
    .select({
      id: contractsTable.id,
      userId: contractsTable.userId,
      weeklyHours: contractsTable.weeklyHours,
      vacationDays: contractsTable.vacationDays,
      startDate: contractsTable.startDate,
      endDate: contractsTable.endDate,
      notes: contractsTable.notes,
      createdAt: contractsTable.createdAt,
      user: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        phone: usersTable.phone,
        address: usersTable.address,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      },
    })
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/contracts/:id", async (req, res) => {
  const params = DeleteContractParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(contractsTable).where(eq(contractsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
