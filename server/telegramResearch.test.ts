import { afterEach, describe, expect, it, vi } from "vitest";
import { formatFixtureDisplay } from "@shared/teamDisplay";
import { assessMarketAnomaly, describeMarketMovement, extractNaturalLanguageTeamQuery, formatCachedUpcoming, formatJobsStatus, formatLiveTeamResearch, formatModelHealthSummary, formatPreviousDayDeliveryReceipt, formatTeamResearch, formatTelegramStatus, hasCompleteDigestCandidate, isAnyLeagueMatch, isKnownTeamAlias, isLeagueMatch, normalizeTelegramCommand, parseTeamRequest, parseTrendRequest, probabilityBars, rankDailyPicks, renderOddsTrend, RESEARCH_SCHEDULES, selectDailyDigestPicks, settlementForScores, suggestTeamFixtures, TELEGRAM_HELP_MESSAGE, toTelegramHtml, todayLeagueFilter, todayLeagueFilters, verifyApiFootballReadiness } from "./telegramResearch";

afterEach(() => vi.unstubAllGlobals());

describe("研究型盤口結算", () => {
  it("正確結算全盤亞洲讓球與大小球，不把走盤算作勝或負", () => {
    expect(settlementForScores("Asian Handicap", "Home -0.5", 2, 1)).toBe("win");
    expect(settlementForScores("Asian Handicap", "Away +0", 1, 1)).toBe("push");
    expect(settlementForScores("Goals Over/Under", "Over 2.5", 2, 1)).toBe("win");
    expect(settlementForScores("Goals Over/Under", "Under 2.5", 2, 1)).toBe("loss");
  });

  it("正確處理四分之一讓球的半贏與半輸", () => {
    expect(settlementForScores("Asian Handicap", "Home -0.25", 1, 1)).toBe("half_loss");
    expect(settlementForScores("Asian Handicap", "Home +0.25", 1, 1)).toBe("half_win");
  });

  it("結算推播的主客和與Top 3波膽快照", () => {
    expect(settlementForScores("Match Winner", "Away", 1, 2)).toBe("win");
    expect(settlementForScores("Match Winner", "Home", 1, 2)).toBe("loss");
    expect(settlementForScores("Correct Score", "1-2", 1, 2)).toBe("win");
    expect(settlementForScores("Correct Score", "2-1", 1, 2)).toBe("loss");
  });

  it("拒絕未記錄完整格式的市場資料，避免杜撰結算", () => {
    expect(settlementForScores("Asian Handicap", "Home to win", 2, 1)).toBe("void");
    expect(settlementForScores("Unknown", "Over 2.5", 3, 0)).toBe("void");
  });
});

