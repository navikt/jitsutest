import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import * as z from "zod";
import { ConnectorPackageDbModel } from "../../../prisma/schema";
import pick from "lodash/pick";

export const SourceType = ConnectorPackageDbModel.merge(
  z.object({
    versions: z.union([z.string(), z.array(z.string())]),
    sortIndex: z.number().optional(),
    meta: z.object({
      name: z.string(),
      license: z.string(),
      mitVersions: z.array(z.string()).optional(),
      releaseStage: z.string().optional(),
      dockerImageTag: z.string().optional(),
      connectorSubtype: z.string(),
      dockerRepository: z.string().optional(),
    }),
  })
);

export type SourceType = z.infer<typeof SourceType>;

const JitsuFirebaseSource: SourceType = {
  id: "jitsu-firebase-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 48 48">
      <path fill="#ff8f00" d="M8,37L23.234,8.436c0.321-0.602,1.189-0.591,1.494,0.02L30,19L8,37z" />
      <path fill="#ffa000" d="M8,36.992l5.546-34.199c0.145-0.895,1.347-1.089,1.767-0.285L26,22.992L8,36.992z" />
      <path fill="#ff6f00" d="M8.008 36.986L8.208 36.829 25.737 22.488 20.793 13.012z" />
      <path
        fill="#ffc400"
        d="M8,37l26.666-25.713c0.559-0.539,1.492-0.221,1.606,0.547L40,37l-15,8.743 c-0.609,0.342-1.352,0.342-1.961,0L8,37z"
      />
    </svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-firebase`,
  packageId: "jitsucom/source-firebase",
  packageType: "airbyte",
  meta: {
    name: "Firebase",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuMongoDBSource: SourceType = {
  id: "jitsu-mongodb-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg"  height="100%" width="100%" viewBox="0 0 250 250" fill="none"><path fill="#599636" d="m117.749 1.095 6.672 12.469c1.499 2.301 3.124 4.338 5.038 6.235a174.408 174.408 0 0 1 15.656 17.615c11.304 14.77 18.929 31.173 24.374 48.913 3.265 10.837 5.039 21.954 5.171 33.195.547 33.606-11.03 62.463-34.373 86.445a99.078 99.078 0 0 1-12.265 10.432c-2.312 0-3.406-1.764-4.359-3.389a27.801 27.801 0 0 1-3.406-9.756c-.821-4.066-1.36-8.132-1.094-12.33v-1.896c-.187-.405-2.226-186.977-1.414-187.933Z"/><path fill="#6CAC48" d="M117.752.683c-.273-.545-.547-.133-.82.132.133 2.72-.821 5.146-2.313 7.463-1.64 2.3-3.812 4.065-5.992 5.962-12.108 10.433-21.64 23.034-29.272 37.128-10.156 18.968-15.39 39.297-16.874 60.698-.68 7.72 2.453 34.959 4.898 42.819 6.672 20.865 18.656 38.348 34.178 53.523 3.813 3.653 7.891 7.043 12.109 10.3 1.227 0 1.36-1.088 1.641-1.897a37 37 0 0 0 1.226-5.286l2.735-20.321L117.752.683Z"/><path fill="#C2BFBF" d="M124.421 224.655c.274-3.109 1.774-5.69 3.406-8.263-1.64-.677-2.859-2.022-3.812-3.522a25.096 25.096 0 0 1-2.031-4.47c-1.906-5.69-2.312-11.661-2.859-17.476v-3.521c-.68.544-.821 5.146-.821 5.83a134.294 134.294 0 0 1-2.453 18.292c-.406 2.441-.679 4.874-2.187 7.043 0 .272 0 .544.133.949 2.453 7.183 3.125 14.498 3.539 21.953v2.721c0 3.249-.133 2.565 2.578 3.654 1.093.404 2.312.544 3.406 1.352.82 0 .953-.676.953-1.22l-.406-4.47v-12.469c-.133-2.177.273-4.338.547-6.375l.007-.008Z"/></svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-mongodb`,
  packageId: "jitsucom/source-mongodb",
  packageType: "airbyte",
  sortIndex: -1000,
  meta: {
    name: "MongoDb (alternative version)",
    license: "MIT",
    connectorSubtype: "database",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuAttioSource: SourceType = {
  id: "jitsu-attio-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 2 30 30" fill="none"><path fill="black" d="m29.754 22.362-2.512-4.02s-.009-.017-.015-.024l-.198-.316a2.03 2.03 0 0 0-1.726-.96l-4.046-.014-.282.453-4.835 7.736-.267.428L17.9 28.88c.374.602 1.02.961 1.732.961h5.67c.699 0 1.36-.368 1.73-.959l.2-.32s.008-.008.01-.012l2.515-4.025a2.045 2.045 0 0 0 0-2.164h-.002Zm-.766 1.683-2.516 4.025c-.01.02-.024.034-.035.05a.34.34 0 0 1-.544-.05l-2.515-4.027a1.116 1.116 0 0 1-.13-.29 1.127 1.127 0 0 1 .127-.908l2.512-4.02.006-.01c.06-.09.135-.131.2-.144.026-.008.049-.01.067-.013h.028c.058 0 .202.018.292.164l2.511 4.02c.23.366.23.837 0 1.203h-.003ZM22.322 12.636a2.053 2.053 0 0 0 0-2.164l-2.512-4.02-.21-.338a2.031 2.031 0 0 0-1.732-.959h-5.67c-.707 0-1.354.36-1.731.96L.314 22.366a2.03 2.03 0 0 0-.002 2.162l2.723 4.359a2.026 2.026 0 0 0 1.73.959h5.67c.712 0 1.358-.36 1.732-.96l.208-.33v-.004l.003-.007 2.024-3.237 5.999-9.6 1.917-3.07.004-.001Zm-.593-1.082c0 .207-.058.416-.175.601l-9.946 15.918a.34.34 0 0 1-.291.16.342.342 0 0 1-.292-.16l-2.513-4.027a1.141 1.141 0 0 1 0-1.202l9.945-15.913a.339.339 0 0 1 .292-.163c.058 0 .202.017.293.164l2.512 4.02c.117.185.175.394.175.602Z"></path></svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-attio`,
  packageId: "jitsucom/source-attio",
  packageType: "airbyte",
  meta: {
    name: "Attio",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ExternalLinearSource: SourceType = {
  id: "external-linear-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100" fill="black" color="black"><path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"></path></svg>`,
  versions: [`latest`],
  packageId: "gcr.io/linear-public-registry/linear-airbyte-source",
  packageType: "airbyte",
  meta: {
    name: "Linear",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const jitsuSources: Record<string, SourceType> = {
  "jitsucom/source-firebase": JitsuFirebaseSource,
  "jitsucom/source-mongodb": JitsuMongoDBSource,
  "jitsucom/source-attio": JitsuAttioSource,
};

export const externalSources: Record<string, SourceType> = {
  "gcr.io/linear-public-registry/linear-airbyte-source": ExternalLinearSource,
};

export const popularConnectors: string[] = [
  "jitsucom/source-firebase",
  "airbyte/source-stripe",
  "airbyte/source-google-ads",
  "airbyte/source-facebook-marketing",
  "airbyte/source-github",
  "airbyte/source-google-analytics-data-api",
  "airbyte/source-postgres",
  "airbyte/source-mysql",
  "airbyte/source-google-sheets",
  "airbyte/source-airtable",
  "airbyte/source-intercom",
];

const sortIndexes = popularConnectors.reduce(
  (acc, connector, index) => ({
    ...acc,
    [connector]: (popularConnectors.length - index) * 10 + 100,
  }),
  {}
);

export default createRoute()
  .GET({ auth: false, query: z.object({ mode: z.enum(["meta", "icons-only", "full"]).optional().default("full") }) })
  .handler(async ({ query, req, res }): Promise<{ sources: Partial<SourceType>[] }> => {
    //set cors headers, allow access from all origins
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    const includeMeta = query.mode === "full" || query.mode == "meta";
    const includeIcons = query.mode === "full" || query.mode == "icons-only";
    console.log(JSON.stringify(sortIndexes, null, 2));
    const sources: Partial<SourceType>[] = (await db.prisma().connectorPackage.findMany())
      .filter(
        c =>
          !c.packageId.endsWith("-secure") &&
          !c.packageId.endsWith("source-e2e-test-cloud") &&
          !c.packageId.endsWith("source-e2e-test")
      )
      .map(({ id, logoSvg, packageId, meta, ...rest }) => ({
        id,
        packageId,
        logoSvg: includeIcons ? (logoSvg ? Buffer.from(logoSvg).toString() : undefined) : undefined,
        ...(includeMeta ? rest : {}),
        versions: includeMeta
          ? `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
              packageId
            )}`
          : undefined,
        meta: includeMeta
          ? pick(meta as any, [
              "name",
              "license",
              "mitVersions",
              "releaseStage",
              "dockerImageTag",
              "connectorSubtype",
              "dockerRepository",
            ])
          : undefined,
      }));
    return {
      sources: [
        ...Object.values({ ...jitsuSources, ...externalSources }).map(
          ({ id, packageId, versions, logoSvg, ...rest }) => ({
            id,
            packageId,
            logoSvg: includeIcons ? (logoSvg ? logoSvg.toString() : undefined) : undefined,
            ...(includeMeta ? rest : {}),
            versions: includeMeta ? versions : undefined,
            meta: includeMeta ? rest.meta : undefined,
          })
        ),
        ...sources,
      ]
        .map(s => ({ ...s, sortIndex: sortIndexes[s.packageId!] || s.sortIndex }))
        .sort((a, b) => {
          const res = (b.sortIndex || 0) - (a.sortIndex || 0);
          return res === 0 ? (a?.meta?.name || a?.packageId!).localeCompare(b?.meta?.name || b?.packageId!) : res;
        }),
    };
  })
  .toNextApiHandler();
