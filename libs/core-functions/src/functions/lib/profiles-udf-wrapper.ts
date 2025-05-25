import { getLog, LogLevel, parseNumber, sanitize, stopwatch } from "juava";
import { Isolate, ExternalCopy, Reference, Module, Context } from "isolated-vm";
import { FetchOpts, Store, TTLStore } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

import { EventsStore, FunctionChainContext, FunctionContext, makeFetch, makeLog } from "./index";
import { cryptoCode } from "./crypto-code";
import { RetryError } from "@jitsu/functions-lib";
import { clearTimeout } from "node:timers";
import * as crypto from "node:crypto";
import { ProfileResult } from "@jitsu/protocols/profile";
import { chainWrapperCode, functionsLibCode } from "./profiles-udf-wrapper-code";
import { logType } from "./udf_wrapper";
import { createMemoryStore, memoryStoreDump } from "./store";
import { warehouseQuery } from "./warehouse-store";
import { EntityStore } from "../../lib/entity-store";
import { EnrichedConnectionConfig } from "../../lib/config-types";

const log = getLog("udf-wrapper");

export type ProfileUser = {
  profileId: string;
  userId: string;
  anonymousId: string;
  traits: Record<string, any>;
};

export type ProfileUserProvider = () => Promise<ProfileUser>;
export type EventsProvider = () => Promise<AnalyticsServerEvent | undefined>;

export type Profile = {
  profile_id: string;
  destination_id?: string;
  table_name?: string;
  traits: Record<string, any>;
  version?: number;
  updated_at: Date;
};

export type ProfileFunctionWrapper = (
  eventsProvider: EventsProvider,
  userProvider: ProfileUserProvider,
  context: FunctionContext
) => Promise<ProfileResult | undefined>;

type UDFWrapperResult = {
  userFunction: ProfileFunctionWrapper;
  isDisposed: () => boolean;
  close: () => void;
};

type UDFFunction = {
  id: string;
  name: string;
  code: string;
};

