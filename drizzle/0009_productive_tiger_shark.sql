CREATE TABLE `weekly_model_report_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`cronExpression` varchar(64) NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`lastStartedAt` timestamp,
	`lastCompletedAt` timestamp,
	`lastReportId` int,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `weekly_model_report_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `weekly_model_report_jobs_scheduleCronTaskUid_unique` UNIQUE(`scheduleCronTaskUid`)
);
--> statement-breakpoint
CREATE TABLE `weekly_model_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`settledMarkets` int NOT NULL DEFAULT 0,
	`favorableMarkets` int NOT NULL DEFAULT 0,
	`winnerMarkets` int NOT NULL DEFAULT 0,
	`favorableWinnerMarkets` int NOT NULL DEFAULT 0,
	`featureSnapshots` int NOT NULL DEFAULT 0,
	`xgMissingSnapshots` int NOT NULL DEFAULT 0,
	`oddsCoveredSnapshots` int NOT NULL DEFAULT 0,
	`restMissingSnapshots` int NOT NULL DEFAULT 0,
	`driftStatus` enum('insufficient','stable','watch') NOT NULL DEFAULT 'insufficient',
	`content` text NOT NULL,
	`deliveryStatus` enum('pending','sent','partial','failed') NOT NULL DEFAULT 'pending',
	`deliveryError` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weekly_model_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `weekly_model_report_period_unique` UNIQUE(`periodStart`,`periodEnd`)
);
--> statement-breakpoint
CREATE INDEX `weekly_model_report_created_idx` ON `weekly_model_reports` (`createdAt`);