import { getLog, LogLevel, parseNumber, sanitize, stopwatch } from "juava";
import { Context, ExternalCopy, Isolate, Module, Reference } from "isolated-vm";
import { EventContext, FetchOpts, FuncReturn, Store, TTLStore } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

import {
  createMemoryStore,
  EnrichedConnectionConfig,
  EntityStore,
  EventsStore,
  FunctionChainContext,
  FunctionContext,
  isDropResult,
  makeFetch,
  makeLog,
  memoryStoreDump,
  warehouseQuery,
} from "../../index";
import { chainWrapperCode, functionsLibCode } from "./udf-wrapper-code";
import { parseUserAgent } from "./ua";
import { RetryError } from "@jitsu/functions-lib";
import { JitsuFunctionWrapper } from "./index";
import { clearTimeout } from "node:timers";
import * as crypto from "node:crypto";
import { cryptoCode } from "./crypto-code";

const log = getLog("udf-wrapper");

export type logType = {
  message: string;
  level: string;
  timestamp: Date;
  type: string;
  data?: any;
};

export type UDFWrapperResult = {
  userFunction: JitsuFunctionWrapper;
  isDisposed: () => boolean;
  close: () => void;
};

export type UDFFunction = {
  id: string;
  name: string;
  code: string;
};

export const UDFWrapper = (
  connectionId: string,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  functions: UDFFunction[]
): UDFWrapperResult => {
  log.atDebug().log(`[CON:${connectionId}] Compiling ${functions.length} UDF functions`);
  const sw = stopwatch();
  let isolate: Isolate;
  let context: Context;
  let refs: Reference[] = [];
  try {
    isolate = new Isolate({ memoryLimit: 128 });
    context = isolate.createContextSync();
    const jail = context.global;

    // This make the global object available in the context as 'global'. We use 'derefInto()' here
    // because otherwise 'global' would actually be a Reference{} object in the new isolate.
    jail.setSync("global", jail.derefInto());
    jail.setSync(
      "process",
      new ExternalCopy({ env: funcCtx.props || {} }).copyInto({ release: true, transferIn: true })
    );

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
      log.atDebug().log(`[CON:${connectionId}]: [f:${f.id}] Compiling UDF function '${f.name}'`);
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
      log.atDebug().log(`[CON:${connectionId}] [f:${f.id}] UDF function '${f.name}' compiled in ${sw.elapsedPretty()}`);
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
    const wrapperFunc = wrap(connectionId, isolate, context, wrapper, refs);
    log.atInfo().log(`[CON:${connectionId}] ${functions.length} UDF functions compiled in: ${sw.elapsedPretty()}`);
    return wrapperFunc;
  } catch (e) {
    return {
      userFunction: (): FuncReturn => {
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
            log.atDebug().log(`[${connectionId}] isolate closed`);
          }
        } catch (e) {
          log.atError().log(`[${connectionId}] Error while closing isolate: ${e}`);
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
  const userFunction: JitsuFunctionWrapper = async (event, ctx) => {
    if (isolate.isDisposed) {
      throw new RetryError("Isolate is disposed", { drop: true });
    }
    const eventCopy = new ExternalCopy(event);
    const ctxCopy = new ExternalCopy(ctx);
    const udfTimeoutMs = parseNumber(process.env.UDF_TIMEOUT_MS, 5000);
    let isTimeout = false;
    const timer = setTimeout(() => {
      isTimeout = true;
      isolate.dispose();
    }, udfTimeoutMs);
    try {
      const res = await ref.apply(
        undefined,
        [
          eventCopy.copyInto({ release: true, transferIn: true }),
          ctxCopy.copyInto({ release: true, transferIn: true }),
        ],
        {
          result: { promise: true, copy: true },
        }
      );
      switch (typeof res) {
        case "undefined":
          return undefined;
        case "string":
        case "number":
        case "boolean":
          return res;
        default:
          return res;
      }
    } catch (e: any) {
      //console.error(e);
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

export type UDFTestRequest = {
  functionId: string;
  functionName: string;
  code: string | UDFWrapperResult;
  event: AnalyticsServerEvent;
  variables: any;
  store: Store | any;
  workspaceId: string;
  userAgent?: string;
};

export type UDFTestResponse = {
  error?: {
    message: string;
    stack?: string;
    name: string;
    retryPolicy?: any;
  };
  dropped?: boolean;
  result: FuncReturn;
  store: any;
  logs: logType[];
};

export async function UDFTestRun(
  { functionId: id, functionName: name, code, store, event, variables, userAgent, workspaceId }: UDFTestRequest,
  connStore?: EntityStore<EnrichedConnectionConfig>
): Promise<UDFTestResponse> {
  const logs: logType[] = [];
  let wrapper: UDFWrapperResult | undefined = undefined;
  let realStore = false;
  try {
    const eventContext: EventContext = {
      receivedAt: new Date(),
      geo: {
        country: {
          code: "US",
          name: "United States",
          isEU: false,
        },
        city: {
          name: "New York",
        },
        region: {
          code: "NY",
          name: "New York",
        },
        location: {
          latitude: 40.6808,
          longitude: -73.9701,
        },
        postalCode: {
          code: "11238",
        },
      },
      ua: parseUserAgent(
        event.context?.userAgent ||
          userAgent ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
      ),
      headers: {},
      source: {
        id: "functionsDebugger-streamId",
        name: "Functions Debugger Stream",
        type: "browser",
      },
      destination: {
        id: "functionsDebugger-destinationId",
        type: "clickhouse",
        updatedAt: new Date(),
        hash: "hash",
      },
      connection: {
        id: "functionsDebugger",
      },
      allConnections: [
        {
          id: "functionsDebugger",
          destinationId: "functionsDebugger-destinationId",
          destinationName: "Functions Debugger Destination",
          type: "clickhouse",
          mode: "batch",
        },
      ],
      workspace: {
        id: workspaceId,
      },
    };
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
        type: "udf",
        id,
        debugTill: d,
      },
      props: variables,
    };
    if (typeof code === "string") {
      wrapper = UDFWrapper(id, chainCtx, funcCtx, [{ id, name, code }]);
    } else {
      wrapper = code;
    }
    const result = await wrapper?.userFunction(event, eventContext);
    return {
      dropped: isDropResult(result),
      result: typeof result === "undefined" ? event : result,
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
      result: {},
      store: !realStore && store ? memoryStoreDump(store) : {},
      logs,
    };
  } finally {
    wrapper?.close();
  }
}