export const ProfileUDFWrapper = (
  id: string,
  version: number,
  fullId: string,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  functions: UDFFunction[]
): UDFWrapperResult => {
  log.atDebug().log(`[CON:${fullId}] Compiling ${functions.length} UDF functions`);
  const sw = stopwatch();
  let isolate: Isolate;
  let context: Context;
  let refs: Reference[] = [];
  try {
    isolate = new Isolate({ memoryLimit: 512 });
    context = isolate.createContextSync();
    const jail = context.global;

    // This make the global object available in the context as 'global'. We use 'derefInto()' here
    // because otherwise 'global' would actually be a Reference{} object in the new isolate.
    jail.setSync("global", jail.derefInto());
    jail.setSync(
      "process",
      new ExternalCopy({ env: funcCtx.props || {} }).copyInto({ release: true, transferIn: true })
    );

    jail.setSync("_jitsu_pbId", id);
    jail.setSync("_jitsu_pbVersion", version);
    jail.setSync("_jitsu_funcCtx", new ExternalCopy(funcCtx).copyInto({ release: true, transferIn: true }));
    jail.setSync(
      "_jitsu_log",
      new ExternalCopy({
        info: makeReference(refs, chainCtx.log.info),
        warn: makeReference(refs, chainCtx.log.warn),
        debug: makeReference(refs, chainCtx.log.debug),
        error: makeReference(refs, chainCtx.log.error),
      }).copyInto({ release: true, transferIn: true })
    );
    jail.setSync("_jitsu_fetch_log_level", chainCtx.connectionOptions?.fetchLogLevel || "info");
    jail.setSync(
      "_jitsu_crypto",
      makeReference(refs, {
        hash: crypto["hash"],
        randomUUID: crypto.randomUUID,
        randomBytes: crypto.randomBytes,
        randomInt: crypto.randomInt,
      })
    );
    jail.setSync("require", () => {
      throw new Error("'require' is not supported. Please use 'import' instead");
    });
    jail.setSync("_jitsu_query", makeReference(refs, chainCtx.query));
    jail.setSync(
      "_jitsu_fetch",
      makeReference(refs, async (url: string, opts?: FetchOpts, extra?: any) => {
        const res = await chainCtx.fetch(url, opts, extra);
        const headers: any = {};
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const text = await res.text();
        const j = {
          status: res.status,
          statusText: res.statusText,
          type: res.type,
          redirected: res.redirected,
          body: text,
          bodyUsed: true,
          url: res.url,
          ok: res.ok,
          headers: headers,
        };
        return JSON.stringify(j);
      })
    );
    jail.setSync(
      "_jitsu_store",
      new ExternalCopy({
        get: makeReference(refs, async (key: string) => {
          const res = await chainCtx.store.get(key);
          return JSON.stringify(res);
        }),
        set: makeReference(refs, chainCtx.store.set),
        del: makeReference(refs, chainCtx.store.del),
        ttl: makeReference(refs, async (key: string) => {
          return await chainCtx.store.ttl(key);
        }),
      }).copyInto({ release: true, transferIn: true })
    );

    const functionsLib = isolate.compileModuleSync(functionsLibCode, {
      filename: "functions-lib.js",
    });
    functionsLib.instantiateSync(context, (specifier: string): Module => {
      throw new Error(`import is not allowed: ${specifier}`);
    });
    const cryptoLib = isolate.compileModuleSync(cryptoCode, {
      filename: "crypto.js",
    });
    cryptoLib.instantiateSync(context, (specifier: string): Module => {
      throw new Error(`import is not allowed: ${specifier}`);
    });
    const udfModules: Record<string, Module> = {};
    for (let i = 0; i < functions.length; i++) {
      const sw = stopwatch();
      const f = functions[i];
      log.atDebug().log(`[CON:${fullId}]: [f:${f.id}] Compiling UDF function '${f.name}'`);
      const moduleName = "f_" + sanitize(f.name, "_") + "_" + f.id;
      const udf = isolate.compileModuleSync(f.code, { filename: moduleName + ".js" });
      udf.instantiateSync(context, (specifier: string) => {
        if (specifier === "@jitsu/functions-lib") {
          return functionsLib;
        } else if (specifier === "crypto") {
          return cryptoLib;
        }
        throw new Error(`import is not allowed: ${specifier}`);
      });
      udfModules[moduleName] = udf;
      log.atDebug().log(`[CON:${fullId}] [f:${f.id}] UDF function '${f.name}' compiled in ${sw.elapsedPretty()}`);
    }

    let code = chainWrapperCode.replace(
      "//** @UDF_FUNCTIONS_IMPORT **//",
      Object.keys(udfModules)
        .map(m => `import * as ${m} from "${m}";\n`)
        .join("")
    );
    code = code.replace(
      "//** @UDF_FUNCTIONS_CHAIN **//",
      "chain = [" +
        Object.keys(udfModules)
          .map(m => {
            const id = m.split("_").pop();
            return `{id: "${id}", meta: ${m}.config, f: wrappedUserFunction("${id}", ${m}.default, { props: _jitsu_funcCtx.props, function:{ ..._jitsu_funcCtx.function, id: "${id}"}})}`;
          })
          .join(",") +
        "];"
    );

    const wrapper = isolate.compileModuleSync(code, {
      filename: "jitsu-wrapper.js",
    });
    wrapper.instantiateSync(context, (specifier: string) => {
      const udf = udfModules[specifier];
      if (udf) {
        //log.atInfo().log(`[${connectionId}] UDF function '${specifier}' is imported`);
        return udf;
      }
      if (specifier === "@jitsu/functions-lib") {
        return functionsLib;
      }
      throw new Error(`import is not allowed: ${specifier}`);
    });
    wrapper.evaluateSync();
    const wrapperFunc = wrap(fullId, isolate, context, wrapper, refs);
    log.atInfo().log(`[CON:${fullId}] ${functions.length} UDF functions compiled in: ${sw.elapsedPretty()}`);
    return wrapperFunc;
  } catch (e) {
    return {
      userFunction: (): Promise<ProfileResult> => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      isDisposed: () => {
        return false;
      },
      close: () => {
        try {
          if (isolate) {
            for (const r of refs) {
              r.release();
            }
            context.release();
            if (!isolate.isDisposed) {
              isolate.dispose();
            }
            log.atDebug().log(`[${fullId}] isolate closed`);
          }
        } catch (e) {
          log.atError().log(`[${fullId}] Error while closing isolate: ${e}`);
        }
      },
    };
  }
};

