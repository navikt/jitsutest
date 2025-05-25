import { createRoute, verifyAdmin } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { rpc } from "juava";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { isTruish } from "../../../lib/shared/chores";

const log = getServerLog("catalog-refresh");
const yaml = require("js-yaml");
const branch = `master`;
const repo = `airbytehq/airbyte`;
const basePath = `airbyte-integrations/connectors`;

function shuffle<T>(arr: T[]) {
  let currentIndex = arr.length;
  let temporaryValue: T;
  let randomIndex: number;

  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex--);
    temporaryValue = arr[currentIndex];
    arr[currentIndex] = arr[randomIndex];
    arr[randomIndex] = temporaryValue;
  }

  return arr;
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ limit: z.string().optional(), source: z.string().optional(), initial: z.string().optional() }),
  })
  .handler(async ({ user, req, query }) => {
    if (!process.env.SYNCS_ENABLED) {
      return;
    }
    await verifyAdmin(user);

    const initialMode = isTruish(query.initial);

    const sources: string[] = (await rpc(`https://api.github.com/repos/${repo}/contents/${basePath}?ref=${branch}`))
      .filter(({ name }) => name.startsWith("source-"))
      .filter(({ name }) => !query.source || name === query.source || `airbyte/${name}` === query.source)
      .map(({ name }) => name);

    shuffle(sources);

    log.atInfo().log(`Found ${sources.length} sources`);
    const max = query.limit ? Math.min(parseInt(query.limit), sources.length) : sources.length;
    const statuses = {};

    const promises: Promise<any>[] = [];
    for (let i = 0; i < max; i++) {
      const src = sources[i];
      promises.push(processSrc(src, initialMode));
      if (i % 10 === 0) {
        const results = await Promise.all(promises);
        for (const result of results) {
          Object.assign(statuses, result);
        }
        promises.length = 0;
      }
    }
    const results = await Promise.all(promises);
    for (const result of results) {
      Object.assign(statuses, result);
    }
    const processed = Math.min(sources.length, max);
    log.atInfo().log(`Processed ${sources.length} sources`);
    return {
      total: sources.length,
      processed: processed,
      statuses,
    };
  })
  .toNextApiHandler();

async function processSrc(src: string, initial?: boolean) {
  const presentId = (
    await db.prisma().connectorPackage.findFirst({ where: { packageId: `airbyte/${src}`, packageType: "airbyte" } })
  )?.id;
  if (presentId && initial) {
    log.atDebug().log(`Skipping ${src} because it's already in the database`);
    return { [`airbyte/${src}`]: "already initialized" };
  }
  let logger = log.atInfo();
  if (initial) {
    // initial is used in docker-compose init. no need for logs spam
    logger = log.atDebug();
  }
  const mitVersions = new Set<string>();
  const metadataUrl = `https://raw.githubusercontent.com/${repo}/master/${basePath}/${src}/metadata.yaml`;
  const res = await fetch(metadataUrl);
  let packageId: string | undefined = undefined;
  let metadata: any = {};
  let icon: Uint8Array | undefined = undefined;
  logger.log(`Processing ${src}: ${metadataUrl}`);
  if (res.ok) {
    metadata = yaml.load(await res.text(), { json: true });

    const license = metadata.data?.license?.toLowerCase();
    if (license?.includes("mit")) {
      mitVersions.add(metadata.data.dockerImageTag);
    }

    packageId = metadata.data?.dockerRepository || `airbyte/${src}`;
  } else {
    log.atWarn().log(`Source ${src} doesn't have metadata.yaml`);
    packageId = `airbyte/${src}`;
  }

  if (metadata?.data?.icon) {
    const iconUrl = `https://raw.githubusercontent.com/${repo}/master/${basePath}/${src}/icon.svg`;
    const iconRes = await fetch(iconUrl);
    if (iconRes.ok) {
      icon = new Uint8Array(await iconRes.arrayBuffer());
    } else {
      logger.log(`Source ${src} icon file ${metadata.data?.icon} doesn't exist at ${iconUrl}`);
    }
  }

  const data = {
    packageId: packageId as string,
    packageType: "airbyte",
    meta: {
      ...(metadata?.data || {}),
      ...([...mitVersions].length > 0 ? { mitVersions: [...mitVersions] } : {}),
    },
    logoSvg: icon,
  };

  const currentId =
    presentId ||
    (await db.prisma().connectorPackage.findFirst({ where: { packageId: packageId, packageType: "airbyte" } }))?.id;

  if (currentId) {
    logger.log(`Updating ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
    await db.prisma().connectorPackage.update({ where: { id: currentId }, data });
    return { [`${packageId}`]: "updated" };
  } else {
    logger.log(`Creating ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
    await db.prisma().connectorPackage.create({ data: data });
    return { [`${packageId}`]: "created" };
  }
}
