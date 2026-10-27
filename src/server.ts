
import "dotenv/config";
import { createServer } from "node:http";
import { app } from "./app.js";
import { prisma } from "./config/prisma.js";

const port = Number(process.env.PORT ?? 3000);
const server = createServer(app);

server.listen(port, () => {
  console.info(`Amrutam API listening on port ${port}`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`Received ${signal}; shutting down`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out");
    process.exit(1);
  }, 10_000);

  forceExit.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();

      if (error) {
        console.error("HTTP server shutdown failed", error);
        process.exitCode = 1;
      }
    } catch (disconnectError) {
      console.error(
        "Database shutdown failed",
        disconnectError,
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(forceExit);
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
