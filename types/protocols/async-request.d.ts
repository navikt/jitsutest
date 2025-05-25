import { ISO8601Date } from "./iso8601";
import type { Geo } from "./analytics";

export type IngestType = "s2s" | "browser";

export type IngestMessage = {
  geo?: Geo;
  ingestType: IngestType;
  messageCreated: ISO8601Date;
  writeKey: string;
  messageId: string;
  //currently this not being filled
  connectionId: string;
  type: string;
  origin: {
    baseUrl: string;
    slug?: string;
    sourceId?: string;
    sourceName?: string;
    domain?: string;
    classic?: boolean;
  };
  httpHeaders: Record<string, string>;
  httpPayload: any;
};
