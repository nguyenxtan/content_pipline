import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { config } from "./config";
import { router } from "./routes";
import { startTokenMonitor } from "./services/scheduler";
import { TokenManagerService } from "./services/token-manager";
import { FacebookApiError } from "./services/facebook-api";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(router);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof FacebookApiError) {
    res.status(error.status ?? 502).json({
      error: error.message,
      details: error.payload
    });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Unknown error." });
});

const service = new TokenManagerService();
startTokenMonitor(service);

app.listen(config.port, () => {
  console.log(`facebook-page-token-manager listening on port ${config.port}`);
});
