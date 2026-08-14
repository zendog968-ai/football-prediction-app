ALTER TABLE `odds_snapshots` ADD `homeTeamName` varchar(120);--> statement-breakpoint
ALTER TABLE `odds_snapshots` ADD `awayTeamName` varchar(120);--> statement-breakpoint
CREATE INDEX `odds_fixture_teams_idx` ON `odds_snapshots` (`homeTeamName`,`awayTeamName`,`fixtureKickoffAt`);