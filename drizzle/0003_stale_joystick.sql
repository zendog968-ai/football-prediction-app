CREATE TABLE `all_league_sync_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`cronExpression` varchar(64) NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`lastStartedAt` timestamp,
	`lastCompletedAt` timestamp,
	`lastFixtureCount` int NOT NULL DEFAULT 0,
	`lastLeagueCount` int NOT NULL DEFAULT 0,
	`lastCountryCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `all_league_sync_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `all_league_sync_jobs_scheduleCronTaskUid_unique` UNIQUE(`scheduleCronTaskUid`)
);