function wrap(connectionId: string, isolate: Isolate, context: Context, wrapper: Module, refs: Reference[]) {
  const exported = wrapper.namespace;

  const ref = exported.getSync("wrappedFunctionChain", {
    reference: true,
  });
  if (!ref || ref.typeof !== "function") {
    throw new Error("Function not found. Please export wrappedFunctionChain function.");
  }
  const userFunction: ProfileFunctionWrapper = async (
    eventsProvider,
    userProvider,
    ctx
  ): Promise<ProfileResult | undefined> => {
    if (isolate.isDisposed) {
      throw new RetryError("Isolate is disposed", { drop: true });
    }
    const ctxCopy = new ExternalCopy(ctx);

    const udfTimeoutMs = parseNumber(process.env.UDF_TIMEOUT_MS, 60000);
    let isTimeout = false;
    const timer = setTimeout(() => {
      isTimeout = true;
      isolate.dispose();
    }, udfTimeoutMs);
    const eventsProviderRef = new Reference(async () => {
      const ev = await eventsProvider();
      if (typeof ev !== "undefined") {
        return JSON.stringify(ev);
      } else {
        return undefined;
      }
    });
    const userProviderRef = new Reference(async () => {
      return JSON.stringify(await userProvider());
    });

    try {
      const res = await ref.apply(
        undefined,
        [eventsProviderRef, userProviderRef, ctxCopy.copyInto({ release: true, transferIn: true })],
        {
          result: { promise: true, copy: true },
        }
      );
      switch (typeof res) {
        case "undefined":
        case "string":
        case "number":
        case "boolean":
          return undefined;
        default:
          return res as any;
      }
    } catch (e: any) {
      if (isolate.isDisposed) {
        if (isTimeout) {
          throw new RetryError(
            `[${connectionId}] Function execution took longer than ${udfTimeoutMs}ms. Isolate is disposed`,
            {
              drop: true,
            }
          );
        } else {
          throw new RetryError(
            `[${connectionId}] Function execution stopped probably due to high memory usage. Isolate is disposed.`,
            {
              drop: true,
            }
          );
        }
      }
      const m = e.message;
      if (m.startsWith("{")) {
        throw JSON.parse(m);
      }
      //log.atInfo().log(`ERROR name: ${e.name} message: ${e.message} json: ${e.stack}`);
      throw e;
    } finally {
      eventsProviderRef.release();
      userProviderRef.release();
      clearTimeout(timer);
    }
  };
  return {
    userFunction,
    isDisposed: () => {
      if (isolate) {
        return isolate.isDisposed;
      }
      return true;
    },
    close: () => {
      try {
        if (isolate) {
          for (const r of refs) {
            r.release();
          }
          context.release();
          if (!isolate.isDisposed) {
            isolate.dispose();
          }
          log.atDebug().log(`[${connectionId}] isolate closed.`);
        }
      } catch (e) {
        log.atError().log(`[${connectionId}] Error while closing isolate: ${e}`);
      }
    },
  };
}

function makeReference(refs: Reference[], obj: any): Reference {
  const ref = new Reference(obj);
  refs.push(ref);
  return ref;
}

export async function mergeUserTraits(events: AnalyticsServerEvent[], userId?: string): Promise<ProfileUser> {
  const user = { traits: {}, profileId: events[0]?._profile_id, userId: userId || events[0]?.userId } as ProfileUser;
  for await (const e of events) {
    if (e.type === "identify") {
      if (e.anonymousId) {
        user.anonymousId = e.anonymousId;
      }
      if (e.traits) {
        Object.assign(user.traits, e.traits);
      }
    }
  }
  return user;
}

export type ProfileUDFTestRequest = {
  id: string;
  name: string;
  version: number;
  code: string | UDFWrapperResult;
  events: AnalyticsServerEvent[];
  settings: {
    variables: any;
    destinationId: string;
    tableName?: string;
    [key: string]: any;
  };
  store: Store | any;
  workspaceId: string;
  userAgent?: string;
};

