import { createHash } from "node:crypto";

export function sha256Text(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

