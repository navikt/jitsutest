import { z } from "zod";
import { UserProfileDbModel, WorkspaceDbModel } from "../../prisma/schema";

export const SessionUser = z.object({
  name: z.string(),
  email: z.string(),
  image: z.string().nullish(),
  loginProvider: z.string(),
  externalId: z.string(),
  internalId: z.string(),
  externalUsername: z.string().nullish(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const ContextApiResponse = z.object({
  user: SessionUser,
  firstWorkspaceId: z.string().nullish().optional(),
  firstWorkspaceSlug: z.string().nullish().optional(),
  newUser: z.boolean().optional(),
});
export type ContextApiResponse = z.infer<typeof ContextApiResponse>;

//Default values are for "free" (default) plan
export const BillingSettings = z.object({
  planId: z.string().default("free"),
  //if plan has a custom pricing prepared for a particular workspace
  customBilling: z.boolean().default(false).optional(),
  pastDue: z.boolean().default(false).optional(),
  dailyActiveSyncs: z.number().default(1).optional(),
  dailyActiveSyncsOverage: z.number().default(20).optional(),
  maximumSyncFrequency: z.number().optional(), //minutes
  planName: z.string().optional(), //if not set - will be taken from planId
  overagePricePer100k: z.number().optional(),
  canShowProvisionDbCredentials: z.boolean().default(false),
  dataRetentionEditorEnabled: z.boolean().default(false).optional(),
  destinationEvensPerMonth: z.number().default(200_000),
  expiresAt: z.string().optional(),
  /**
   * Subscription period. For monthly subscriptions it will be [expiresAt - 1 month, expiresAt]. For annual subscriptions - current
   * month adjusted to a correct billing start date
   */
  currentPeriod: z
    .object({
      end: z.string(),
      start: z.string(),
    })
    .optional(),
  renewAfterExpiration: z.boolean().default(false).optional(),
  //if subscription starts some time in the future, for enterprise plans only
  futureSubscriptionDate: z.string().optional(),
  profileBuilderEnabled: z.boolean().default(false).optional(),
  isLegacyPlan: z.boolean().default(false).optional(),
});

export type BillingSettings = z.infer<typeof BillingSettings>;

export const noRestrictions: BillingSettings = {
  planId: "$admin",
  overagePricePer100k: undefined,
  canShowProvisionDbCredentials: true,
  maximumSyncFrequency: 0,
  dailyActiveSyncs: 100,
  dailyActiveSyncsOverage: 100,
  destinationEvensPerMonth: 100_000_000_000,
  profileBuilderEnabled: true,
};

export const AppConfig = z.object({
  docsUrl: z.string().optional(),
  websiteUrl: z.string().optional(),
  //iso date
  readOnlyUntil: z.string().optional(),
  disableSignup: z.boolean().optional(),
  customDomainsEnabled: z.boolean().optional(),
  ee: z.object({
    available: z.boolean(),
    host: z.string().optional(),
  }),
  billingEnabled: z.boolean(),
  jitsuClassicUrl: z.string(),
  publicEndpoints: z.object({
    protocol: z.enum(["http", "https"]),
    host: z.string(),
    dataHost: z.string().optional(),
    ingestUrl: z.string().optional(),
    cname: z.string().optional(),
    //if differs from standard protocol port - 80 or 443
    port: z.number().optional(),
  }),
  auth: z
    .object({
      firebasePublic: z.any(),
    })
    .optional(),
  frontendTelemetry: z.object({
    enabled: z.boolean(),
    host: z.string().optional(),
  }),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  syncs: z.object({
    enabled: z.boolean(),
    scheduler: z.object({
      enabled: z.boolean(),
      provider: z.enum(["google-cloud-scheduler"]).optional(),
    }),
  }),
  mitCompliant: z.boolean().optional(),
  nango: z
    .object({
      publicKey: z.string(),
      host: z.string(),
    })
    .optional(),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const ConfigEntityBase = z.object({
  id: z.string(),
  type: z.string(),
  workspaceId: z.string(),
  name: z.string(),
});
export type ConfigEntityBase = z.infer<typeof ConfigEntityBase>;

export const ApiKey = z.object({
  plaintext: z.string().nullish(),
  hash: z.string().nullish(),
  hint: z.string().nullish(),
  createdAt: z.coerce.date().nullish(),
  lastUsed: z.coerce.date().nullish(),
  id: z.string(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const StreamConfig = ConfigEntityBase.merge(
  z.object({
    domains: z.array(z.string()).optional(),
    authorizedJavaScriptDomains: z.string().optional(),
    publicKeys: z.array(ApiKey).optional(),
    privateKeys: z.array(ApiKey).optional(),
    strict: z.boolean().optional(),
  })
);
export type StreamConfig = z.infer<typeof StreamConfig>;

export const DestinationConfig = ConfigEntityBase.merge(
  z
    .object({
      destinationType: z.string(),
      provisioned: z.boolean().optional(),
      testConnectionError: z.string().optional(),
    })
    .passthrough()
);
export type DestinationConfig = z.infer<typeof DestinationConfig>;

export const FunctionConfig = ConfigEntityBase.merge(
  z.object({
    code: z.string(),
    draft: z.string().optional(),
    kind: z.enum(["profile", "event"]).optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    origin: z.string().optional(),
    slug: z.string().optional(),
  })
);
export type FunctionConfig = z.infer<typeof FunctionConfig>;

export const ServiceConfig = ConfigEntityBase.merge(
  z.object({
    protocol: z.enum(["airbyte"]).default("airbyte"),
    authorized: z.boolean().optional(),
    package: z.string(),
    version: z.string(),
    credentials: z.object({}).passthrough(),
    testConnectionError: z.string().optional(),
  })
);
export type ServiceConfig = z.infer<typeof ServiceConfig>;

export const ConnectorImageConfig = ConfigEntityBase.merge(
  z.object({
    package: z.string(),
    version: z.string(),
  })
);
export type ConnectorImageConfig = z.infer<typeof ConnectorImageConfig>;

export const WorkspaceDomain = ConfigEntityBase.merge(z.object({}));
export type WorkspaceDomain = z.infer<typeof WorkspaceDomain>;

export const MiscEntity = ConfigEntityBase.merge(
  z.object({
    objectType: z.enum(["classic-mapping"]).default("classic-mapping"),
    value: z.string(),
  })
);
export type MiscEntity = z.infer<typeof MiscEntity>;

export const NotificationChannel = ConfigEntityBase.merge(
  z.object({
    events: z.array(z.enum(["all", "sync", "batch"])).default(["all"]),
    channel: z.enum(["email", "slack"]).default("slack"),
    slackWebhookUrl: z.string().optional(),
    // allWorkspaceEmails: z.boolean().default(true).optional(),
    emails: z.array(z.string()).optional(),
    recurringAlertsPeriodHours: z.number().max(720).min(0).default(24),
  })
);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * What happens to an object before it is saved to DB.
 *
 * opts.original — original of the object, if object is being updated
 * opts.patch — patch of the object, if object is being updated. Or full object, if object is being created
 */
export type InputFilter<T = any> = (
  val: T,
  context: "create" | "update",
  workspace: z.infer<typeof WorkspaceDbModel>
) => Promise<T>;
export type OutputFilter<T = any> = (original: T) => T;

/**
 * To validate object. Could use external async services (like DB) to validate.
 * Should throw error if validation failed.
 */
export type Validator<T> = (value: T) => Promise<void>;

export type ConfigObjectType<T = any> = {
  schema: z.ZodSchema<T>;
  narrowSchema?: (obj: any, originalSchema: z.ZodSchema<T>) => z.ZodSchema<T>;

  /**
   * Applied to input object before saving to DB.
   * There's a place where to apply validation, and throw error if validation failed.
   */
  inputFilter?: InputFilter<T>;
  /**
   * Custom merge logic. By default, it's just shallow merge - {...original, ...patch}.
   */
  merge?: (original: T, patch: Partial<T>) => T;

  /**
   * Clean object before sending to client. Can remove fields, hide values etc
   */
  outputFilter?: OutputFilter<T>;
};

const SafeUserProfile = UserProfileDbModel.pick({
  id: true,
  name: true,
  loginProvider: true,
  externalId: true,
  externalUsername: true,
  email: true,
});

export type SafeUserProfile = z.infer<typeof SafeUserProfile>;

export const UserWorkspaceRelation = z.object({
  workspaceId: z.string(),
  user: SafeUserProfile.optional(),
  invitationLink: z.string().optional(),
  invitationEmail: z.string().optional(),
  canSendEmail: z.boolean().optional(),
});

export type UserWorkspaceRelation = z.infer<typeof UserWorkspaceRelation>;

export const BaseLinkType = z.object({ fromId: z.string(), toId: z.string() });

export const SelectedStreamSettings = z.object({
  sync_mode: z.enum(["full_refresh", "incremental"]),
  table_name: z.string().optional(),
  cursor_field: z.array(z.string()).optional(),
});

export type SelectedStreamSettings = z.infer<typeof SelectedStreamSettings>;

export const SyncOptionsType = z.object({
  streams: z.record(SelectedStreamSettings),
  namespace: z.string().optional(),
  tableNamePrefix: z.string().optional(),
  toSameCase: z.boolean().optional(),
  addMeta: z.boolean().optional(),
  functionsEnv: z.any().optional(),
  schedule: z.union([z.string(), z.enum(["0 0 * * *", "0 * * * *", "*/15 * * * *", "*/5 * * * *", "* * * * *"])]),
  timezone: z.string().optional(),
});

export type SyncOptionsType = z.infer<typeof SyncOptionsType>;
