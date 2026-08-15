CREATE TABLE `team_name_translation_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`englishName` varchar(160) NOT NULL,
	`previousTraditionalName` varchar(160),
	`nextTraditionalName` varchar(160),
	`action` enum('override','reset') NOT NULL,
	`adminChatId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_name_translation_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `telegram_subscriptions` ADD `isAdmin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `translation_audit_english_idx` ON `team_name_translation_audits` (`englishName`);--> statement-breakpoint
CREATE INDEX `translation_audit_created_idx` ON `team_name_translation_audits` (`createdAt`);