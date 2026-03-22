import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Client } from "discord.js";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { resolveProvisionConfig, upsertGuildConfig } from "../tenancy/config";
import { provisionGuildTenant } from "../tenancy/provision";
import { GuildConfigInput } from "../tenancy/types";

const configSchema = z.object({
  employeeRoleId: z.string().min(1),
  cvChannelId: z.string().min(1),
  cvApprovedChannelId: z.string().min(1),
  timesheetChannelId: z.string().min(1),
  timesheetArchiveChannelId: z.string().min(1),
  timesheetSummaryChannelId: z.string().min(1),
  logChannelId: z.string().min(1),
  managerRoleIds: z.array(z.string().min(1)),
  timezone: z.string().min(1),
});

const configUpdateBodySchema = z.object({
  config: configSchema,
});

const provisionBodySchema = z.object({
  actorUserId: z.string().min(1).optional(),
  config: configSchema.optional(),
});

type ControlPanelServerHandle = {
  close: () => Promise<void>;
};

const panelRootDir = join(process.cwd(), "public", "panel");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function setJsonHeaders(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Panel-Token, X-Panel-Proxy-Secret, X-Panel-Actor-Id, X-Panel-Actor-Name, X-Request-Id");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
}

function setCorsOriginHeader(response: ServerResponse, origin: string | null): void {
  if (origin && isOriginAllowed(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    return;
  }

  if (!origin && env.panelAllowedOrigins.length === 0) {
    response.setHeader("Access-Control-Allow-Origin", "*");
  }
}

function setJsonHeadersWithCors(response: ServerResponse, statusCode: number, origin: string | null): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Panel-Token, X-Panel-Proxy-Secret, X-Panel-Actor-Id, X-Panel-Actor-Name, X-Request-Id");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  setCorsOriginHeader(response, origin);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown, origin: string | null = null): void {
  setJsonHeadersWithCors(response, statusCode, origin);
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, contentType: string, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(payload);
}

function sendNoContent(response: ServerResponse): void {
  response.statusCode = 204;
  response.end();
}

