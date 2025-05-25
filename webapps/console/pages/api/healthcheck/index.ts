import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/server/db";
import { getServerLog } from "../../../lib/server/log";

const healthChecks: Record<string, () => Promise<any>> = {
  prisma: async () => {
    await db.prisma.waitInit();
    await db.prisma().configurationObject.count();
    await db.prisma().configurationObjectLink.count();
    await db.prisma().userProfile.count();
  },
  postgres: async () => {
    await db.pgPool.waitInit();
    await db.pgPool().query(`SELECT 1 as pgpool_healthcheck`);
  },
};

const log = getServerLog("healthcheck");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const result: Record<string, any> = {};
  let hasErrors: boolean = false;
  for (const [service, check] of Object.entries(healthChecks)) {
    try {
      const start = Date.now();
      await check();
      const ms = Date.now() - start;
      result[service] = { status: "ok", ms };
    } catch (e) {
      log.atError().withCause(e).log(`Service ${service} failed to initialize`, e);
      result[service] = { status: "error" };
      hasErrors = true;
    }
  }
  res.status(hasErrors ? 503 : 200).send({ status: hasErrors ? "error" : "ok", ...result });
}