export type ProfileUDFTestResponse = {
  error?: {
    message: string;
    stack?: string;
    name: string;
    retryPolicy?: any;
  };
  result: Profile;
  store: any;
  logs: logType[];
};

export async function ProfileUDFTestRun(
  { id, name, version, code, store, events, settings, userAgent, workspaceId }: ProfileUDFTestRequest,
  connStore?: EntityStore<EnrichedConnectionConfig>
): Promise<ProfileUDFTestResponse> {
  const logs: logType[] = [];
  const { variables, tableName, destinationId } = settings;
  let wrapper: UDFWrapperResult | undefined = undefined;
  let realStore = false;
  const user = await mergeUserTraits(events);
  const userProvider = async () => user;
  const iter = events[Symbol.iterator]();
  const eventsProvider = async () => {
    const iv = iter.next();
    if (!iv.done) {
      return iv.value;
    } else {
      return undefined;
    }
  };
  try {
    let storeImpl: TTLStore;
    if (
      typeof store?.set === "function" &&
      typeof store?.get === "function" &&
      typeof store?.del === "function" &&
      typeof store.ttl === "function"
    ) {
      storeImpl = store;
      realStore = true;
    } else {
      store = store || {};
      storeImpl = createMemoryStore(store);
    }

    const eventsStore: EventsStore = {
      log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
        switch (msg.type) {
          case "log-info":
          case "log-warn":
          case "log-debug":
          case "log-error":
            logs.push({
              message:
                msg.message?.text +
                (Array.isArray(msg.message?.args) && msg.message.args.length > 0
                  ? `, ${msg.message?.args.join(",")}`
                  : ""),
              level: msg.type.replace("log-", ""),
              timestamp: new Date(),
              type: "log",
            });
            break;
          case "http-request":
            let statusText;
            if (msg.error) {
              statusText = `${msg.error}`;
            } else {
              statusText = `${msg.statusText ?? ""}${msg.status ? `(${msg.status})` : ""}`;
            }
            logs.push({
              message: `${msg.method} ${msg.url} :: ${statusText}`,
              level: msg.error ? "error" : "debug",
              timestamp: new Date(),
              type: "http",
              data: {
                body: msg.body,
                headers: msg.headers,
                response: msg.response,
              },
            });
        }
      },
      close() {},
    };
    const chainCtx: FunctionChainContext = {
      store: storeImpl,
      query: async (conId: string, query: string, params: any) => {
        if (connStore) {
          return warehouseQuery(workspaceId, connStore, conId, query, params);
        } else {
          throw new Error("Connection store is not provided");
        }
      },
      fetch: makeFetch("functionsDebugger", eventsStore, "info"),
      log: makeLog("functionsDebugger", eventsStore),
    };
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const funcCtx: FunctionContext = {
      function: {
        type: "profile",
        id: id,
        debugTill: d,
      },
      props: variables,
    };
    if (typeof code === "string") {
      wrapper = ProfileUDFWrapper(id, version, id, chainCtx, funcCtx, [{ id, name, code }]);
    } else {
      wrapper = code;
    }
    const result = await wrapper?.userFunction(eventsProvider, userProvider, funcCtx);
    const profile = {
      profile_id: result?.profileId || result?.["profile_id"] || user.profileId || user.userId,
      destination_id: result?.destinationId || result?.["destination_id"] || destinationId,
      table_name: result?.tableName || result?.["table_name"] || tableName || "profiles",
      traits: { ...user.traits, ...result?.traits },
      version: version,
      updated_at: new Date(),
    };
    return {
      result: profile,
      store: !realStore ? memoryStoreDump(store) : {},
      logs,
    };
  } catch (e: any) {
    return {
      error: {
        message: e.message,
        stack: e.stack,
        name: e.name,
        retryPolicy: e.retryPolicy,
      },
      result: {
        profile_id: user.profileId || user.userId,
        destination_id: destinationId,
        table_name: tableName,
        traits: {},
        updated_at: new Date(),
      },
      store: !realStore && store ? memoryStoreDump(store) : {},
      logs,
    };
  } finally {
    wrapper?.close();
  }
}
