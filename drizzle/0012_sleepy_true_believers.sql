CREATE TABLE `telegram_inbound_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUpdateId` varchar(32) NOT NULL,
	`chatId` varchar(64),
	`command` varchar(64) NOT NULL,
	`status` enum('received','processed','rejected','failed','ignored') NOT NULL DEFAULT 'received',
	`errorSummary` varchar(255),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`handledAt` timestamp,
	CONSTRAINT `telegram_inbound_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_inbound_events_telegramUpdateId_unique` UNIQUE(`telegramUpdateId`)
);
--> statement-breakpoint
CREATE INDEX `telegram_inbound_chat_received_idx` ON `telegram_inbound_events` (`chatId`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `telegram_inbound_status_received_idx` ON `telegram_inbound_events` (`status`,`receivedAt`);