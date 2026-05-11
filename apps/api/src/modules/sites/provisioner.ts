import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export async function provisionSiteDir(rootPath: string): Promise<void> {
  try {
    await mkdir(rootPath, { recursive: true });
    await writeFile(
      join(rootPath, "index.html"),
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Site</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 3rem; border: 1px solid #334155; border-radius: 1rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <h1>HostPanel</h1>
    <p>Your site has been provisioned. Upload your files to get started.</p>
  </div>
</body>
</html>`,
      "utf-8"
    );
  } catch (err) {
    console.warn("[Provisioner] Could not create site directory:", err);
  }
}
