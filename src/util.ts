import * as crypto from "node:crypto";

export function uniqueId() {
  return crypto.randomBytes(16).toString("hex");
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
