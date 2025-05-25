import { coreDestinationsMap } from "./destinations";
import { safeParseWithDate } from "../zod";
import { ApiError } from "../shared/errors";
import {
  ApiKey,
  ConfigObjectType,
  ConnectorImageConfig,
  DestinationConfig,
  FunctionConfig,
  MiscEntity,
  NotificationChannel,
  ServiceConfig,
  StreamConfig,
  WorkspaceDomain,
} from "./index";
import { assertDefined, createHash, requireDefined } from "juava";
import { checkDomain, checkOrAddToIngress, isDomainAvailable } from "../server/custom-domains";
import { ZodType, ZodTypeDef } from "zod";
import { getServerLog } from "../server/log";
import { getWildcardDomains } from "../../pages/api/[workspaceId]/domain-check";

const log = getServerLog("config-objects");

function hashKeys(newKeys: ApiKey[], oldKeys: ApiKey[]): ApiKey[] {
  const oldKeysIndex = Object.values(oldKeys).reduce((acc, key) => ({ ...acc, [key.id]: key }), {});
  return newKeys.map(k => ({
    id: k.id,
    hint: k.hint,
    hash: k.hash
      ? k.hash
      : k.plaintext
      ? createHash(k.plaintext)
      : requireDefined(oldKeysIndex[k.id], `Key with id ${k.id} should either be known, or hash a plaintext value`)
          .hash,
  }));
}

export function parseObject(type: string, obj: any): any {
  const configType = getConfigObjectType(type);
  assertDefined(configType, `Unknown config object type ${type}`);
  const parseResult = safeParseWithDate(configType.schema, obj);
  if (!parseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, { object: obj, error: parseResult.error });
  }
  const topLevelObject = parseResult.data;
  //we're parsing same object twice here, but it's not a big deal
  const narrowParseResult = configType.narrowSchema(topLevelObject, configType.schema).safeParse(obj);
  if (!narrowParseResult.success) {
    throw new ApiError(`Failed to validate schema of ${type}`, { object: obj, error: narrowParseResult.error });
  }
  return narrowParseResult.data;
}

export type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends { [K2 in keyof T]: K2 }[K] ? K : never;
}[keyof T];

export const getAllConfigObjectTypeNames = (): string[] => {
  return Object.keys(configObjectTypes);
};

export const getConfigObjectType: (type: string) => Required<ConfigObjectType> = type => {
  const configType = configObjectTypes[type];
  assertDefined(configType, `Unknown config object type ${type}`);
  //This crazy type really means "give me all optional properties, for which we need provide a default values"
  const defaults: Required<Pick<ConfigObjectType, OptionalKeys<ConfigObjectType>>> = {
    narrowSchema: function (obj, originalSchema): ZodType<any, ZodTypeDef, any> {
      return originalSchema;
    },
    inputFilter: async function (val: any) {
      return val;
    },
    merge: function (original: any, patch: Partial<any>) {
      return { ...original, ...patch };
    },
    outputFilter: function (original: any) {
      return original;
    },
  };

  return { ...defaults, ...configType };
};

