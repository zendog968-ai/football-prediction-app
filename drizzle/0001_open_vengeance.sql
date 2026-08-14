CREATE TABLE `odds_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`apiFixtureId` int NOT NULL,
	`leagueCode` varchar(8) NOT NULL,
	`apiLeagueId` int NOT NULL,
	`fixtureKickoffAt` timestamp NOT NULL,
	`bookmakerId` int NOT NULL,
	`bookmakerName` varchar(120) NOT NULL,
	`marketName` varchar(120) NOT NULL,
	`selection` varchar(120) NOT NULL,
	`handicapOrTotal` varchar(24),
	`decimalOdds` decimal(8,3) NOT NULL,
	`sourceUpdatedAt` timestamp,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `odds_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `odds_snapshot_unique` UNIQUE(`apiFixtureId`,`bookmakerId`,`marketName`,`selection`,`capturedAt`)
);
--> statement-breakpoint
CREATE TABLE `research_digests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`window` enum('day','evening','settlement') NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`asOf` timestamp NOT NULL,
	`content` text NOT NULL,
	`signalCount` int NOT NULL DEFAULT 0,
	`deliveryStatus` enum('pending','sent','partial','failed') NOT NULL DEFAULT 'pending',
	`deliveryError` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_digests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_schedule_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('settlement','day_digest','evening_digest') NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`cronExpression` varchar(64) NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`lastStartedAt` timestamp,
	`lastCompletedAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_schedule_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_schedule_jobs_kind_unique` UNIQUE(`kind`),
	CONSTRAINT `research_schedule_jobs_scheduleCronTaskUid_unique` UNIQUE(`scheduleCronTaskUid`)
);
--> statement-breakpoint
CREATE TABLE `research_settlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`digestId` int NOT NULL,
	`apiFixtureId` int NOT NULL,
	`marketName` varchar(120) NOT NULL,
	`selection` varchar(120) NOT NULL,
	`outcome` enum('win','push','loss','half_win','half_loss','void','pending') NOT NULL DEFAULT 'pending',
	`homeGoals` int,
	`awayGoals` int,
	`settledAt` timestamp,
	`sourcePayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_settlements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`displayName` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`stoppedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_subscriptions_chatId_unique` UNIQUE(`chatId`)
);
--> statement-breakpoint
CREATE INDEX `odds_fixture_captured_idx` ON `odds_snapshots` (`apiFixtureId`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `odds_league_kickoff_idx` ON `odds_snapshots` (`leagueCode`,`fixtureKickoffAt`);--> statement-breakpoint
CREATE INDEX `settlement_fixture_idx` ON `research_settlements` (`apiFixtureId`);--> statement-breakpoint
CREATE INDEX `settlement_digest_idx` ON `research_settlements` (`digestId`);