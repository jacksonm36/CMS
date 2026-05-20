import { RECIPE_ALIASES } from "../site-templates/template-app-recipes.js";
import type { SiteTemplate } from "@prisma/client";
import { getEffectiveDeployFlags } from "../site-templates/template-deploy-flags.js";

/** CMS families that receive post-install DB + permission provisioning. */
export const CMS_DB_PROFILE_IDS = [
  "drupal",
  "wordpress",
  "joomla",
  "moodle",
  "laravel",
  "symfony",
  "flarum",
  "mediawiki",
  "phpbb",
  "opencart",
  "prestashop",
  "matomo",
  "installer-php",
] as const;

export type CmsDbProfileId = (typeof CMS_DB_PROFILE_IDS)[number];

/** Recipe / template slug → provisioning profile (after RECIPE_ALIASES resolution). */
const SLUG_TO_PROFILE: Record<string, CmsDbProfileId> = {
  wordpress: "wordpress",
  drupal: "drupal",
  joomla: "joomla",
  moodle: "moodle",
  laravel: "laravel",
  "laravel-postgresql": "laravel",
  "laravel-sqlite": "laravel",
  symfony: "symfony",
  flarum: "flarum",
  mediawiki: "mediawiki",
  phpbb: "phpbb",
  opencart: "opencart",
  prestashop: "prestashop",
  matomo: "matomo",
  grav: "installer-php",
  dokuwiki: "installer-php",
};

export function resolveRecipeSlug(templateSlug: string): string {
  return RECIPE_ALIASES[templateSlug] ?? templateSlug;
}

export function resolveCmsDbProfile(templateSlug: string): CmsDbProfileId | null {
  const key = resolveRecipeSlug(templateSlug);
  return SLUG_TO_PROFILE[key] ?? null;
}

const STACK_DB_PREFIXES = [
  "mysql",
  "mariadb",
  "postgresql",
  "postgres",
  "sqlite",
  "mongodb",
  "mongo",
  "mssql",
  "sqlserver",
] as const;

export function templateUsesProvisionedSql(tpl: SiteTemplate): boolean {
  const db = (tpl.dbStackVersion ?? "").toLowerCase();
  if (!STACK_DB_PREFIXES.some((p) => db.startsWith(p))) {
    return false;
  }
  return getEffectiveDeployFlags(tpl).provisionDockerDb;
}

export function shouldProvisionCmsAfterInstall(tpl: SiteTemplate): boolean {
  if (!templateUsesProvisionedSql(tpl)) {
    return false;
  }
  return resolveCmsDbProfile(tpl.slug) !== null;
}
