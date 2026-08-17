CREATE TABLE `research_delivery_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleKind` enum('settlement','day_digest','evening_digest') NOT NULL,
	`eventType` enum('digest_delivery','schedule_failure','schedule_missed') NOT NULL,
	`digestId` int,
	`deliveryStatus` enum('sent','partial','failed','alert_sent') NOT NULL,
	`recipientCount` int NOT NULL DEFAULT 0,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`detail` text,
	`eventAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_delivery_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `delivery_event_kind_time_idx` ON `research_delivery_events` (`scheduleKind`,`eventAt`);--> statement-breakpoint
CREATE INDEX `delivery_event_digest_idx` ON `research_delivery_events` (`digestId`);