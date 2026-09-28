import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  assertOutsideRepository,
  labelSchema,
  parseLabels,
  readRows,
  selectClipRows,
} from "./spike.mjs";

/**
 * @typedef {import("./spike.mjs").QuoteLabel} QuoteLabel
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 */

const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 4096;
const PAGE = new URL("./label.html", import.meta.url);

const USAGE = `Usage: node apps/web/local-tools/quote-locate/label.mjs --input <quoteSubmissions export> [options]

Serves a local page for marking where each quote is spoken in its YouTube clip.
Every entry with a YouTube link is listed, with or without a saved start. Run
the spike with --labels to score against these times.

  --input <file>   JSON array or JSON Lines from \`convex data quoteSubmissions\`
  --labels <file>  Labels file to create or update (default: next to the input)
  --port <n>       Port on 127.0.0.1 (default ${String(DEFAULT_PORT)})

Input and labels must be outside the repository: they hold production quotes.`;

/**
 * Replace a file in one step, readable only by you.
 *
 * @param {string} file
 * @param {unknown} value
 */
async function writePrivateJson(file, value) {
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** @param {IncomingMessage} request */
async function readBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Body too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Serve the labeling page for an export on 127.0.0.1. Only this machine's
 * browser can reach it: the Host must be the loopback address, and label
 * writes must be same-origin JSON.
 *
 * @param {{ input: string; labels: string; port?: number }} options
 */
export async function startLabelServer(options) {
  assertOutsideRepository(options.input);
  assertOutsideRepository(options.labels);
  const { clips } = selectClipRows(
    readRows(await readFile(options.input, "utf8"))
  );
  const ids = new Set(clips.map((clip) => clip.id));
  /** @type {Record<string, QuoteLabel>} */
  let labels = {};
  try {
    labels = parseLabels(await readFile(options.labels, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const page = await readFile(PAGE, "utf8");

  // Label writes run one at a time so none is lost to another.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /** @param {(current: Record<string, QuoteLabel>) => Record<string, QuoteLabel>} change */
  const update = (change) => {
    const run = queue.then(async () => {
      const next = change(labels);
      await writePrivateJson(options.labels, next);
      labels = next;
      return next;
    });
    queue = run.catch(() => undefined);
    return run;
  };

  /** @type {Set<string>} */
  const hosts = new Set();

  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   */
  const handle = async (request, response) => {
    if (!hosts.has(request.headers.host ?? ""))
      return sendJson(response, 421, { error: "Unexpected host." });
    const origin = request.headers.origin;
    if (origin !== undefined && !hosts.has(origin.replace(/^http:\/\//, "")))
      return sendJson(response, 403, { error: "Cross-origin request." });
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");

    if (pathname === "/" && request.method === "GET") {
      const nonce = randomBytes(16).toString("base64");
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // YouTube embeds refuse to play without the page's origin as referrer.
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": [
          "default-src 'none'",
          `script-src 'nonce-${nonce}' https://www.youtube.com https://s.ytimg.com`,
          `style-src 'nonce-${nonce}'`,
          "frame-src https://www.youtube.com",
          "img-src 'self' data: https://i.ytimg.com",
          "connect-src 'self'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      });
      return response.end(page.replaceAll("{{nonce}}", nonce));
    }

    if (pathname === "/api/queue" && request.method === "GET")
      return sendJson(response, 200, {
        labelsFile: options.labels,
        clips,
        labels,
      });

    const match = /^\/api\/labels\/([^/]+)$/.exec(pathname);
    if (!match) return sendJson(response, 404, { error: "Not found." });
    const id = decodeURIComponent(match[1] ?? "");
    if (!ids.has(id))
      return sendJson(response, 404, { error: "Unknown entry." });

    if (request.method === "PUT") {
      if (
        !(request.headers["content-type"] ?? "").startsWith("application/json")
      )
        return sendJson(response, 415, { error: "Send JSON." });
      /** @type {unknown} */
      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        return sendJson(response, 400, { error: "Send a JSON label." });
      }
      const label = labelSchema.safeParse(body);
      if (!label.success)
        return sendJson(response, 400, {
          error: label.error.issues[0]?.message ?? "Invalid label.",
        });
      const next = await update((current) => ({
        ...current,
        [id]: label.data,
      }));
      return sendJson(response, 200, { labels: next });
    }

    if (request.method === "DELETE") {
      const next = await update((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== id)
        )
      );
      return sendJson(response, 200, { labels: next });
    }

    return sendJson(response, 405, { error: "Method not allowed." });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, { error: "The label was not saved." });
      else response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_PORT, "127.0.0.1", () =>
      resolve(undefined)
    );
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  hosts.add(`127.0.0.1:${String(port)}`);
  hosts.add(`localhost:${String(port)}`);
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    clipCount: clips.length,
    labeledCount: () => Object.keys(labels).length,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}

/**
 * Start the labeling page from the command line.
 *
 * @param {string[]} [argv]
 */
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      labels: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return null;
  }
  if (!values.input)
    throw new Error("--input is required. Run with --help for usage.");
  const input = path.resolve(values.input);
  const labels = path.resolve(
    values.labels ??
      path.join(
        path.dirname(input),
        `${path.basename(input, path.extname(input))}.labels.json`
      )
  );
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("--port must be an integer from 1 to 65535.");
  const labeler = await startLabelServer({ input, labels, port });
  console.log(
    `Labeling ${String(labeler.clipCount)} clips (${String(
      labeler.labeledCount()
    )} labeled so far) at ${
      labeler.url
    }\nSaving to ${labels}\nPress Ctrl+C to stop.`
  );
  return labeler;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "The label server failed."
    );
    process.exitCode = 1;
  });
}
