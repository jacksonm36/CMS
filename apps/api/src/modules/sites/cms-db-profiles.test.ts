import { describe, expect, it } from "vitest";
import { normalizeDbHost } from "./write-site-db-env.js";
import { resolveCmsDbProfile, resolveRecipeSlug, shouldProvisionCmsAfterInstall } from "./cms-db-profiles.js";

describe("cms-db-profiles", () => {
  it("resolves recipe aliases to CMS profiles", () => {
    expect(resolveRecipeSlug("drupal-mariadb")).toBe("drupal");
    expect(resolveRecipeSlug("php-mysql-wp")).toBe("wordpress");
    expect(resolveCmsDbProfile("moodle-mariadb")).toBe("moodle");
    expect(resolveCmsDbProfile("prestashop")).toBe("prestashop");
  });

  it("normalizeDbHost avoids localhost socket", () => {
    expect(normalizeDbHost("localhost")).toBe("127.0.0.1");
    expect(normalizeDbHost("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("shouldProvisionCmsAfterInstall", () => {
  it("returns true for mysql stack templates with recipes", () => {
    expect(
      shouldProvisionCmsAfterInstall({
        slug: "wordpress",
        dbStackVersion: "mysql-8.0",
        autoDeployIsolation: true,
        stackNetworkPerSite: true,
        provisionDockerDb: true,
      } as never),
    ).toBe(true);
  });

  it("returns false for static template", () => {
    expect(
      shouldProvisionCmsAfterInstall({
        slug: "static-nginx",
        dbStackVersion: null,
        autoDeployIsolation: false,
        stackNetworkPerSite: false,
        provisionDockerDb: false,
      } as never),
    ).toBe(false);
  });
});
