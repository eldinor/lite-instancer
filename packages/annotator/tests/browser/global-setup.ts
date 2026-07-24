import { createServer } from "vite";

export default async function startFixtureServer(): Promise<() => Promise<void>> {
  const server = await createServer({
    configFile: "vite.browser.config.ts",
    server: {
      host: "127.0.0.1",
      port: 4179,
      strictPort: true
    }
  });
  await server.listen();
  return async () => {
    await server.close();
  };
}
