import * as crypto from "node:crypto";
import { scheduler } from "node:timers/promises";

export function uniqueId() {
  return crypto.randomBytes(4).toString("hex");
  // return crypto.randomBytes(16).toString("hex");
}

export async function sleep(ms: number) {
  return await scheduler.wait(ms);
}