const configObjectTypes: Record<string, ConfigObjectType> = {
  destination: {
    schema: DestinationConfig,
    outputFilter: (obj: DestinationConfig) => {
      const newObject = { ...obj };
      if (newObject.provisioned) {
        delete (newObject as any).credentials;
      }
      return newObject;
    },
    merge(original: DestinationConfig, patch: Partial<DestinationConfig>): any {
      if (patch.provisioned) {
        throw new ApiError(`Can't set destination to provisioned destination through API (${original.id})`);
      }
      return { ...original, ...patch };
    },

    inputFilter: async (obj: DestinationConfig, context) => {
      if (context === "create" && obj.provisioned) {
        throw new ApiError(`Can't create provisioned destination through API (${obj.id})`);
      }
      return obj;
    },
    narrowSchema: obj => {
      const type = obj.destinationType;
      const destinationType = coreDestinationsMap[type];
      assertDefined(destinationType, `Unknown destination type ${type}`);
      return DestinationConfig.merge(destinationType.credentials);
    },
  },
  stream: {
    schema: StreamConfig,
    merge(original: any, patch: Partial<any>): any {
      const merged = {
        ...original,
        ...patch,
        privateKeys: patch.privateKeys
          ? hashKeys(patch.privateKeys, original.privateKeys || [])
          : original.privateKeys || [],
        publicKeys: patch.publicKeys
          ? hashKeys(patch.publicKeys, original.publicKeys || [])
          : original.publicKeys || [],
      };
      // TODO: dirty workaround for not be able to clear authorizedJavaScriptDomains
      if (!patch.authorizedJavaScriptDomains) {
        delete merged.authorizedJavaScriptDomains;
      }
      return merged;
    },

    inputFilter: async (obj, _, workspace) => {
      const workspaceId = workspace.id;
      outer: for (const domain of obj.domains || []) {
        const domainToCheck = domain.trim().toLowerCase();
        if (!checkDomain(domainToCheck)) {
          log.atWarn().log(`Domain '${domainToCheck}' is not a valid domain name`);
          throw new ApiError(`Domain ${domainToCheck} is not a valid domain name`);
        }
        const domainAvailability = await isDomainAvailable(domainToCheck, workspace);
        if (!domainAvailability.available) {
          log
            .atWarn()
            .log(
              `Domain ${domainToCheck} can't be added to workspace ${workspaceId}, it is already in use by other workspaces: ${domainAvailability.usedInWorkspace}`
            );
          throw new ApiError(`Domain ${domainToCheck} is already in use by other workspace`);
        }
        const wildcardDomains = await getWildcardDomains(workspaceId);
        for (const wildcardDomain of wildcardDomains) {
          if (domainToCheck.endsWith(wildcardDomain.toLowerCase().replace("*", ""))) {
            log
              .atInfo()
              .log(
                `No need to check ingress status for ${domainToCheck} since it is under wildcard domain: ${wildcardDomain}`
              );
            continue outer;
          }
        }
        try {
          const ingressStatus = await checkOrAddToIngress(domainToCheck);
          log.atInfo().log(`Ingress status for ${domainToCheck}: ${JSON.stringify(ingressStatus)}`);
          if (!ingressStatus) {
            log.atWarn().log(`Incorrect ingress status ${domainToCheck} is not valid`);
          }
        } catch (e) {
          log.atError().withCause(e).log(`Error checking ingress status for ${domainToCheck}`);
        }
      }
      return {
        ...obj,
        domains: obj.domains?.map(d => d.trim().toLowerCase()) || [],
        privateKeys: hashKeys(obj.privateKeys || [], []),
        publicKeys: hashKeys(obj.publicKeys || [], []),
      };
    },
    outputFilter: (original: StreamConfig) => {
      return {
        ...original,
        domains: original.domains?.map(d => d.trim().toLowerCase()),
        privateKeys: (original.privateKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
        publicKeys: (original.publicKeys || []).map(k => ({ ...k, plaintext: undefined, hash: undefined })),
      };
    },
  },
  function: {
    schema: FunctionConfig,
  },
  service: {
    schema: ServiceConfig,
  },
  "custom-image": {
    schema: ConnectorImageConfig,
  },
  domain: {
    schema: WorkspaceDomain,
    inputFilter: async obj => {
      const domainToCheck = obj.name.trim().toLowerCase();
      if (!checkDomain(domainToCheck)) {
        log.atWarn().log(`Domain '${domainToCheck}' is not a valid domain name`);
        throw new ApiError(`Domain ${domainToCheck} is not a valid domain name`);
      }
      return {
        ...obj,
        name: domainToCheck,
      };
    },
    outputFilter: (original: WorkspaceDomain) => {
      return {
        ...original,
        name: original.name.trim().toLowerCase(),
      };
    },
  },
  misc: {
    schema: MiscEntity,
  },
  notification: {
    schema: NotificationChannel,
  },
} as const;
