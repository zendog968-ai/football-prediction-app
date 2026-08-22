import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { getCupOverview, getEuropaOverview, getLeagueMetadata, getPrediction, getTeams, hasValidProbabilityDistribution } from "./prediction";
import { getPerformanceOverview, hasValidPerformanceOverview } from "./performance";
import { cruzeiroFlamengoSpotlight, hasValidSpotlight } from "./spotlight";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { configureTelegramWebhook, ensureResearchSchedules, getResearchNotificationStatus } from "./telegramResearch";
import { getSupabaseUpcomingCache } from "./supabaseCache";
import { getGithubActionsOverview } from "./githubActions";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  prediction: router({
    leagues: publicProcedure.query(async ({ ctx }) => {
      try {
        return await getLeagueMetadata(ctx.req);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "無法載入模型資料。",
        });
      }
    }),
    teams: publicProcedure
      .input(z.object({ leagueCode: z.string().min(1).max(8) }))
      .query(async ({ ctx, input }) => {
        try {
          return { teams: await getTeams(ctx.req, input.leagueCode) };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "無法載入球隊資料。",
          });
        }
      }),
    forecast: publicProcedure
      .input(z.object({
        leagueCode: z.string().min(1).max(8),
        homeTeam: z.string().min(2).max(100),
        awayTeam: z.string().min(2).max(100),
      }).refine(data => data.homeTeam !== data.awayTeam, {
        message: "主隊與客隊不可相同。",
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await getPrediction(ctx.req, input);
          if (!hasValidProbabilityDistribution(result)) {
            throw new Error("模型回傳的機率分佈無效。")
          }
          return result;
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "預測程序暫時無法完成。",
          });
        }
      }),
    europa: publicProcedure.query(async () => {
      try {
        return await getEuropaOverview();
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "無法載入歐霸盃官方賽程。" });
      }
    }),
    cup: publicProcedure.input(z.object({ leagueCode: z.enum(["SUD", "LCUP"]) })).query(async ({ input }) => {
      try {
        return await getCupOverview(input.leagueCode);
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "無法載入盃賽公開賽程。" });
      }
    }),
    upcomingCache: publicProcedure.query(async () => getSupabaseUpcomingCache()),
  }),
  performance: router({
    overview: publicProcedure.input(z.object({
      leagueCode: z.string().min(1).max(8).optional(),
      season: z.string().min(1).max(12).optional(),
      outcome: z.enum(["all", "H", "D", "A"]).optional(),
    }).optional()).query(async ({ ctx, input }) => {
      try {
        const overview = await getPerformanceOverview(ctx.req, input);
        if (!hasValidPerformanceOverview(overview)) throw new Error("績效資料驗證失敗。");
        return overview;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "無法載入模型績效資料。",
        });
      }
    }),
  }),
  spotlight: router({
    cruzeiroFlamengo: publicProcedure.query(() => {
      if (!hasValidSpotlight(cruzeiroFlamengoSpotlight)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "焦點賽事情境資料驗證失敗。" });
      }
      return cruzeiroFlamengoSpotlight;
    }),
  }),
  githubActions: router({
    overview: publicProcedure.query(async () => {
      try {
        return await getGithubActionsOverview();
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "GitHub Actions 狀態暫時無法讀取。",
        });
      }
    }),
  }),
  telegramResearch: router({
    status: protectedProcedure.query(async () => getResearchNotificationStatus()),
    configureWebhook: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        return await configureTelegramWebhook(ctx.req);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "無法設定Telegram webhook。" });
      }
    }),
    enableSchedules: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        return await ensureResearchSchedules(ctx.req);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "無法啟用研究排程。" });
      }
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
