import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2";

const mocks = vi.hoisted(() => ({ createPool: vi.fn(), drizzle: vi.fn() }));
vi.mock("mysql2", async importOriginal => ({
  ...await importOriginal<typeof import("mysql2")>(),
  createPool: mocks.createPool,
}));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocks.drizzle }));
vi.mock("./_core/env", () => ({ ENV: { ownerOpenId: "unit-test-owner" } }));

type SetupCallback = (error: NodeJS.ErrnoException | null) => void;
type TestConnection = ReturnType<typeof connection>;
type AcquireCallback = (error: NodeJS.ErrnoException | null, client: TestConnection) => void;

function connection() {
  let finishSetup: SetupCallback | undefined;
  return {
    query: vi.fn((_sql: string, callback: SetupCallback) => { finishSetup = callback; }),
    destroy: vi.fn(),
    release: vi.fn(),
    finishSetup(error: NodeJS.ErrnoException | null = null) { finishSetup!(error); },
  };
}

function poolFixture(clients = [connection()]) {
  let next = 0;
  const pool = {
    getConnection: vi.fn((callback: AcquireCallback) => callback(null, clients[next++])),
    end: vi.fn((callback: () => void) => callback()),
  };
  mocks.createPool.mockReturnValue(pool);
  mocks.drizzle.mockImplementation(client => ({ $client: client }));
  return { pool, clients };
}

beforeEach(() => {
  vi.resetModules();
  mocks.createPool.mockReset();
  mocks.drizzle.mockReset();
  vi.stubEnv("DATABASE_URL", "mysql://unit_test:fake_password@localhost/unit_test?timezone=local");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("UTC database connection contract", () => {
  it("remains lazy and usable without a database URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("./db");
    expect(await getDb()).toBeNull();
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(mocks.drizzle).not.toHaveBeenCalled();
  });

  it("forces UTC serialization even if a connection URI requests local time", async () => {
    const { pool } = poolFixture();
    const { getDb } = await import("./db");
    const db = await getDb();
    expect(mocks.createPool).toHaveBeenCalledWith({
      uri: "mysql://unit_test:fake_password@localhost/unit_test?timezone=local",
      timezone: "Z",
    });
    expect(mocks.drizzle).toHaveBeenCalledWith(pool);
    expect(await getDb()).toBe(db);
    expect(mocks.createPool).toHaveBeenCalledTimes(1);
  });

  it("waits for UTC session setup before exposing a connection or transaction client", async () => {
    const { pool, clients } = poolFixture();
    const { getDb } = await import("./db");
    await getDb();
    const callback = vi.fn();
    pool.getConnection(callback);
    expect(clients[0].query).toHaveBeenCalledWith("SET SESSION time_zone = '+00:00'", expect.any(Function));
    expect(callback).not.toHaveBeenCalled();
    clients[0].finishSetup();
    expect(callback).toHaveBeenCalledWith(null, clients[0]);
  });

  it("sets UTC on every checkout, including reused and replacement connections", async () => {
    const reused = connection();
    const replacement = connection();
    const { pool } = poolFixture([reused, reused, replacement]);
    const { getDb } = await import("./db");
    await getDb();
    for (const client of [reused, reused, replacement]) {
      const callback = vi.fn();
      pool.getConnection(callback);
      expect(callback).not.toHaveBeenCalled();
      client.finishSetup();
      expect(callback).toHaveBeenCalledWith(null, client);
    }
    expect(reused.query).toHaveBeenCalledTimes(2);
    expect(replacement.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed and destroys a connection if UTC setup is rejected", async () => {
    const { pool, clients } = poolFixture();
    const { getDb } = await import("./db");
    await getDb();
    const callback = vi.fn();
    pool.getConnection(callback);
    const error = Object.assign(new Error("session setup rejected"), { code: "ER_SPECIFIC_ACCESS_DENIED_ERROR" });
    clients[0].finishSetup(error);
    expect(clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(clients[0].release).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(error, clients[0]);
  });

  it("propagates acquisition failure without attempting session setup", async () => {
    const { pool, clients } = poolFixture();
    const error = new Error("cannot acquire connection");
    pool.getConnection.mockImplementation(callback => callback(error, clients[0]));
    const { getDb } = await import("./db");
    await getDb();
    const callback = vi.fn();
    pool.getConnection(callback);
    expect(callback).toHaveBeenCalledWith(error, clients[0]);
    expect(clients[0].query).not.toHaveBeenCalled();
  });

  it("does not log connection details when pool construction fails and can retry", async () => {
    mocks.createPool.mockImplementation(() => { throw new Error("contains fake connection password"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getDb } = await import("./db");
    expect(await getDb()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[Database] Failed to initialize UTC connection pool");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("password");
    poolFixture();
    expect(await getDb()).not.toBeNull();
  });

  it("closes an unused pool if Drizzle initialization fails", async () => {
    const { pool } = poolFixture();
    mocks.drizzle.mockImplementation(() => { throw new Error("initialization failure"); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getDb } = await import("./db");
    expect(await getDb()).toBeNull();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("keeps future DB-default receivedAt and UTC handledAt on the same basis with an HKT server default", async () => {
    const { pool, clients } = poolFixture();
    const { getDb } = await import("./db");
    await getDb();
    let serverSessionZone = "+08:00";
    const instant = new Date("2026-11-08T02:30:06Z");
    clients[0].query.mockImplementation((sql, callback) => {
      expect(sql).toBe("SET SESSION time_zone = '+00:00'");
      serverSessionZone = "+00:00";
      callback(null);
    });
    pool.getConnection(() => undefined);
    // Model CURRENT_TIMESTAMP's session rendering, then use mysql2's real
    // Date serializer. No database, audit rows or historical records are touched.
    const receivedAt = mysql.format("?", [instant], false, serverSessionZone);
    const handledAt = mysql.format("?", [new Date(instant.getTime() + 12000)], false, "Z");
    expect(receivedAt).toBe("'2026-11-08 02:30:06.000'");
    expect(handledAt).toBe("'2026-11-08 02:30:18.000'");
    const parsedReceivedAt = new Date(`${receivedAt.slice(1, -1).replace(" ", "T")}Z`);
    const parsedHandledAt = new Date(`${handledAt.slice(1, -1).replace(" ", "T")}Z`);
    expect(parsedHandledAt.getTime() - parsedReceivedAt.getTime()).toBe(12000);
  });
});
