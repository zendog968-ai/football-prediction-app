CREATE TABLE `pending_team_name_translations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`englishName` varchar(160) NOT NULL,
	`suggestedTraditionalName` varchar(160) NOT NULL,
	`source` enum('llm','test') NOT NULL DEFAULT 'llm',
	`status` enum('pending','approved','dismissed') NOT NULL DEFAULT 'pending',
	`seenCount` int NOT NULL DEFAULT 1,
	`approvedTraditionalName` varchar(160),
	`approvedByChatId` varchar(64),
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pending_team_name_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `pending_team_name_translations_englishName_unique` UNIQUE(`englishName`)
);
--> statement-breakpoint
ALTER TABLE `team_name_translation_audits` MODIFY COLUMN `action` enum('override','reset','undo','approve') NOT NULL;--> statement-breakpoint
CREATE INDEX `pending_translation_status_created_idx` ON `pending_team_name_translations` (`status`,`createdAt`);