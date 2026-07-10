import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const release = resolve(root, ".traceforge/release");
const api = resolve(release, "api");
const web = resolve(release, "web");

await rm(release, { recursive: true, force: true });
await mkdir(api, { recursive: true });
await mkdir(web, { recursive: true });
await cp(resolve(root, "apps/api/dist"), resolve(api, "dist"), { recursive: true });
await cp(resolve(root, "apps/web/dist"), web, { recursive: true });

const packageJson = JSON.parse(await readFile(resolve(root, "apps/api/package.json"), "utf8"));
delete packageJson.devDependencies;
delete packageJson.dependencies["@openai/codex-sdk"];
packageJson.scripts = { start: "node dist/server.js" };
await writeFile(resolve(api, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

console.log(release);
