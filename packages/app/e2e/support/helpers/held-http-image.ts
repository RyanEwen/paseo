import { createServer } from "node:http";

/** Run against a fresh uncached image whose response is released explicitly by the test. */
export async function withHeldImage(
  width: number,
  height: number,
  run: (url: string, release: () => void) => Promise<void>,
): Promise<void> {
  let released = false;
  const pending = new Set<() => void>();
  const server = createServer((_request, response) => {
    const send = () => {
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#369"/></svg>`,
      );
    };
    if (released) send();
    else pending.add(send);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Image server did not listen");
    await run(`http://127.0.0.1:${address.port}/image.svg`, () => {
      released = true;
      for (const send of pending) send();
      pending.clear();
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
