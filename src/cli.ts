#!/usr/bin/env bun
// payple-sandbox CLI: serves the sandbox over HTTP and prints merchant settings.
// Payple URLs must be HTTPS for most merchant SDKs, so put a TLS front
// (Caddy, Tailscale serve, portless, ngrok, …) before it or pass --tls-cert/--tls-key.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type SandboxState, createPaypleSandbox } from "./sandbox";

const { values } = parseArgs({
	options: {
		"app-origin": { multiple: true, short: "a", type: "string" },
		"client-key": { type: "string" },
		"cst-id": { type: "string" },
		"cust-key": { type: "string" },
		help: { short: "h", type: "boolean" },
		origin: { short: "o", type: "string" },
		port: { short: "p", type: "string" },
		"refund-key": { type: "string" },
		state: { short: "s", type: "string" },
		"tls-cert": { type: "string" },
		"tls-key": { type: "string" },
	},
});

if (values.help) {
	console.log(`payple-sandbox — local Payple app-card sandbox

Usage: payple-sandbox [options]

  -p, --port <port>          Listen port (env PAYPLE_SANDBOX_PORT, default 9444)
  -o, --origin <url>         Public HTTPS origin (env PAYPLE_SANDBOX_ORIGIN)
  -a, --app-origin <url>     Merchant origin allowed to open checkouts (repeatable,
                             env PAYPLE_SANDBOX_APP_ORIGINS comma list)
  -s, --state <file>         Persist state to a JSON file (env PAYPLE_SANDBOX_STATE_FILE)
      --cst-id, --cust-key, --client-key, --refund-key
                             Merchant credentials (defaults: sandbox values)
      --tls-cert, --tls-key  Serve HTTPS directly
  -h, --help                 Show this help`);
	process.exit(0);
}

const env = process.env;
const port = Number(values.port ?? env.PAYPLE_SANDBOX_PORT ?? 9444);
const useTls = Boolean(values["tls-cert"] && values["tls-key"]);
const origin =
	values.origin ?? env.PAYPLE_SANDBOX_ORIGIN ?? `${useTls ? "https" : "http"}://localhost:${port}`;
const appOrigins =
	values["app-origin"] ??
	(env.PAYPLE_SANDBOX_APP_ORIGINS ?? "http://localhost:3000")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
const stateFile = values.state ?? env.PAYPLE_SANDBOX_STATE_FILE;
const credentials = {
	clientKey: values["client-key"] ?? env.PAYPLE_SANDBOX_CLIENT_KEY ?? "sandbox-client-key",
	cstId: values["cst-id"] ?? env.PAYPLE_SANDBOX_CST_ID ?? "sandbox",
	custKey: values["cust-key"] ?? env.PAYPLE_SANDBOX_CUST_KEY ?? "sandbox-cust-key",
	refundKey: values["refund-key"] ?? env.PAYPLE_SANDBOX_REFUND_KEY ?? "sandbox-refund-key",
};

function loadState(): SandboxState | undefined {
	if (!stateFile || !existsSync(stateFile)) return undefined;
	try {
		return JSON.parse(readFileSync(stateFile, "utf8"));
	} catch {
		return undefined;
	}
}

const sandbox = createPaypleSandbox({
	appOrigins,
	credentials,
	initialState: loadState(),
	onStateChange: stateFile
		? (state) => {
				mkdirSync(path.dirname(path.resolve(stateFile)), { recursive: true });
				writeFileSync(stateFile, JSON.stringify(state, null, 2));
			}
		: undefined,
	origin,
});

Bun.serve({
	fetch: sandbox.handle,
	idleTimeout: 60,
	port,
	...(useTls
		? {
				tls: {
					cert: Bun.file(values["tls-cert"] ?? ""),
					key: Bun.file(values["tls-key"] ?? ""),
				},
			}
		: {}),
});

console.log(`payple-sandbox listening on ${useTls ? "https" : "http"}://0.0.0.0:${port}
public origin: ${origin}
allowed app origins: ${appOrigins.join(", ")}${stateFile ? `\nstate file: ${stateFile}` : ""}

Merchant settings:
  cst_id          ${credentials.cstId}
  custKey         ${credentials.custKey}
  clientKey       ${credentials.clientKey}
  refundKey       ${credentials.refundKey}
  API base        ${origin}
  approval URL    ${origin}/api/v1/payments/cards/approval/confirm
  checkout script ${origin}/js/v1/payment.js

Control API: ${origin}/__sandbox/state`);
