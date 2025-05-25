import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent, ID } from "@jitsu/protocols/analytics";
import { FacebookConversionApiCredentials } from "../meta";

import crypto from "crypto";
import omit from "lodash/omit";
import { RetryError } from "@jitsu/functions-lib";
import { createFilter, eventTimeSafeMs } from "./lib";
import { deepMerge } from "juava";

export function facebookHash(input: string | undefined) {
  if (!input) {
    return undefined;
  }
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function reduceArray(strings: ID[]): ID[] | ID {
  return strings.length === 1 ? strings[0] : strings;
}

function sanitizePhone(ph: string) {
  let sanitizedPhone = ph.replace(/[^\d]/g, "");
  sanitizedPhone = sanitizedPhone.replace(/^0+/, "");
  return sanitizedPhone;
}

function tryParse(responseText: string) {
  try {
    return JSON.parse(responseText);
  } catch (e) {
    return responseText;
  }
}

function toPrettyString(responseJson: any) {
  return typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson, null, 2);
}

/**
 * See https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 * and https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 */
const FacebookConversionsApi: JitsuFunction<AnalyticsServerEvent, FacebookConversionApiCredentials> = async (
  event,
  ctx
) => {
  if (["track", "page", "screen"].includes(event.type)) {
    const actionSource = ctx.props?.actionSource || "website";
    const analyticsContext = event.context || ({} as any);
    const device = analyticsContext.device || ({} as any);
    const app = analyticsContext.app || ({} as any);
    const screen = analyticsContext.screen || ({} as any);
    const os = (analyticsContext.os?.name ?? "").toLowerCase();
    const filter = createFilter(ctx.props.events || "");
    if (!filter(event.type, event.event)) return;
    const geo = ctx.geo;
    let geoUserData = {};
    if (geo) {
      geoUserData = {
        ct: facebookHash(geo.city?.name),
        st: facebookHash(geo.region?.code),
        country: facebookHash(geo.country?.code),
        zp: facebookHash(geo.postalCode?.code),
      };
    }

    const baseProps = {
      event_name: event.type === "track" ? event.event : event.type,
      event_time: Math.floor(eventTimeSafeMs(event) / 1000),
      event_id: event.messageId,
      action_source: actionSource,
      event_source_url: event.context?.page?.url,
      user_data: {
        em: event.context.traits?.email ? facebookHash(event.context.traits.email as string) : undefined,
        ph:
          ctx.props?.phoneFieldName && event.context.traits?.[ctx.props.phoneFieldName]
            ? facebookHash(sanitizePhone(String(event.context.traits[ctx.props.phoneFieldName])))
            : undefined,
        external_id: reduceArray([event.userId, event.anonymousId].filter(e => !!e)),
        client_ip_address: event.context.ip,
        client_user_agent: event.context.userAgent,
        fbc: event.context.clientIds?.fbc,
        fbp: event.context.clientIds?.fbp,
        ...geoUserData,
      },
      app_data:
        actionSource === "app"
          ? {
              advertiser_tracking_enabled: 0,
              application_tracking_enabled: 0,
              extinfo: [
                os === "ios" || os === "macos" ? "i2" : "a2",
                app.namespace ?? "",
                app.version ?? "",
                app.version ?? "",
                analyticsContext.os?.version || ctx.ua?.os?.version || "1.0",
                device.model ?? "",
                analyticsContext.locale ?? "",
                "",
                "",
                screen.width ? screen.width.toString() : "",
                screen.height ? screen.height.toString() : "",
                screen.density ? screen.density.toString() : "",
                "",
                "",
                "",
                analyticsContext.timezone ?? "",
              ],
            }
          : undefined,
    };

    const fbEvent =
      typeof event.facebookEvent === "object" && !Array.isArray(event.facebookEvent)
        ? deepMerge(baseProps, event.facebookEvent)
        : {
            ...baseProps,
            custom_data: omit(event.properties, [
              "path",
              "referrer",
              "host",
              "referring_domain",
              "search",
              "title",
              "url",
              "hash",
              "height",
              "width",
            ]),
          };

    const baseUrl = `https://graph.facebook.com/v21.0/${ctx.props.pixelId}/events?access_token=`;
    const payload = { data: [fbEvent] };
    const fetchResult = await ctx.fetch(`${baseUrl}${ctx.props.accessToken}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseText = await fetchResult.text();
    const responseJson = tryParse(responseText);
    ctx.log.debug(
      `Facebook API - ${baseUrl}**** ---------> ${fetchResult.status} ${fetchResult.statusText}:\n${toPrettyString(
        responseJson
      )}`
    );
    if (!fetchResult.ok) {
      throw new RetryError(
        `Facebook API error. Called: ${baseUrl}****, got ${fetchResult.status} ${fetchResult.statusText} - ${responseText}`
      );
    }
  }
};

FacebookConversionsApi.displayName = "facebook-conversion-api";

FacebookConversionsApi.description = "Send events to facebook conversion API";

export default FacebookConversionsApi;