function getHeaderValue(request: IncomingMessage, key: string): string | null {
  const value = request.headers[key.toLowerCase()];
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

function isAuthorized(request: IncomingMessage): boolean {
  const requestToken = getHeaderValue(request, "x-panel-token");
  if (!env.PANEL_API_TOKEN || !requestToken || requestToken !== env.PANEL_API_TOKEN) {
    return false;
  }

  if (!env.PANEL_PROXY_SHARED_SECRET) {
    return true;
  }

  const proxySecret = getHeaderValue(request, "x-panel-proxy-secret");
  return Boolean(proxySecret && proxySecret === env.PANEL_PROXY_SHARED_SECRET);
}

function hasProxyMetadata(request: IncomingMessage): boolean {
  const actorUserId = getHeaderValue(request, "x-panel-actor-id");
  const requestId = getHeaderValue(request, "x-request-id");
  return Boolean(actorUserId && requestId);
}

function getOrigin(request: IncomingMessage): string | null {
  const originHeader = request.headers.origin;
  if (!originHeader) {
    return null;
  }

  return Array.isArray(originHeader) ? originHeader[0] : originHeader;
}

function isOriginAllowed(origin: string): boolean {
  if (env.panelAllowedOrigins.length === 0) {
    return true;
  }

  return env.panelAllowedOrigins.includes(origin);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function extractGuildId(pathname: string, suffix?: string): string | null {
  const pattern = suffix
    ? new RegExp(`^/api/guilds/([^/]+)/${suffix.replace("/", "")}$`)
    : /^\/api\/guilds\/([^/]+)$/;

  const match = pathname.match(pattern);
  if (!match || !match[1]) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

async function servePanelAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const panelPath = pathname === "/" || pathname === "/panel" || pathname === "/panel/"
    ? "/panel/index.html"
    : pathname;

  if (!panelPath.startsWith("/panel")) {
    return false;
  }

  if (pathname === "/panel") {
    response.statusCode = 302;
    response.setHeader("Location", "/panel/");
    response.end();
    return true;
  }

  const relativePath = panelPath.replace(/^\/panel\/?/, "");
  const safeRelative = normalize(relativePath).replace(/^\.\.[/\\]/, "");
  if (safeRelative.includes("..")) {
    sendText(response, 400, "text/plain; charset=utf-8", "Invalid path");
    return true;
  }
  const absolutePath = join(panelRootDir, safeRelative || "index.html");

  try {
    const content = await readFile(absolutePath);
    const extension = extname(absolutePath).toLowerCase();
    const contentType = mimeTypes[extension] ?? "application/octet-stream";
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.end(content);
    return true;
  } catch (_error) {
    sendText(response, 404, "text/plain; charset=utf-8", "Not found");
    return true;
  }
}

async function listGuilds(client: Client): Promise<unknown[]> {
  const guildCache = client.guilds.cache;
  const tenants = await prisma.guildTenant.findMany({ include: { config: true } });
  const tenantByGuildId = new Map(tenants.map((tenant) => [tenant.guildId, tenant]));

  const rows: unknown[] = [];

  for (const guild of guildCache.values()) {
    const tenant = tenantByGuildId.get(guild.id);
    rows.push({
      guildId: guild.id,
      guildName: guild.name,
      botInGuild: true,
      isProvisioned: tenant?.isProvisioned ?? false,
      schemaName: tenant?.schemaName ?? null,
      schemaVersion: tenant?.schemaVersion ?? null,
      hasConfig: Boolean(tenant?.config),
      timezone: tenant?.config?.timezone ?? null,
      updatedAt: tenant?.updatedAt ?? null,
      lastError: tenant?.lastError ?? null,
    });
  }

  for (const tenant of tenants) {
    if (guildCache.has(tenant.guildId)) {
      continue;
    }

    rows.push({
      guildId: tenant.guildId,
      guildName: tenant.guildName,
      botInGuild: false,
      isProvisioned: tenant.isProvisioned,
      schemaName: tenant.schemaName,
      schemaVersion: tenant.schemaVersion,
      hasConfig: Boolean(tenant.config),
      timezone: tenant.config?.timezone ?? null,
      updatedAt: tenant.updatedAt,
      lastError: tenant.lastError,
    });
  }

  return rows;
}

async function getGuildDetails(client: Client, guildId: string): Promise<unknown> {
  const tenant = await prisma.guildTenant.findUnique({
    where: { guildId },
    include: {
      config: true,
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const guild = client.guilds.cache.get(guildId);

  return {
    guild: {
      id: guildId,
      name: guild?.name ?? tenant?.guildName ?? guildId,
      botInGuild: Boolean(guild),
    },
    tenant,
  };
}

async function handleApiRequest(client: Client, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const origin = getOrigin(request);
  const requestId = getHeaderValue(request, "x-request-id") ?? randomUUID();
  response.setHeader("X-Request-Id", requestId);

  if (url.pathname.startsWith("/api") && origin && !isOriginAllowed(origin)) {
    sendJson(response, 403, { error: "Origin not allowed" }, origin);
    return;
  }

  const served = await servePanelAsset(url.pathname, response);
  if (served) {
    return;
  }

  if (method === "OPTIONS") {
    setJsonHeadersWithCors(response, 204, origin);
    sendNoContent(response);
    return;
  }

  if (url.pathname === "/api/health" && method === "GET") {
    sendJson(response, 200, {
      ok: true,
      botReady: client.isReady(),
      guildCount: client.guilds.cache.size,
      startedAt: new Date().toISOString(),
    }, origin);
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "Unauthorized" }, origin);
    return;
  }

  if (env.PANEL_PROXY_ONLY && !hasProxyMetadata(request)) {
    sendJson(response, 403, { error: "Proxy metadata required" }, origin);
    return;
  }

  const actorUserId = getHeaderValue(request, "x-panel-actor-id");
  const actorName = getHeaderValue(request, "x-panel-actor-name");

  if (url.pathname === "/api/guilds" && method === "GET") {
    const guilds = await listGuilds(client);
    sendJson(response, 200, { guilds }, origin);
    return;
  }

  const guildIdForDetails = extractGuildId(url.pathname);
  if (guildIdForDetails && method === "GET") {
    const details = await getGuildDetails(client, guildIdForDetails);
    sendJson(response, 200, details, origin);
    return;
  }

  const guildIdForConfig = extractGuildId(url.pathname, "config");
  if (guildIdForConfig && method === "PUT") {
    const parsedBody = configUpdateBodySchema.parse(await readJsonBody(request));
    const guildName = client.guilds.cache.get(guildIdForConfig)?.name ?? guildIdForConfig;
    const runtimeConfig = await upsertGuildConfig(guildIdForConfig, guildName, parsedBody.config);
    console.info(`[panel-api] requestId=${requestId} action=config.update guildId=${guildIdForConfig} actorId=${actorUserId ?? "unknown"} actorName=${actorName ?? "unknown"}`);
    sendJson(response, 200, { ok: true, config: runtimeConfig }, origin);
    return;
  }

  const guildIdForProvision = extractGuildId(url.pathname, "provision");
  if (guildIdForProvision && method === "POST") {
    const parsedBody = provisionBodySchema.parse(await readJsonBody(request));
    const guildName = client.guilds.cache.get(guildIdForProvision)?.name ?? guildIdForProvision;
    const provisionActorUserId = actorUserId ?? parsedBody.actorUserId ?? "panel";
    const config: GuildConfigInput = await resolveProvisionConfig(guildIdForProvision, guildName, parsedBody.config);

    await provisionGuildTenant({
      guildId: guildIdForProvision,
      guildName,
      actorUserId: provisionActorUserId,
      config,
    });

    console.info(`[panel-api] requestId=${requestId} action=tenant.provision guildId=${guildIdForProvision} actorId=${provisionActorUserId} actorName=${actorName ?? "unknown"}`);

    const details = await getGuildDetails(client, guildIdForProvision);
    sendJson(response, 200, { ok: true, details }, origin);
    return;
  }

  sendJson(response, 404, { error: "Not found" }, origin);
}

export function startControlPanelServer(client: Client): ControlPanelServerHandle | null {
  if (!env.PANEL_API_TOKEN) {
    console.warn("Control panel API is disabled because PANEL_API_TOKEN is not set.");
    return null;
  }

  const port = env.CONTROL_PANEL_PORT;

  const server: Server = createServer((request, response) => {
    void handleApiRequest(client, request, response).catch((error) => {
      const origin = getOrigin(request);
      const message = error instanceof Error ? error.message : "Internal server error";
      sendJson(response, 500, { error: message }, origin);
    });
  });

  server.listen(port, () => {
    console.log(`Control panel API listening on port ${port}`);
  });

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
