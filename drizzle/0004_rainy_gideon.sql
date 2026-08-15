CREATE TABLE `team_name_translations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`englishName` varchar(160) NOT NULL,
	`traditionalName` varchar(160) NOT NULL,
	`source` enum('llm','curated') NOT NULL DEFAULT 'llm',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_name_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_name_translations_englishName_unique` UNIQUE(`englishName`)
);
