import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { renderLocalArtifactPage } from "./artifact-page.js";
import { renderLocalPage } from "./local-page.js";
import { LocalRunnerSession, type LocalRunnerSnapshot } from "./session.js";

const LOOPBACK_HOST = "127.0.0.1";
const COOKIE_NAME = "traceforge_local_session";

export interface LocalRunnerServer {
  url: string;
  origin: string;
  port: number;
  close(): Promise<void>;
}

export interface LocalRunnerServerOptions {
  closeOnDelete?: boolean;
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function cookies(request: IncomingMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    result.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return result;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

function text(
  response: ServerResponse,
  status: number,
  contentType: string,
  value: string,
  disposition?: string,
): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  if (disposition) response.setHeader("Content-Disposition", disposition);
  response.end(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "LOCAL_REQUEST_FAILED";
}

export async function startLocalRunnerServer(
  session: LocalRunnerSession,
  options: LocalRunnerServerOptions = {},
): Promise<LocalRunnerServer> {
  const bootstrapToken = token();
  const cookieToken = token();
  const csrfToken = token();
  let bootstrapUsed = false;
  let port = 0;
  let origin = "";
  const eventStreams = new Set<ServerResponse>();

  const authorized = (request: IncomingMessage): boolean =>
    cookies(request).get(COOKIE_NAME) === cookieToken;

  const requestBoundaryError = (request: IncomingMessage): string | null => {
    if (request.headers.host !== `${LOOPBACK_HOST}:${port}`) return "LOCAL_REQUEST_HOST_BLOCKED";
    const fetchSite = request.headers["sec-fetch-site"];
    // Chrome may classify loopback fetches as same-site across its extension
    // boundary. Mutations still require the exact Origin and an unguessable
    // CSRF token, so accepting same-site here does not broaden write access.
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
      return "LOCAL_REQUEST_SITE_BLOCKED";
    }
    return null;
  };

  const mutationOriginAllowed = (request: IncomingMessage): boolean => {
    const originHeader = request.headers.origin;
    if (originHeader === origin) return true;
    // Chrome can expose an opaque `null` Origin when a controlling extension
    // runs the page in an isolated world. The HttpOnly session cookie,
    // unguessable CSRF header, exact Host, and lack of CORS headers remain
    // mandatory, so an unrelated null-origin document cannot forge a write.
    if (originHeader === "null") return true;
    if (!originHeader) return false;
    try {
      const parsed = new URL(originHeader);
      const loopbackOrigin = (parsed.hostname === LOOPBACK_HOST || parsed.hostname === "localhost"
        || parsed.hostname === "[::1]" || parsed.hostname === "::1")
        && (parsed.protocol === "http:" || parsed.protocol === "https:");
      // A browser extension controlling this exact local tab can already read
      // its CSRF token. Accept its isolated-world Origin so accessibility and
      // QA extensions do not break the local UI; ordinary web origins remain
      // blocked and no CORS response headers are emitted.
      return (loopbackOrigin
        || parsed.protocol === "chrome-extension:"
        || parsed.protocol === "moz-extension:")
        && !parsed.username
        && !parsed.password;
    } catch {
      return false;
    }
  };

  const mutationBoundaryError = (request: IncomingMessage): string | null => {
    if (!authorized(request)) return "LOCAL_MUTATION_AUTH_BLOCKED";
    const requestError = requestBoundaryError(request);
    if (requestError) return requestError;
    if (!mutationOriginAllowed(request)) return "LOCAL_MUTATION_ORIGIN_BLOCKED";
    if (request.headers["x-traceforge-csrf"] !== csrfToken) return "LOCAL_MUTATION_CSRF_BLOCKED";
    if (request.headers["content-type"]?.toLowerCase().startsWith("application/json") !== true) {
      return "LOCAL_MUTATION_CONTENT_TYPE_BLOCKED";
    }
    if (Number(request.headers["content-length"] ?? "0") > 64) return "LOCAL_MUTATION_BODY_BLOCKED";
    return null;
  };

  const broadcast = (snapshot: LocalRunnerSnapshot): void => {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const stream of eventStreams) stream.write(payload);
  };

  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");

    const boundaryError = requestBoundaryError(request);
    if (boundaryError) {
      json(response, 403, { error: boundaryError });
      return;
    }

