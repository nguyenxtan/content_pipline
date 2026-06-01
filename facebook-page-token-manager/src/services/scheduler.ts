import { TokenManagerService } from "./token-manager";
import { config } from "../config";

export function startTokenMonitor(service: TokenManagerService) {
  const run = async () => {
    try {
      const warnings = await service.runExpiryMonitor();
      for (const warning of warnings) {
        console.warn(`[token-monitor] ${warning.message}`);
      }
    } catch (error) {
      console.error("[token-monitor] failed:", error instanceof Error ? error.message : String(error));
    }
  };

  void run();
  return setInterval(run, config.tokenMonitorIntervalMs);
}
