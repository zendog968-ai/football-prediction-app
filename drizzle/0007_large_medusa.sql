CREATE TABLE `research_digest_fixtures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`digestId` int NOT NULL,
	`apiFixtureId` int NOT NULL,
	`leagueCode` varchar(16) NOT NULL,
	`fixtureKickoffAt` timestamp NOT NULL,
	`homeTeamName` varchar(120) NOT NULL,
	`awayTeamName` varchar(120) NOT NULL,
	`reviewDigestId` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_digest_fixtures_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_digest_fixtures_reviewDigestId_unique` UNIQUE(`reviewDigestId`),
	CONSTRAINT `digest_fixture_unique` UNIQUE(`digestId`,`apiFixtureId`)
);
--> statement-breakpoint
CREATE INDEX `digest_fixture_pending_idx` ON `research_digest_fixtures` (`reviewDigestId`,`fixtureKickoffAt`);--> statement-breakpoint
CREATE INDEX `digest_fixture_api_idx` ON `research_digest_fixtures` (`apiFixtureId`);