    if (method === "GET" && url.pathname === `/session/${bootstrapToken}`) {
      if (bootstrapUsed) {
        json(response, 410, { error: "LOCAL_BOOTSTRAP_ALREADY_USED" });
        return;
      }
      bootstrapUsed = true;
      securityHeaders(response);
      response.statusCode = 303;
      response.setHeader("Location", "/local");
      response.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=${cookieToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`,
      );
      response.end();
      return;
    }

    if (!authorized(request)) {
      json(response, 401, { error: "LOCAL_SESSION_AUTH_REQUIRED" });
      return;
    }

    if (method === "GET" && url.pathname === "/local") {
      const nonce = token(18);
      securityHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'`,
      );
      response.end(renderLocalPage({ nonce, csrfToken }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      json(response, 200, session.snapshot());
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      securityHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      eventStreams.add(response);
      response.write(`data: ${JSON.stringify(session.snapshot())}\n\n`);
      const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
      request.once("close", () => {
        clearInterval(keepAlive);
        eventStreams.delete(response);
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/proof") {
      const result = session.result();
      if (!result) {
        json(response, 404, { error: "LOCAL_PROOF_NOT_AVAILABLE" });
        return;
      }
      const proofJson = `${JSON.stringify(result.proof, null, 2)}\n`;
      if (url.searchParams.get("view") === "html") {
        const nonce = token(18);
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        );
        response.end(renderLocalArtifactPage({
          nonce,
          eyebrow: "Fresh proof bundle",
          title: result.summary.status === "PASSED" ? "Passing local proof" : "Failed local proof",
          description: "Host-issued evidence from 13 focused candidate tests and six differential scenarios, with command exit codes and recomputable digests. The source champion gate separately contains 42 candidate-safe tests and four replay guards. Raw command output is intentionally excluded.",
          content: proofJson,
          rawHref: "/api/proof?download=1",
          rawLabel: "Open raw JSON",
        }));
        return;
      }
      text(
        response,
        200,
        "application/json; charset=utf-8",
        proofJson,
        url.searchParams.get("download") === "1"
          ? 'attachment; filename="traceforge-local-proof.json"'
          : 'inline; filename="traceforge-local-proof.json"',
      );
      return;
    }

    if (method === "GET" && url.pathname === "/api/diff") {
      const result = session.result();
      if (!result) {
        json(response, 404, { error: "LOCAL_DIFF_NOT_AVAILABLE" });
        return;
      }
      if (url.searchParams.get("view") === "html") {
        const nonce = token(18);
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        );
        response.end(renderLocalArtifactPage({
          nonce,
          eyebrow: "Live Codex change",
          title: "Bounded candidate diff",
          description: "The exact one-file change produced in the temporary writer workspace. No commit, push, merge, or deploy occurred.",
          content: result.diff,
          rawHref: "/api/diff?download=1",
          rawLabel: "Open raw diff",
        }));
        return;
      }
      text(
        response,
        200,
        "text/plain; charset=utf-8",
        result.diff,
        url.searchParams.get("download") === "1"
          ? 'attachment; filename="traceforge-local-codex.diff"'
          : 'inline; filename="traceforge-local-codex.diff"',
      );
      return;
    }

    if (method === "POST" && ["/api/login", "/api/start", "/api/retry", "/api/delete"].includes(url.pathname)) {
      const mutationError = mutationBoundaryError(request);
      if (mutationError) {
        json(response, 403, { error: mutationError });
        return;
      }
      request.resume();
      try {
        if (url.pathname === "/api/login") void session.login().catch(() => undefined);
        if (url.pathname === "/api/start") void session.start().catch(() => undefined);
        if (url.pathname === "/api/retry") void session.initialize().catch(() => undefined);
        if (url.pathname === "/api/delete") {
          void session.delete().catch(() => undefined);
        }
        json(response, 202, session.snapshot());
      } catch (error) {
        json(response, 409, { error: errorMessage(error) });
      }
      return;
    }

    json(response, 404, { error: "LOCAL_ROUTE_NOT_FOUND" });
  });

  session.on("change", broadcast);
  server.listen(0, LOOPBACK_HOST);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LOCAL_SERVER_BIND_FAILED");
  port = address.port;
  origin = `http://${LOOPBACK_HOST}:${port}`;

  let closing: Promise<void> | null = null;
  const close = async (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      session.off("change", broadcast);
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
      server.close();
      if (server.listening) await once(server, "close");
    })();
    return closing;
  };

  if (options.closeOnDelete !== false) {
    const maybeClose = (snapshot: LocalRunnerSnapshot): void => {
      if (snapshot.phase !== "deleted") return;
      session.off("change", maybeClose);
      setTimeout(() => void close(), 1_500);
    };
    session.on("change", maybeClose);
  }

  return {
    url: `${origin}/session/${bootstrapToken}`,
    origin,
    port,
    close,
  };
}
