import { prisma } from "@hostpanel/db";
import type { Site } from "@prisma/client";
import { sanitizeDefaultDocument } from "../sites/default-document.js";
import { allocateHostPanelLoopbackPort } from "../sites/port-allocate.js";
import { PORT_ALLOC_END, PORT_ALLOC_START } from "../sites/site-docker-isolation.js";
import { writeSiteConfig, reloadWebServer, type WebServerType } from "../sites/webservers/index.js";
import { deployInfrastructureForTemplatedSite } from "../sites/site-template-stack-deploy.js";
import { assertSafeSiteDomain, siteRootPathFromDomain } from "../sites/safe-site-domain.js";

function typeNeedsPort(type: string): boolean {
  return type === "nodejs" || type === "python";
}

export type DeployFromTemplateInput = {
  templateId: string;
  name: string;
  domain: string;
  ownerId?: string;
  actorUserId: string;
  actorRole: string;
};

export type DeployFromTemplateResult =
  | { ok: true; site: Site; warnings: string[] }
  | { ok: false; status: number; error: string };

export async function deploySiteFromTemplate(input: DeployFromTemplateInput): Promise<DeployFromTemplateResult> {
  let domain: string;
  try {
    domain = assertSafeSiteDomain(input.domain);
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : "Invalid domain" };
  }

  const tpl = await prisma.siteTemplate.findUnique({ where: { id: input.templateId } });
  if (!tpl) return { ok: false, status: 404, error: "Template not found" };

  if (tpl.webServer === "traefik" && (tpl.type === "php" || tpl.type === "static")) {
    return {
      ok: false,
      status: 400,
      error: "This template uses Traefik with PHP/static — fix the template or choose Node/Python.",
    };
  }

  const existing = await prisma.site.findUnique({ where: { domain } });
  if (existing) return { ok: false, status: 409, error: "Domain already exists" };

  let ownerId = input.actorUserId;
  if (input.ownerId) {
    const assignee = await prisma.user.findUnique({ where: { id: input.ownerId } });
    if (!assignee) return { ok: false, status: 400, error: "Owner user not found" };
    ownerId = assignee.id;
  }

  let appProxyPort = tpl.appProxyPort;
  if (!appProxyPort && typeNeedsPort(tpl.type)) {
    const allocated = await allocateHostPanelLoopbackPort();
    if (!allocated) {
      return {
        ok: false,
        status: 503,
        error: `Port range ${PORT_ALLOC_START}–${PORT_ALLOC_END} exhausted`,
      };
    }
    appProxyPort = allocated;
  }

  let inheritedDoc: string | null = tpl.defaultDocument ?? null;
  if (inheritedDoc) inheritedDoc = sanitizeDefaultDocument(inheritedDoc);
  if (inheritedDoc != null && tpl.type !== "static" && tpl.type !== "php") inheritedDoc = null;

  const rootPath = siteRootPathFromDomain(domain);
  const site = await prisma.site.create({
    data: {
      name: input.name,
      domain,
      ownerId,
      type: tpl.type,
      webServer: tpl.webServer,
      phpVersion: tpl.phpVersion,
      nodeVersion: tpl.nodeVersion,
      pythonVersion: tpl.pythonVersion,
      dbStackVersion: tpl.dbStackVersion,
      appProxyPort,
      networkGroup: tpl.networkGroup ?? null,
      isCentralService: tpl.isCentralService ?? false,
      templateId: tpl.id,
      defaultDocument: inheritedDoc,
      rootPath,
      status: "pending",
    },
  });

  const deployResult = await deployInfrastructureForTemplatedSite(site, tpl);

  const fresh = await prisma.site.findUnique({ where: { id: site.id } });
  if (!fresh) return { ok: false, status: 500, error: "Site row missing after provision" };

  try {
    const configPath = await writeSiteConfig(fresh);
    await prisma.site.update({ where: { id: site.id }, data: { webConfigPath: configPath } });
    await reloadWebServer(fresh.webServer as WebServerType);
    await prisma.site.update({ where: { id: site.id }, data: { status: "active" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      error: `Site ${site.id} was created but web server config failed: ${msg}`,
    };
  }

  const finalSite = await prisma.site.findUnique({
    where: { id: site.id },
    include: { _count: { select: { databases: true } } },
  });

  return {
    ok: true,
    site: finalSite ?? fresh,
    warnings: deployResult.warnings,
  };
}
