import { boolean, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Telegram chat IDs are created only after the chat owner messages /start. */
export const telegramSubscriptions = mysqlTable("telegram_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  chatId: varchar("chatId", { length: 64 }).notNull().unique(),
  displayName: varchar("displayName", { length: 255 }),
  isActive: boolean("isActive").notNull().default(true),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  stoppedAt: timestamp("stoppedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Project-level Heartbeat jobs; handlers look rows up by task UID, never request bodies. */
export const researchScheduleJobs = mysqlTable("research_schedule_jobs", {
  id: int("id").autoincrement().primaryKey(),
  kind: mysqlEnum("kind", ["settlement", "day_digest", "evening_digest"]).notNull().unique(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
  isEnabled: boolean("isEnabled").notNull().default(false),
  lastStartedAt: timestamp("lastStartedAt"),
  lastCompletedAt: timestamp("lastCompletedAt"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Project-level daily catalog job. The callback finds this row by Heartbeat task UID only. */
export const allLeagueSyncJobs = mysqlTable("all_league_sync_jobs", {
  id: int("id").autoincrement().primaryKey(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
  isEnabled: boolean("isEnabled").notNull().default(false),
  lastStartedAt: timestamp("lastStartedAt"),
  lastCompletedAt: timestamp("lastCompletedAt"),
  lastFixtureCount: int("lastFixtureCount").notNull().default(0),
  lastLeagueCount: int("lastLeagueCount").notNull().default(0),
  lastCountryCount: int("lastCountryCount").notNull().default(0),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Durable server-generated Traditional Chinese names for clubs absent from the curated dictionary. */
export const teamNameTranslations = mysqlTable("team_name_translations", {
  id: int("id").autoincrement().primaryKey(),
  englishName: varchar("englishName", { length: 160 }).notNull().unique(),
  traditionalName: varchar("traditionalName", { length: 160 }).notNull(),
  source: mysqlEnum("source", ["llm", "curated"]).notNull().default("llm"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Immutable captured values from the authorised API-Football feed. */
export const oddsSnapshots = mysqlTable("odds_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  apiFixtureId: int("apiFixtureId").notNull(),
  leagueCode: varchar("leagueCode", { length: 8 }).notNull(),
  apiLeagueId: int("apiLeagueId").notNull(),
  fixtureKickoffAt: timestamp("fixtureKickoffAt").notNull(),
  homeTeamName: varchar("homeTeamName", { length: 120 }),
  awayTeamName: varchar("awayTeamName", { length: 120 }),
  bookmakerId: int("bookmakerId").notNull(),
  bookmakerName: varchar("bookmakerName", { length: 120 }).notNull(),
  marketName: varchar("marketName", { length: 120 }).notNull(),
  selection: varchar("selection", { length: 120 }).notNull(),
  handicapOrTotal: varchar("handicapOrTotal", { length: 24 }),
  decimalOdds: decimal("decimalOdds", { precision: 8, scale: 3 }).notNull(),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, table => [
  index("odds_fixture_captured_idx").on(table.apiFixtureId, table.capturedAt),
  index("odds_league_kickoff_idx").on(table.leagueCode, table.fixtureKickoffAt),
  index("odds_fixture_teams_idx").on(table.homeTeamName, table.awayTeamName, table.fixtureKickoffAt),
  uniqueIndex("odds_snapshot_unique").on(table.apiFixtureId, table.bookmakerId, table.marketName, table.selection, table.capturedAt),
]);

/** Every outbound research digest is retained before any Telegram send attempt. */
export const researchDigests = mysqlTable("research_digests", {
  id: int("id").autoincrement().primaryKey(),
  window: mysqlEnum("window", ["day", "evening", "settlement"]).notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  asOf: timestamp("asOf").notNull(),
  content: text("content").notNull(),
  signalCount: int("signalCount").notNull().default(0),
  deliveryStatus: mysqlEnum("deliveryStatus", ["pending", "sent", "partial", "failed"]).notNull().default("pending"),
  deliveryError: text("deliveryError"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Settlement is auditable per captured market selection and only uses completed API scores. */
export const researchSettlements = mysqlTable("research_settlements", {
  id: int("id").autoincrement().primaryKey(),
  digestId: int("digestId").notNull(),
  apiFixtureId: int("apiFixtureId").notNull(),
  marketName: varchar("marketName", { length: 120 }).notNull(),
  selection: varchar("selection", { length: 120 }).notNull(),
  outcome: mysqlEnum("outcome", ["win", "push", "loss", "half_win", "half_loss", "void", "pending"]).notNull().default("pending"),
  homeGoals: int("homeGoals"),
  awayGoals: int("awayGoals"),
  settledAt: timestamp("settledAt"),
  sourcePayload: json("sourcePayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("settlement_fixture_idx").on(table.apiFixtureId),
  index("settlement_digest_idx").on(table.digestId),
]);
