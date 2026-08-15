ALTER TABLE `team_name_translation_audits` MODIFY COLUMN `action` enum('override','reset','undo') NOT NULL;--> statement-breakpoint
ALTER TABLE `team_name_translation_audits` ADD `revertsAuditId` int;--> statement-breakpoint
ALTER TABLE `team_name_translation_audits` ADD CONSTRAINT `team_name_translation_audits_revertsAuditId_unique` UNIQUE(`revertsAuditId`);