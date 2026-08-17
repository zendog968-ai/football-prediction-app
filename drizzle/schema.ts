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
  isAdmin: boolean("isAdmin").notNull().default(false),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  stoppedAt: timestamp("stoppedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Privacy-preserving Telegram webhook audit: command metadata only, never raw message content. */
export const telegramInboundEvents = mysqlTable("telegram_inbound_events", {
  id: int("id").autoincrement().primaryKey(),
  telegramUpdateId: varchar("telegramUpdateId", { length: 32 }).notNull().unique(),
  chatId: varchar("chatId", { length: 64 }),
  command: varchar("command", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["received", "processed", "rejected", "failed", "ignored"]).notNull().default("received"),
  errorSummary: varchar("errorSummary", { length: 255 }),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  handledAt: timestamp("handledAt"),
}, table => [
  index("telegram_inbound_chat_received_idx").on(table.chatId, table.receivedAt),
  index("telegram_inbound_status_received_idx").on(table.status, table.receivedAt),
]);

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

/** Immutable aggregate delivery and alert events for each Telegram research schedule. */
export const researchDeliveryEvents = mysqlTable("research_delivery_events", {
  id: int("id").autoincrement().primaryKey(),
  scheduleKind: mysqlEnum("scheduleKind", ["settlement", "day_digest", "evening_digest"]).notNull(),
  eventType: mysqlEnum("eventType", ["digest_delivery", "schedule_failure", "schedule_missed"]).notNull(),
  digestId: int("digestId"),
  deliveryStatus: mysqlEnum("deliveryStatus", ["sent", "partial", "failed", "alert_sent"]).notNull(),
  recipientCount: int("recipientCount").notNull().default(0),
  deliveredCount: int("deliveredCount").notNull().default(0),
  failedCount: int("failedCount").notNull().default(0),
  detail: text("detail"),
  eventAt: timestamp("eventAt").defaultNow().notNull(),
}, table => [
  index("delivery_event_kind_time_idx").on(table.scheduleKind, table.eventAt),
  index("delivery_event_digest_idx").on(table.digestId),
]);

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

/** Project-level weekly research report job. The callback finds this row by task UID only. */
export const weeklyModelReportJobs = mysqlTable("weekly_model_report_jobs", {
  id: int("id").autoincrement().primaryKey(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
  isEnabled: boolean("isEnabled").notNull().default(false),
  lastStartedAt: timestamp("lastStartedAt"),
  lastCompletedAt: timestamp("lastCompletedAt"),
  lastReportId: int("lastReportId"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** Immutable weekly model-health reports, including settlement outcomes and feature-coverage drift. */
export const weeklyModelReports = mysqlTable("weekly_model_reports", {
  id: int("id").autoincrement().primaryKey(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  settledMarkets: int("settledMarkets").notNull().default(0),
  favorableMarkets: int("favorableMarkets").notNull().default(0),
  winnerMarkets: int("winnerMarkets").notNull().default(0),
  favorableWinnerMarkets: int("favorableWinnerMarkets").notNull().default(0),
  featureSnapshots: int("featureSnapshots").notNull().default(0),
  xgMissingSnapshots: int("xgMissingSnapshots").notNull().default(0),
  oddsCoveredSnapshots: int("oddsCoveredSnapshots").notNull().default(0),
  restMissingSnapshots: int("restMissingSnapshots").notNull().default(0),
  driftStatus: mysqlEnum("driftStatus", ["insufficient", "stable", "watch"]).notNull().default("insufficient"),
  content: text("content").notNull(),
  deliveryStatus: mysqlEnum("deliveryStatus", ["pending", "sent", "partial", "failed"]).notNull().default("pending"),
  deliveryError: text("deliveryError"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("weekly_model_report_period_unique").on(table.periodStart, table.periodEnd),
  index("weekly_model_report_created_idx").on(table.createdAt),
]);

/** Durable server-generated Traditional Chinese names for clubs absent from the curated dictionary. */
export const teamNameTranslations = mysqlTable("team_name_translations", {
  id: int("id").autoincrement().primaryKey(),
  englishName: varchar("englishName", { length: 160 }).notNull().unique(),
  traditionalName: varchar("traditionalName", { length: 160 }).notNull(),
  source: mysqlEnum("source", ["llm", "curated"]).notNull().default("llm"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

/** LLM transliterations are queued here until an administrator explicitly promotes them to the main dictionary. */
export const pendingTeamNameTranslations = mysqlTable("pending_team_name_translations", {
  id: int("id").autoincrement().primaryKey(),
  englishName: varchar("englishName", { length: 160 }).notNull().unique(),
  suggestedTraditionalName: varchar("suggestedTraditionalName", { length: 160 }).notNull(),
  source: mysqlEnum("source", ["llm", "test"]).notNull().default("llm"),
  status: mysqlEnum("status", ["pending", "approved", "dismissed"]).notNull().default("pending"),
  seenCount: int("seenCount").notNull().default(1),
  approvedTraditionalName: varchar("approvedTraditionalName", { length: 160 }),
  approvedByChatId: varchar("approvedByChatId", { length: 64 }),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, table => [
  index("pending_translation_status_created_idx").on(table.status, table.createdAt),
]);

/** Every administrator override or reset of an automated team-name translation is auditable. */
export const teamNameTranslationAudits = mysqlTable("team_name_translation_audits", {
  id: int("id").autoincrement().primaryKey(),
  englishName: varchar("englishName", { length: 160 }).notNull(),
  previousTraditionalName: varchar("previousTraditionalName", { length: 160 }),
  nextTraditionalName: varchar("nextTraditionalName", { length: 160 }),
  action: mysqlEnum("action", ["override", "reset", "undo", "approve"]).notNull(),
  revertsAuditId: int("revertsAuditId").unique(),
  adminChatId: varchar("adminChatId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("translation_audit_english_idx").on(table.englishName), index("translation_audit_created_idx").on(table.createdAt)]);

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

/** Links each pushed research card to its API fixture so completed matches receive one auditable review. */
export const researchDigestFixtures = mysqlTable("research_digest_fixtures", {
  id: int("id").autoincrement().primaryKey(),
  digestId: int("digestId").notNull(),
  apiFixtureId: int("apiFixtureId").notNull(),
  leagueCode: varchar("leagueCode", { length: 16 }).notNull(),
  leagueName: varchar("leagueName", { length: 120 }),
  fixtureKickoffAt: timestamp("fixtureKickoffAt").notNull(),
  homeTeamName: varchar("homeTeamName", { length: 120 }).notNull(),
  awayTeamName: varchar("awayTeamName", { length: 120 }).notNull(),
  reviewDigestId: int("reviewDigestId").unique(),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("digest_fixture_unique").on(table.digestId, table.apiFixtureId),
  index("digest_fixture_pending_idx").on(table.reviewDigestId, table.fixtureKickoffAt),
  index("digest_fixture_api_idx").on(table.apiFixtureId),
]);

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
