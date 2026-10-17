/** Build the file-backed plugin used to hold and fail a workspace's initial agent startup. */
export function buildStartupGatePlugin(gate: string): string {
  return `
import { readFile, rm } from "node:fs/promises";
export default function contribute(server) {
  return server.before("agent.session_open", async ({ request }) => {
    // Internal workspace naming has no workspace and must not consume the foreground failure.
    if (request.reason !== "create" || request.workspaceId === null) return request;
    const gate = ${JSON.stringify(gate)};
    let command = await readFile(gate, "utf8").catch(() => "release");
    while (command === "hold") {
      await new Promise(resolve => setTimeout(resolve, 20));
      command = await readFile(gate, "utf8").catch(() => "release");
    }
    if (command === "fail") {
      await rm(gate, { force: true });
      throw new Error("Creation startup failed for test");
    }
    return request;
  });
}
`;
}
