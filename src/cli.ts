#!/usr/bin/env bun
// payple-sandbox 실행 파일: 샌드박스를 HTTP로 띄우고 가맹점 설정값을 보여줘요.
// HTTPS가 필요하면 앞에 TLS(Caddy, tailscale serve, portless, ngrok 등)를 두거나
// --tls-cert/--tls-key를 넘겨요.
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
	console.log(`payple-sandbox — 페이플 앱카드 결제 테스트 서버

사용법: payple-sandbox [옵션]

  -p, --port <포트>          서버 포트 (환경 변수 PAYPLE_SANDBOX_PORT, 기본 9444)
  -o, --origin <주소>        외부에서 접속할 HTTPS 주소 (PAYPLE_SANDBOX_ORIGIN)
  -a, --app-origin <주소>    결제창을 열 수 있는 내 서비스 주소 (여러 번 가능,
                             PAYPLE_SANDBOX_APP_ORIGINS 쉼표 구분)
  -s, --state <파일>         결제 기록을 JSON 파일에 저장 (PAYPLE_SANDBOX_STATE_FILE)
      --cst-id, --cust-key, --client-key, --refund-key
                             가맹점 키 (기본값: 샌드박스용 값)
      --tls-cert, --tls-key  직접 HTTPS로 실행
  -h, --help                 도움말`);
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

console.log(`payple-sandbox 실행 중: ${useTls ? "https" : "http"}://0.0.0.0:${port}
외부 주소: ${origin}
결제창 허용 주소: ${appOrigins.join(", ")}${stateFile ? `\n결제 기록 파일: ${stateFile}` : ""}

가맹점 설정값:
  cst_id          ${credentials.cstId}
  custKey         ${credentials.custKey}
  clientKey       ${credentials.clientKey}
  refundKey       ${credentials.refundKey}
  API 주소        ${origin}
  승인 요청 주소  ${origin}/api/v1/payments/cards/approval/confirm
  결제창 스크립트 ${origin}/js/v1/payment.js

제어 API: ${origin}/__sandbox/state`);