describe("Telegram研究排程", () => {
  it("以UTC六欄位cron每30分鐘掃描完場覆盤，並保留日間及晚間摘要", () => {
    expect(RESEARCH_SCHEDULES).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "settlement", cron: "0 */30 * * * *", path: "/api/scheduled/research-settlement" }),
      expect.objectContaining({ kind: "day_digest", cron: "0 0 3 * * *", path: "/api/scheduled/research-day" }),
      expect.objectContaining({ kind: "evening_digest", cron: "0 30 10 * * *", path: "/api/scheduled/research-evening" }),
    ]));
  });

  it("日間與晚間摘要具有獨立排程，不應互相取代", () => {
    expect(RESEARCH_SCHEDULES.filter(schedule => schedule.kind === "day_digest")).toHaveLength(1);
    expect(RESEARCH_SCHEDULES.filter(schedule => schedule.kind === "evening_digest")).toHaveLength(1);
  });
});

	describe("Telegram系統指令", () => {
	  it("/help列出全部可用的訂閱及研究指令", () => {
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/start");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/status");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/jobs");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/health");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/trend");
    expect(TELEGRAM_HELP_MESSAGE).toContain("/today");
    expect(TELEGRAM_HELP_MESSAGE).toContain("/upcoming");
    expect(TELEGRAM_HELP_MESSAGE).toContain("/report");
    expect(TELEGRAM_HELP_MESSAGE).toContain("/team");
    expect(TELEGRAM_HELP_MESSAGE).toContain("/stop");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("/help");
	    expect(TELEGRAM_HELP_MESSAGE).toContain("並非投注或資金建議");
	  });

	  it("以最新週報呈現模型健康、樣本與特徵缺失狀態", () => {
	    const output = formatModelHealthSummary({
	      createdAt: new Date("2026-08-17T02:15:00.000Z"),
	      settledMarkets: 30,
	      favorableMarkets: 10,
	      winnerMarkets: 5,
	      favorableWinnerMarkets: 2,
	      featureSnapshots: 0,
	      xgMissingSnapshots: 0,
	      oddsCoveredSnapshots: 0,
	      restMissingSnapshots: 0,
	      driftStatus: "insufficient",
	    });
	    expect(output).toContain("【狀態】樣本不足");
	    expect(output).toContain("【已結算市場】30 項｜有利結果 33.3%");
	    expect(output).toContain("【特徵快照】0 筆｜xG缺失 資料不足");
	  });

	  it("呈現任務下次預期、最後送達與漏發告警原因", () => {
	    const output = formatJobsStatus([{
	      kind: "day_digest",
	      isEnabled: true,
	      lastStartedAt: new Date("2026-08-17T03:00:00.000Z"),
	      lastCompletedAt: new Date("2026-08-17T03:00:08.000Z"),
	      lastError: null,
	      latestEvent: {
	        scheduleKind: "day_digest",
	        eventType: "digest_delivery",
	        deliveryStatus: "sent",
	        recipientCount: 1,
	        deliveredCount: 1,
	        failedCount: 0,
	        eventAt: new Date("2026-08-17T03:00:08.000Z"),
	      },
	    }], new Date("2026-08-17T04:00:00.000Z"));
	    expect(output).toContain("日間摘要（11:00）】已啟用");
	    expect(output).toContain("下次預期：18/8/2026 11:00:00");
	    expect(output).toContain("最後送達：已送達（1/1 位訂閱者）");

	    const receipt = formatPreviousDayDeliveryReceipt([{
	      scheduleKind: "evening_digest",
	      eventType: "schedule_missed",
	      deliveryStatus: "alert_sent",
	      recipientCount: 1,
	      deliveredCount: 1,
	      failedCount: 0,
	      detail: "漏發偵測：逾15分鐘仍未完成。",
	      eventAt: new Date("2026-08-17T11:00:00.000Z"),
	    }]);
	    expect(receipt).toContain("前日推播送達回條");
	    expect(receipt).toContain("告警：1 項");
	    expect(receipt).toContain("漏發偵測");
	  });

	  it("解析/today聯賽篩選並支援繁中與英文聯賽名稱", () => {
    expect(todayLeagueFilter("/today 英超")).toBe("英超");
    expect(todayLeagueFilter("/today@AureliaBot Premier League")).toBe("Premier League");
    expect(isLeagueMatch("英超", "Premier League", "39")).toBe(true);
    expect(isLeagueMatch("Premier League", "Premier League", "39")).toBe(true);
    expect(isLeagueMatch("墨超", "Liga MX", "262")).toBe(true);
    expect(isLeagueMatch("英超", "Liga MX", "262")).toBe(false);
    expect(todayLeagueFilters("/today 英超 西甲")).toEqual(["英超 西甲", "英超", "西甲"]);
    expect(isAnyLeagueMatch(todayLeagueFilters("/today 英超 西甲"), "La Liga", "140")).toBe(true);
    expect(isAnyLeagueMatch(todayLeagueFilters("/today 英超 西甲"), "Premier League", "39")).toBe(true);
    expect(isAnyLeagueMatch(todayLeagueFilters("/today 英超 西甲"), "Liga MX", "262")).toBe(false);
  });

  it("以HKT、本地化隊名、真實亞洲盤口與Top 3波膽呈現已同步的未來研究資料", () => {
    const bars = probabilityBars({ homeWin: 0.62, draw: 0.21, awayWin: 0.17 });
    expect(bars).toContain("🟢 主勝");
    expect(bars).toContain("🟡 和局");
    expect(bars).toContain("🔴 客勝");
    const message = formatCachedUpcoming([{
      fixtureId: 101,
      leagueName: "MLS",
      eventTime: "2026-08-15T20:00:00Z",
      homeTeam: "Example Home",
      awayTeam: "Example Away",
      homeWin: 0.62,
      draw: 0.21,
      awayWin: 0.17,
      predictedScore: "2-1",
      recommendation: "研究傾向：主勝",
      confidence: 4,
      predictionUpdatedAt: "2026-08-15T10:00:00Z",
      hasPrediction: true,
      compactMarkets: [
        { market: "主客和 (1X2)", selection: "主勝", probability: 0.62 },
        { market: "入球大細 1.5", selection: "大 1.5", probability: 0.78 },
        { market: "入球大細 2.5", selection: "大 2.5", probability: 0.56 },
        { market: "入球大細 3.5", selection: "小 3.5", probability: 0.64 },
        { market: "入球大細 4.5", selection: "小 4.5", probability: 0.82 },
        { market: "讓球盤 (Handicap)", selection: "主隊 -1", probability: 0.47, distribution: { fullWin: 0.47, halfWin: 0, push: 0.21, halfLoss: 0, fullLoss: 0.32 } },
        { market: "亞洲讓球 0.25", selection: "主隊 -0.25", probability: 0.37, distribution: { fullWin: 0.37, halfWin: 0, push: 0, halfLoss: 0.24, fullLoss: 0.39 } },
        { market: "亞洲讓球 0.75", selection: "客隊 +0.75", probability: 0.61, distribution: { fullWin: 0.49, halfWin: 0.24, push: 0, halfLoss: 0.11, fullLoss: 0.16 } },
        { market: "亞洲讓球 1.25", selection: "主隊 -1.25", probability: 0.36, distribution: { fullWin: 0.24, halfWin: 0.24, push: 0, halfLoss: 0.19, fullLoss: 0.33 } },
        { market: "亞洲讓球 1.75", selection: "客隊 +1.75", probability: 0.68, distribution: { fullWin: 0.56, halfWin: 0.24, push: 0, halfLoss: 0.08, fullLoss: 0.12 } },
      ],
      topScorelines: [{ score: "2-1", probability: 0.12 }, { score: "1-0", probability: 0.11 }, { score: "2-0", probability: 0.1 }],
      odds: { home: 1.82, draw: 3.55, away: 4.4, capturedAt: "2026-08-15T10:00:00Z" },
      handicapQuote: { source: "Bet365", homeLine: "-0.5", homeOdds: 1.91, awayLine: "+0.5", awayOdds: 1.89, capturedAt: "2026-08-15T10:00:00Z" },
    }], new Date("2026-08-15T00:00:00Z"));
    expect(message).toContain("⏰ 賽事時間：2026-08-16 04:00 (HKT)");
    expect(message).toContain("⚽️ 【Example Home】  vs  【Example Away】");
    expect(message).toContain("📊 【資料來源】Dixon–Coles 模型 + HDA 賠率融合");
    expect(message).toContain("🛡️ 【雙重機率】1X: 83.0% | X2: 38.0%");
    expect(message).toContain("⚖️ 【實時讓球盤】Bet365 主隊 -0.5 (@1.91) / 客隊 +0.5 (@1.89)");
    expect(message).toContain("🎯 【模型勝率預測】主勝 62.0% | 和局 21.0% | 客勝 17.0%");
    expect(message).toContain("🔥 【大小球】大 2.5 (56.0%) | 小 2.5 (44.0%)");
    expect(message).not.toContain("入球大細 1.5");
    expect(message).not.toContain("亞洲讓球 0.25");
    expect(message).not.toContain("全贏");
    expect(message).toContain("💡 【最高波膽 Top 3】");
    expect(message).toContain("1. 2-1 —— 12.0%");
  });

  it("/upcoming跳過缺少勝率、2.5大小球、讓球或Top 3波膽的已同步賽事", () => {
    const base = {
      fixtureId: 202, leagueName: "MLS", eventTime: "2026-08-15T20:00:00Z", homeTeam: "Example Home", awayTeam: "Example Away",
      homeWin: 0.6, draw: 0.22, awayWin: 0.18,
      compactMarkets: [{ market: "入球大細 2.5", selection: "大 2.5", probability: 0.55 }, { market: "讓球盤 (Handicap)", selection: "主隊 -0.5", probability: 0.6 }],
      topScorelines: [{ score: "2-1", probability: 0.12 }, { score: "1-0", probability: 0.11 }, { score: "2-0", probability: 0.1 }],
    } as never;
    const incomplete = { ...base, fixtureId: 201, homeWin: Number.NaN, topScorelines: [] };
    const text = formatCachedUpcoming([incomplete, base], new Date("2026-08-15T00:00:00Z"));
    expect(text).toContain("暫無可驗證HKJC／亞洲盤口");
    expect(text).toContain("【Example Home】  vs  【Example Away】");
  });

  it("在Telegram標題以繁體中文加英文原名顯示已知球隊，未知隊名保留原文", () => {
    expect(formatFixtureDisplay("Jeju United FC", "FC Anyang")).toBe("濟州SK (Jeju United FC) vs 安養FC (FC Anyang)");
    expect(formatFixtureDisplay("Shenyang Urban", "Sichuan Jiuniu")).toBe("瀋陽城市 (Shenyang Urban) vs 四川九牛 (Sichuan Jiuniu)");
    expect(formatFixtureDisplay("Internacional", "Remo")).toBe("國際體育會 (Internacional) vs 雷莫 (Remo)");
    expect(formatFixtureDisplay("Unknown FC", "FC Tokyo")).toBe("Unknown FC vs FC東京 (FC Tokyo)");
    expect(formatFixtureDisplay("Fluminense W", "America Mineiro W")).toBe("富明尼斯女足 (Fluminense W) vs 明尼路美洲女足 (America Mineiro W)");
    expect(formatFixtureDisplay("Fluminense Women", "America Mineiro Women")).toBe("富明尼斯女足 (Fluminense Women) vs 明尼路美洲女足 (America Mineiro Women)");
  });

  it("解析/team並以中文別名找到下一場已同步賽事，缺少賽事時回覆明確警示", () => {
    expect(parseTeamRequest("/team 曼聯")).toBe("曼聯");
    expect(parseTeamRequest("/team")).toBeNull();
    const fixtures = [{
      fixtureId: 999,
      leagueName: "EPL",
      eventTime: "2026-08-16T12:00:00Z",
      homeTeam: "Manchester United",
      awayTeam: "Example Away",
      compactMarkets: [{ market: "主客和 (1X2)", selection: "主勝", probability: 0.61 }],
      topScorelines: [{ score: "2-1", probability: 0.12 }, { score: "1-0", probability: 0.11 }, { score: "2-0", probability: 0.1 }],
    }] as never;
    expect(formatTeamResearch(fixtures, "曼聯", new Date("2026-08-15T00:00:00Z"))).toContain("【曼聯 (Manchester United)】  vs  【Example Away】");
    expect(formatTeamResearch(fixtures, "不存在的隊", new Date("2026-08-15T00:00:00Z"))).toBe("⚠️ 暫未找到 不存在的隊 的近期賽事資料，請確認隊名或嘗試其他熱門隊伍。");
  });

  it("支援主要聯賽的常用繁體中文隊名別名，不將無關簡稱模糊命中", () => {
    const fixture = (homeTeam: string) => [{
      fixtureId: 1000,
      leagueName: "coverage",
      eventTime: "2026-08-16T12:00:00Z",
      homeTeam,
      awayTeam: "Example Away",
      compactMarkets: [],
      topScorelines: [],
    }] as never;
    const now = new Date("2026-08-15T00:00:00Z");
    expect(formatTeamResearch(fixture("Real Madrid"), "皇馬", now)).toContain("Real Madrid");
    expect(formatTeamResearch(fixture("Bayern Munich"), "拜仁", now)).toContain("Bayern Munich");
    expect(formatTeamResearch(fixture("Inter Miami CF"), "國際邁阿密", now)).toContain("Inter Miami CF");
    expect(formatTeamResearch(fixture("Vissel Kobe"), "神戶勝利船", now)).toContain("Vissel Kobe");
    expect(formatTeamResearch(fixture("Vissel Kobe"), "神戸勝利船", now)).toContain("Vissel Kobe");
    expect(formatTeamResearch(fixture("Jeju United FC"), "濟州SK", now)).toContain("Jeju United FC");
    expect(formatTeamResearch(fixture("Jeju United FC"), "濟州sk", now)).toContain("Jeju United FC");
    expect(formatTeamResearch(fixture("Jeju United FC"), "濟州", now)).toContain("Jeju United FC");
    expect(formatTeamResearch(fixture("Jeju United FC"), "濟州聯", now)).toContain("Jeju United FC");
    expect(formatTeamResearch(fixture("Jeju United FC"), "Jeju United", now)).toContain("Jeju United FC");
    expect(formatTeamResearch(fixture("Gangwon FC"), "江原FC", now)).toContain("Gangwon FC");
    expect(formatTeamResearch(fixture("Machida Zelvia"), "町田澤維亞", now)).toContain("Machida Zelvia");
    expect(formatTeamResearch(fixture("Western United"), "西部聯", now)).toContain("Western United");
    expect(formatTeamResearch(fixture("Shanghai Port"), "上海海港", now)).toContain("Shanghai Port");
    expect(formatTeamResearch(fixture("Ulsan HD FC"), "蔚山現代", now)).toContain("Ulsan HD FC");
    expect(formatTeamResearch(fixture("Cruz Azul"), "藍十字", now)).toContain("Cruz Azul");
    expect(formatTeamResearch(fixture("Flamengo"), "法林明高", now)).toContain("Flamengo");
    expect(formatTeamResearch(fixture("Melbourne Victory"), "墨爾本勝利", now)).toContain("Melbourne Victory");
    expect(formatTeamResearch(fixture("Bristol City"), "布里斯托城", now)).toContain("Bristol City");
    expect(formatTeamResearch(fixture("Bristol City"), "布裡斯托城", now)).toContain("Bristol City");
    expect(formatTeamResearch(fixture("Bristol City"), "布里斯托爾城", now)).toContain("Bristol City");
    expect(formatTeamResearch(fixture("Bristol City"), "布里斯托尔城", now)).toContain("Bristol City");
    expect(formatTeamResearch(fixture("Bristol City"), "Bristol City", now)).toContain("Bristol City");
    expect(formatTeamResearch(fixture("Real Madrid"), "米蘭", now)).toBe("⚠️ 暫未找到 米蘭 的近期賽事資料，請確認隊名或嘗試其他熱門隊伍。");
  });

  it("可從無斜線自然語言訊息抽取最長隊名別名", () => {
    expect(extractNaturalLanguageTeamQuery("請分析 神戸勝利船 下一場")).toBe("神戸勝利船");
    expect(extractNaturalLanguageTeamQuery("幫我睇下 FC東京")).toBe("FC東京");
    expect(extractNaturalLanguageTeamQuery("請分析濟州SK近期賽事")).toBe("濟州SK");
    expect(extractNaturalLanguageTeamQuery("請分析濟州近期賽事")).toBe("濟州");
    expect(extractNaturalLanguageTeamQuery("想知國際邁阿密的賽程")).toBe("國際邁阿密");
    expect(extractNaturalLanguageTeamQuery("請分析布里斯托城今晚賽事")).toBe("布里斯托城");
    expect(extractNaturalLanguageTeamQuery("請分析布裡斯托城今晚賽事")).toBe("布裡斯托城");
    expect(isKnownTeamAlias(extractNaturalLanguageTeamQuery("請分析 神戸勝利船 下一場"))).toBe(true);
    expect(isKnownTeamAlias("布里斯托城")).toBe(true);
    expect(isKnownTeamAlias("布裡斯托城")).toBe(true);
    expect(isKnownTeamAlias("healthcheck")).toBe(false);
  });

  it("在基礎Poisson回覆標示隊伍歷史攻防或聯賽平均來源", () => {
    const base = {
      fixtureId: 202, leagueCode: "40", kickoffAt: new Date("2026-08-16T12:00:00Z"),
      leagueName: "Championship",
      homeTeam: "Bristol City",
      awayTeam: "Millwall",
      outcomes: { homeWin: 0.4, draw: 0.33, awayWin: 0.27 },
      compactMarkets: [
        { market: "入球大細 2.5", selection: "小 2.5", probability: 0.62 },
        { market: "讓球盤 (Handicap)", selection: "主隊 -0.5（模型參考）", probability: 0.4 },
      ],
      topScorelines: [{ score: "1-0", probability: 0.15 }, { score: "0-0", probability: 0.13 }, { score: "1-1", probability: 0.12 }],
    } as const;
    expect(formatLiveTeamResearch({ ...base, sourceMode: "team-history" })).toContain("【資料來源】隊伍歷史攻防");
    expect(formatLiveTeamResearch({ ...base, sourceMode: "league-average" })).toContain("【資料來源】聯賽平均");
    expect(formatLiveTeamResearch({ ...base, sourceMode: "team-history", calibrationLabel: "英冠正式聯賽樣本＋聯賽平均及主場優勢校準" })).toContain("【校準】英冠正式聯賽樣本");
  });

  it("以Telegram一般HTML文字包裝對齊研究內容並轉義特殊字元", () => {
    expect(toTelegramHtml("【主客和】\nA&B <C>")).toBe("<b>【主客和】</b>\nA&amp;B &lt;C&gt;");
  });

  it("在無完全匹配時提供最多三個可選的相近未來賽事，不包含過去賽事", () => {
    const fixtures = [
      { fixtureId: 1, eventTime: "2026-08-16T13:00:00Z", homeTeam: "Manchester United", awayTeam: "Example One" },
      { fixtureId: 2, eventTime: "2026-08-17T13:00:00Z", homeTeam: "Example Two", awayTeam: "Manchester United" },
      { fixtureId: 3, eventTime: "2026-08-18T13:00:00Z", homeTeam: "Manchester City", awayTeam: "Example Three" },
      { fixtureId: 4, eventTime: "2026-08-14T13:00:00Z", homeTeam: "Manchester United", awayTeam: "Past Fixture" },
    ] as never;
    const candidates = suggestTeamFixtures(fixtures, "曼徹斯特", new Date("2026-08-15T00:00:00Z"));
    expect(candidates).toHaveLength(3);
    expect(candidates.map(item => item.fixtureId)).toEqual([1, 2, 3]);
  });

  it("每日精選只保留最多三場完整模型、非高風險候選並按機率排序", () => {
    const candidate = (probability: number, risk: "low" | "medium" | "high", samples = 30) => ({ prediction: { lean: { probability, risk_level: risk }, diagnostics: { dc_available: true, dc_history_match_count: samples } } }) as never;
    const selected = rankDailyPicks([candidate(0.72, "medium"), candidate(0.81, "low"), candidate(0.64, "low"), candidate(0.6, "high"), candidate(0.85, "low", 19)]);
    expect(selected).toHaveLength(3);
    expect(selected.map(item => item.prediction.lean.probability)).toEqual([0.81, 0.72, 0.64]);
  });

  it("每日摘要在嚴格候選不足三場時，以可用候選依機率補足至最多三場", () => {
    const candidate = (probability: number, risk: "low" | "medium" | "high", samples: number, available: boolean) => ({ prediction: { lean: { probability, risk_level: risk }, diagnostics: { dc_available: available, dc_history_match_count: samples } } }) as never;
    const candidates = [candidate(0.62, "low", 25, true), candidate(0.59, "high", 6, true), candidate(0.55, "medium", 4, false), candidate(0.49, "high", 2, false)];
    expect(selectDailyDigestPicks(candidates).map(item => item.prediction.lean.probability)).toEqual([0.62, 0.59, 0.55]);
  });

  it("定時推播只接受具完整勝率、實際盤口與可推導波膽的候選", () => {
    const prediction = {
      probabilities: { home_win: 0.5, draw: 0.27, away_win: 0.23 },
      selected_features: { dc_expected_home_goals: 1.4, dc_expected_away_goals: 0.9 },
    } as never;
    const complete = { prediction, marketContext: [
      { marketName: "Goals Over/Under", selection: "Over 2.5", decimalOdds: 1.9 },
      { marketName: "Asian Handicap", selection: "Home -0.5", decimalOdds: 1.85 },
    ] } as never;
    expect(hasCompleteDigestCandidate(complete)).toBe(true);
    expect(hasCompleteDigestCandidate({ ...complete, marketContext: [] })).toBe(false);
    expect(hasCompleteDigestCandidate({ ...complete, prediction: { ...prediction, probabilities: { home_win: 0.5, draw: Number.NaN, away_win: 0.5 } } })).toBe(false);
  });

  it("只要有未來24小時fixture就列出，部分模型與盤口會以基礎分析而非暫無賽事呈現", () => {
    const message = formatCachedUpcoming([{
      fixtureId: 102,
      leagueName: "MLS",
      eventTime: "2026-08-15T12:00:00Z",
      homeTeam: "Fallback Home",
      awayTeam: "Fallback Away",
      homeWin: 0.48,
      draw: Number.NaN,
      awayWin: 0.28,
      predictedScore: null,
      recommendation: null,
      confidence: 0,
      predictionUpdatedAt: null,
      hasPrediction: false,
      compactMarkets: [],
      topScorelines: [],
      odds: { home: 2.05, draw: null, away: 3.6, capturedAt: "2026-08-15T09:00:00Z" },
    }, {
      fixtureId: 103,
      leagueName: "MLS",
      eventTime: "2026-08-16T01:01:00Z",
      homeTeam: "Outside Window",
      awayTeam: "Outside Window",
      homeWin: Number.NaN,
      draw: Number.NaN,
      awayWin: Number.NaN,
      predictedScore: null,
      recommendation: null,
      confidence: 0,
      predictionUpdatedAt: null,
      hasPrediction: false,
      compactMarkets: [],
      topScorelines: [],
      odds: null,
    }], new Date("2026-08-15T01:00:00Z"));
    expect(message).toBe("");
  });

  it("顯示訂閱、任務與不暴露憑證的API剩餘額度", () => {
    const message = formatTelegramStatus({
      subscriptionActive: true,
      scheduleCount: 3,
      enabledScheduleCount: 3,
      apiPlan: "Pro",
      apiActive: true,
      apiUsed: 120,
      apiLimit: 7500,
      apiError: null,
    });
    expect(message).toContain("通知訂閱：已啟用");
    expect(message).toContain("3/3 個任務啟用");
    expect(message).toContain("API-Football：正常｜方案：Pro");
    expect(message).toContain("7380/7500 次可用");
    expect(message).not.toContain("x-apisports-key");
  });

  it("在供應商暫時不可用時回覆狀態而不虛構額度", () => {
    const message = formatTelegramStatus({
      subscriptionActive: false,
      scheduleCount: 3,
      enabledScheduleCount: 2,
      apiPlan: null,
      apiActive: null,
      apiUsed: null,
      apiLimit: null,
      apiError: "連線失敗",
    });
    expect(message).toContain("通知訂閱：已停止");
    expect(message).toContain("暫時無法讀取（連線失敗）");
  });

  it("正規化/status及/stop的私訊與群組指令尾碼", () => {
    expect(normalizeTelegramCommand("/status")).toBe("/status");
    expect(normalizeTelegramCommand("/status@AureliaResearchBot extra")).toBe("/status");
    expect(normalizeTelegramCommand(" /stop ")).toBe("/stop");
    expect(normalizeTelegramCommand(undefined)).toBeUndefined();
  });

  it("解析/trend的fixture ID與主客隊格式，拒絕不完整查詢", () => {
    expect(parseTrendRequest("/trend 123456")).toEqual({ fixtureId: 123456 });
    expect(parseTrendRequest("/trend Portland Timbers vs Club Tijuana")).toEqual({ homeTeam: "Portland Timbers", awayTeam: "Club Tijuana" });
    expect(parseTrendRequest("/trend")).toBeNull();
    expect(parseTrendRequest("/trend Portland Timbers")).toBeNull();
  });
});

