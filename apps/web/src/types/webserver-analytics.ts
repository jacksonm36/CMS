export type WebserverAnalyticsPayload = {
  logPath: string;
  scope: string;
  /** Present when nginx/openresty daemon scope merges multiple log files */
  sourceHint?: string;
  sampleLines: number;
  parsedLines: number;
  parseFailures: number;
  uniqueClients: number;
  totalBytes: number;
  requestsPerMinute: { minuteKey: string; label: string; requests: number; bytes: number }[];
  topClients: { ip: string; requests: number }[];
  statusDistribution: { status: string; count: number }[];
  methodDistribution: { method: string; count: number }[];
  /** Newest first — IP, country (GeoIP), time, path, status, UA */
  recentAccess: {
    ip: string;
    countryCode: string;
    countryName: string;
    datetime: string;
    method: string;
    path: string;
    status: string;
    bytes: number;
    userAgent: string | null;
    referrer: string | null;
  }[];
  note?: string;
};
