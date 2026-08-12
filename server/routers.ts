import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { getLeagueMetadata, getPrediction, getTeams, hasValidProbabilityDistribution } from "./prediction";
import { publicProcedure, router } from "./_core/trpc";

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
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