describe("盤路與資料品質閘門", () => {
  it("僅以多個有效的真實價格快照繪製簡易走勢圖", () => {
    expect(renderOddsTrend([1.86, 1.91, 1.95])).toMatch(/1\.86 → 1\.95 \(\+0\.09\)/);
    expect(renderOddsTrend([1.9, 1.9])).toContain("▅▅");
    expect(renderOddsTrend([1.9])).toBeNull();
    expect(renderOddsTrend([1.9, 0])).toBeNull();
  });

  it("只對急遽水位變動或線位跳盤發出異常提示", () => {
    expect(assessMarketAnomaly([{ selection: "Home -0.5", decimalOdds: 1.9 }, { selection: "Home -0.5", decimalOdds: 2.05 }])).toContain("水位急遽變動");
    expect(assessMarketAnomaly([{ selection: "Over 2.5", decimalOdds: 1.9 }, { selection: "Over 3.0", decimalOdds: 1.9 }])).toContain("線位跳盤");
    expect(assessMarketAnomaly([{ selection: "Home -0.5", decimalOdds: 1.9 }, { selection: "Home -0.5", decimalOdds: 1.94 }])).toBeNull();
    expect(assessMarketAnomaly([{ selection: "Home -0.5", decimalOdds: 1.9 }])).toBeNull();
  });

  it("分別呈現初盤基準建立中與同一博彩公司初盤至最新盤變動", () => {
    expect(describeMarketMovement({ marketName: "Asian Handicap", selection: "Home -0.5", decimalOdds: 1.9, capturedAt: new Date() })).toBe("初盤基準建立中");
    expect(describeMarketMovement({ marketName: "Goals Over/Under", selection: "Over 2.5", decimalOdds: 1.82, capturedAt: new Date(), openingSelection: "Over 2.5", openingOdds: 1.95, openingCapturedAt: new Date("2026-08-14T00:00:00Z") })).toBe("初盤 Over 2.5 @1.95 → 最新 Over 2.5 @1.82");
  });

  it("在API-Football帳戶未啟用時停止於健康閘門，不再請求任何聯賽盤口", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: { subscription: { active: false }, requests: { limit_day: 0 } }, errors: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyApiFootballReadiness()).rejects.toThrow("研究摘要已安全停止");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/status");
  });
});
