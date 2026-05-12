import { z } from "zod";

export const PHP_VERSIONS = ["8.0", "8.1", "8.2", "8.3", "8.4"] as const;
export const NODE_VERSIONS = ["18", "20", "22", "24"] as const;
export const PYTHON_VERSIONS = ["3.10", "3.11", "3.12", "3.13"] as const;
export const DB_STACK_VERSIONS = [
  "postgresql-15",
  "postgresql-16",
  "postgresql-17",
  "mysql-8.0",
  "mariadb-10.11",
] as const;

export const phpVersionEnum = z.enum(PHP_VERSIONS);
export const nodeVersionEnum = z.enum(NODE_VERSIONS);
export const pythonVersionEnum = z.enum(PYTHON_VERSIONS);
export const dbStackVersionEnum = z.enum(DB_STACK_VERSIONS);

export const patchSiteStackSchema = z
  .object({
    phpVersion: phpVersionEnum.nullable().optional(),
    nodeVersion: nodeVersionEnum.nullable().optional(),
    pythonVersion: pythonVersionEnum.nullable().optional(),
    dbStackVersion: dbStackVersionEnum.nullable().optional(),
    type: z.enum(["php", "static", "nodejs", "python"]).optional(),
    appProxyPort: z.number().int().min(1024).max(65535).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
    if (keys.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide at least one field to update" });
    }
  });

export function stackCatalogResponse() {
  return {
    phpVersions: [...PHP_VERSIONS],
    nodeVersions: [...NODE_VERSIONS],
    pythonVersions: [...PYTHON_VERSIONS],
    dbStackVersions: [...DB_STACK_VERSIONS],
    siteTypes: ["static", "php", "nodejs", "python"] as const,
  };
}
