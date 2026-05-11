import type { FastifyInstance } from "fastify";
import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";

export async function terminalRoutes(app: FastifyInstance) {
  app.get(
    "/:id/terminal",
    { websocket: true },
    async (socket, request) => {
      const query = request.query as { token?: string };

      // Verify JWT token from query (xterm passes it as query param)
      try {
        if (!query.token) throw new Error("No token");
        request.jwtVerify = request.jwtVerify.bind(request);
        await app.jwt.verify(query.token);
      } catch {
        socket.send("\r\n\x1b[31mAuthentication failed\x1b[0m\r\n");
        socket.close();
        return;
      }

      let shell: ChildProcessWithoutNullStreams | null = null;

      try {
        // Spawn a restricted shell. In production, this would be namespaced per site.
        const isWindows = process.platform === "win32";
        shell = isWindows
          ? spawn("cmd.exe", [], { env: { ...process.env, TERM: "xterm-256color" } })
          : spawn("/bin/bash", ["--login"], {
              env: { ...process.env, TERM: "xterm-256color", HOME: "/tmp" },
            });

        shell.stdout.on("data", (data: Buffer) => socket.send(data.toString("utf-8")));
        shell.stderr.on("data", (data: Buffer) => socket.send(data.toString("utf-8")));

        shell.on("exit", () => {
          socket.send("\r\n\x1b[33mShell exited\x1b[0m\r\n");
          socket.close();
        });

        socket.on("message", (data: Buffer) => {
          if (shell && !shell.killed) {
            shell.stdin.write(data.toString("utf-8"));
          }
        });
      } catch (err) {
        socket.send(`\r\n\x1b[31mCould not spawn shell: ${err}\x1b[0m\r\n`);
      }

      socket.on("close", () => {
        if (shell && !shell.killed) shell.kill();
      });
    }
  );
}
