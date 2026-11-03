// Payple domestic app-card (CERT) sandbox: partner auth, approval confirm,
// single/list lookup and cumulative cancellation, a hosted checkout script and a
// control API under `/__sandbox`. It never talks to Payple or moves money.
import { checkoutScript } from "./checkout-script";

export type SandboxCredentials = Readonly<{
	clientKey: string;
	cstId: string;
	custKey: string;
	refundKey: string;
}>;

export type SandboxScenario = {
	/** Result of the next approval confirmations. */
	approvalConfirm: "ok" | "reject" | "timeout" | "amount_mismatch" | "server_error";
	/** Browser checkouts settle themselves without a click (for browser agents). */
	autoComplete: CheckoutResult | null;
	cancel: "ok" | "reject" | "timeout";
	/** `unavailable` makes the hosted script fail to load. */
	checkoutScript: "ok" | "unavailable";
	lookup: "ok" | "server_error";
};

export type CheckoutResult = "approve" | "decline" | "close";

type SandboxPayment = {
	authKey: string;
	/** Remaining (not cancelled) KRW. */
	balance: number;
	callbackUrl: string;
	createdAt: string;
	goods: string;
	oid: string;
	paidAt: string | null;
	payerName: string;
	reqKey: string;
	state: "pending" | "paid" | "declined" | "closed";
	total: number;
};

export type SandboxState = {
	payments: Record<string, SandboxPayment>;
	scenario: SandboxScenario;
};

export type SandboxOptions = Readonly<{
	/** Merchant app origins allowed to open checkouts from the browser. */
	appOrigins: readonly string[];
	credentials: SandboxCredentials;
	/** Public HTTPS origin the merchant server and browser reach the sandbox at. */
	origin: string;
	/** How long `timeout` scenarios hold the response (merchants usually give up at ~10s). */
	timeoutDelayMs?: number;
	now?: () => Date;
	fetch?: typeof fetch;
	onStateChange?: (state: SandboxState) => void;
	initialState?: SandboxState;
}>;

export const defaultSandboxScenario: SandboxScenario = {
	approvalConfirm: "ok",
	autoComplete: null,
	cancel: "ok",
	checkoutScript: "ok",
	lookup: "ok",
};

const listPageSize = 100;

function kstParts(date: Date) {
	const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
	return {
		date: shifted.slice(0, 10).replaceAll("-", ""),
		time: shifted.slice(0, 19).replace(/[-:T]/g, ""),
	};
}

function json(body: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(body), { ...init, headers });
}

function rejected(code: string, message: string, extra: Record<string, unknown> = {}) {
	return json({
		PCD_PAY_CODE: code,
		PCD_PAY_MSG: message,
		PCD_PAY_RST: "error",
		...extra,
	});
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const text = await request.text();
	if (!text) return {};
	// `curl -d '{...}'` sends JSON as form-urlencoded, so sniff the body too.
	if (
		(request.headers.get("Content-Type") ?? "").includes("json") ||
		text.trimStart().startsWith("{")
	) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return {};
		}
		return isRecord(parsed) ? parsed : {};
	}
	return Object.fromEntries(new URLSearchParams(text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const checkoutResults: readonly CheckoutResult[] = ["approve", "decline", "close"];
function parseCheckoutResult(value: unknown): CheckoutResult | null {
	return checkoutResults.find((result) => result === value) ?? null;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function createPaypleSandbox(options: SandboxOptions) {
	const now = options.now ?? (() => new Date());
	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	const timeoutDelayMs = options.timeoutDelayMs ?? 12_000;
	const send = options.fetch ?? fetch;
	const { credentials } = options;
	const issuedAuthKeys = new Set<string>();
	const state: SandboxState = options.initialState ?? {
		payments: {},
		scenario: { ...defaultSandboxScenario },
	};
	const changed = () => options.onStateChange?.(state);

	function cors(request: Request, response: Response) {
		const origin = request.headers.get("Origin");
		if (origin && options.appOrigins.includes(origin)) {
			response.headers.set("Access-Control-Allow-Origin", origin);
			response.headers.set("Access-Control-Allow-Headers", "Content-Type");
			response.headers.set("Vary", "Origin");
		}
		return response;
	}

	function registerCheckout(input: {
		callbackUrl: string;
		goods?: string;
		oid: string;
		payerName?: string;
		total: number;
	}) {
		const existing = state.payments[input.oid];
		if (existing && existing.state !== "pending") return existing;
		const payment: SandboxPayment = {
			authKey: crypto.randomUUID(),
			balance: input.total,
			callbackUrl: input.callbackUrl,
			createdAt: now().toISOString(),
			goods: input.goods ?? "",
			oid: input.oid,
			paidAt: null,
			payerName: input.payerName ?? "",
			reqKey: crypto.randomUUID(),
			state: "pending",
			total: input.total,
		};
		state.payments[input.oid] = payment;
		changed();
		return payment;
	}

	/** Form fields Payple posts to the merchant `PCD_RST_URL` for a CERT result. */
	function callbackFields(payment: SandboxPayment, result: CheckoutResult) {
		const base = {
			PCD_PAY_OID: payment.oid,
			PCD_PAY_TYPE: "card",
			PCD_PAY_WORK: "CERT",
		};
		if (result === "approve") {
			return {
				...base,
				PCD_AUTH_KEY: payment.authKey,
				PCD_PAY_CODE: "0000",
				PCD_PAY_COFURL: `${options.origin}/api/v1/payments/cards/approval/confirm`,
				PCD_PAY_MSG: "카드 인증 완료",
				PCD_PAY_REQKEY: payment.reqKey,
				PCD_PAY_RST: "success",
			};
		}
		return result === "decline"
			? {
					...base,
					PCD_PAY_CODE: "CARD0051",
					PCD_PAY_MSG: "카드사 승인 거절",
					PCD_PAY_RST: "error",
				}
			: {
					...base,
					PCD_PAY_CODE: "PAYC0001",
					PCD_PAY_MSG: "결제창을 닫았습니다",
					PCD_PAY_RST: "close",
				};
	}

	function settle(payment: SandboxPayment, result: CheckoutResult) {
		if (payment.state !== "pending") return;
		if (result !== "approve") {
			payment.state = result === "decline" ? "declined" : "closed";
			changed();
		}
	}

	function capture(payment: SandboxPayment, amount = payment.total) {
		payment.state = "paid";
		payment.paidAt = now().toISOString();
		payment.total = amount;
		payment.balance = amount;
		changed();
	}

	function lookupRow(payment: SandboxPayment) {
		const time = kstParts(new Date(payment.paidAt ?? payment.createdAt)).time;
		return {
			PCD_CST_ID: credentials.cstId,
			PCD_PAY_AMOUNT: String(payment.total),
			PCD_PAY_OID: payment.oid,
			PCD_PAY_STATE:
				payment.balance === payment.total
					? "결제완료"
					: payment.balance === 0
						? "승인취소완료"
						: "부분승인취소완료",
			PCD_PAY_TIME: time,
			PCD_PAY_TOTAL: String(payment.balance),
			PCD_PAY_TYPE: "card",
		};
	}

	function authorized(body: Record<string, unknown>) {
		return (
			issuedAuthKeys.has(text(body.PCD_AUTH_KEY)) && text(body.PCD_CST_ID) === credentials.cstId
		);
	}

	async function partnerAuth(body: Record<string, unknown>) {
		if (text(body.cst_id) !== credentials.cstId || text(body.custKey) !== credentials.custKey) {
			return json({ result: "error", result_msg: "가맹점 인증 실패" });
		}
		const authKey = crypto.randomUUID();
		issuedAuthKeys.add(authKey);
		const search =
			body.PCD_PAY_WORK === "PUSERINFO"
				? "?ACT_=PUSERINFO"
				: body.PCD_SIMPLE_FLAG === "Y"
					? "?ACT_=PAYM"
					: "";
		return json({
			AuthKey: authKey,
			cst_id: credentials.cstId,
			custKey: credentials.custKey,
			result: "success",
			return_url: `${options.origin}/php/api.php${search}`,
		});
	}

	async function approvalConfirm(body: Record<string, unknown>) {
		if (
			text(body.PCD_CST_ID) !== credentials.cstId ||
			text(body.PCD_CUST_KEY) !== credentials.custKey
		) {
			return rejected("PCCF0001", "가맹점 인증 실패");
		}
		const payment = Object.values(state.payments).find(
			(candidate) =>
				candidate.authKey === text(body.PCD_AUTH_KEY) &&
				candidate.reqKey === text(body.PCD_PAY_REQKEY),
		);
		if (!payment) return rejected("PCCF0002", "인증 정보를 찾을 수 없습니다");
		if (payment.state === "paid")
			return json({
				PCD_PAY_CODE: "PCCF0007",
				PCD_PAY_MSG: "이미 승인된 결제입니다",
				PCD_PAY_RST: "failed",
			});
		const scenario = state.scenario.approvalConfirm;
		if (scenario === "reject") {
			payment.state = "declined";
			changed();
			return rejected("PCCF0003", "승인 거절", { PCD_PAY_OID: payment.oid });
		}
		if (scenario === "server_error") return json({ message: "sandbox error" }, { status: 500 });
		capture(payment, scenario === "amount_mismatch" ? payment.total - 1_000 : payment.total);
		if (scenario === "timeout") await sleep(timeoutDelayMs);
		return json({
			PCD_PAY_CARDNAME: "샌드박스카드",
			PCD_PAY_CARDTRADENUM: `SBX${Date.now()}`,
			PCD_PAY_CODE: "0000",
			PCD_PAY_MSG: "승인 완료",
			PCD_PAY_OID: payment.oid,
			PCD_PAY_RST: "success",
			PCD_PAY_TIME: kstParts(now()).time,
			PCD_PAY_TOTAL: String(payment.total),
			PCD_PAY_TYPE: "card",
		});
	}

	async function domesticApi(body: Record<string, unknown>) {
		if (!authorized(body)) return rejected("PAUT0001", "인증 키가 올바르지 않습니다");
		if (body.PCD_PAYCHK_FLAG === "Y") {
			if (state.scenario.lookup === "server_error") return json({}, { status: 500 });
			const payment = state.payments[text(body.PCD_PAY_OID)];
			const sameDay =
				payment?.paidAt && kstParts(new Date(payment.paidAt)).date === text(body.PCD_PAY_DATE);
			if (!payment || payment.state !== "paid" || !sameDay) {
				return rejected("PCHK0002", "결제 내역이 없습니다", {
					PCD_PAY_OID: text(body.PCD_PAY_OID),
					PCD_PAY_TYPE: "card",
				});
			}
			const row = lookupRow(payment);
			return json({
				PCD_PAY_CODE: "0000",
				PCD_PAY_OID: payment.oid,
				PCD_PAY_RST: "success",
				PCD_PAY_TIME: row.PCD_PAY_TIME,
				PCD_PAY_TOTAL: row.PCD_PAY_TOTAL,
				PCD_PAY_TYPE: "card",
			});
		}
		if (body.PCD_PAYCHK_LIST_FLAG === "Y") {
			if (state.scenario.lookup === "server_error") return json({}, { status: 500 });
			const start = text(body.PCD_START_DATE);
			const end = text(body.PCD_END_DATE);
			const rows = Object.values(state.payments)
				.filter((payment) => payment.paidAt)
				.filter((payment) => {
					const date = kstParts(new Date(payment.paidAt ?? "")).date;
					return date >= start && date <= end;
				})
				.sort((a, b) => a.oid.localeCompare(b.oid));
			const offset = Number(text(body.PCD_LASTKEY) || "0");
			const page = rows.slice(offset, offset + listPageSize);
			const hasMore = offset + listPageSize < rows.length;
			return json({
				PCD_DATA: {
					PCD_CONTENT: page.map(lookupRow),
					PCD_HAS_MORE: hasMore,
					PCD_LASTKEY: hasMore ? String(offset + listPageSize) : null,
				},
				PCD_PAY_CODE: "0000",
				PCD_PAY_RST: "success",
			});
		}
		if (body.PCD_PAYCANCEL_FLAG === "Y") {
			if (text(body.PCD_REFUND_KEY) !== credentials.refundKey) {
				return rejected("PCCN0001", "환불 키가 올바르지 않습니다");
			}
			const payment = state.payments[text(body.PCD_PAY_OID)];
			const amount = Number(text(body.PCD_REFUND_TOTAL));
			if (!payment || payment.state !== "paid")
				return rejected("PCCN0002", "취소할 결제가 없습니다");
			if (!Number.isSafeInteger(amount) || amount <= 0 || amount > payment.balance) {
				return rejected("PCCN0003", "취소 금액이 잔액을 넘습니다");
			}
			if (state.scenario.cancel === "reject") return rejected("PCCN0004", "취소 거절");
			payment.balance -= amount;
			changed();
			if (state.scenario.cancel === "timeout") await sleep(timeoutDelayMs);
			return json({
				PCD_PAY_CODE: "0000",
				PCD_PAY_MSG: "취소 완료",
				PCD_PAY_OID: payment.oid,
				PCD_PAY_RST: "success",
				PCD_PAY_TYPE: "card",
				PCD_REFUND_TOTAL: String(amount),
			});
		}
		return rejected("PAPI0001", "샌드박스가 지원하지 않는 요청이에요");
	}

	/** Delivers a CERT result to the merchant exactly like the hosted window would. */
	async function deliverCallback(payment: SandboxPayment, result: CheckoutResult) {
		settle(payment, result);
		const response = await send(payment.callbackUrl, {
			body: new URLSearchParams(callbackFields(payment, result)),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			method: "POST",
			redirect: "manual",
		});
		return { callbackStatus: response.status, oid: payment.oid, result };
	}

	async function control(request: Request, path: string) {
		const body = await readBody(request);
		if (path === "/__sandbox/state" && request.method === "GET") return json(state);
		if (path === "/__sandbox/reset" && request.method === "POST") {
			state.payments = {};
			state.scenario = { ...defaultSandboxScenario };
			changed();
			return json(state);
		}
		if (path === "/__sandbox/scenario" && request.method === "POST") {
			for (const key of Object.keys(defaultSandboxScenario) as Array<keyof SandboxScenario>) {
				if (key in body) Object.assign(state.scenario, { [key]: body[key] });
			}
			changed();
			return json(state.scenario);
		}
		const match = path.match(/^\/__sandbox\/payments\/([A-Za-z0-9._-]{1,64})\/(complete|capture)$/);
		if (match && request.method === "POST") {
			const oid = match[1] ?? "";
			const action = match[2];
			const payment =
				state.payments[oid] ??
				(Number(body.total) > 0
					? registerCheckout({
							callbackUrl: text(body.callbackUrl),
							oid,
							total: Number(body.total),
						})
					: null);
			if (!payment)
				return json(
					{
						error: "모르는 주문번호예요. 새로 등록하려면 total(과 callbackUrl)을 넘겨 주세요.",
					},
					{ status: 404 },
				);
			if (action === "capture") {
				capture(payment);
				return json(payment);
			}
			const result = body.result === undefined ? "approve" : parseCheckoutResult(body.result);
			if (!result)
				return json(
					{ error: "result는 approve, decline, close 중 하나여야 해요" },
					{ status: 400 },
				);
			if (!payment.callbackUrl) return json({ error: "callbackUrl이 필요해요" }, { status: 400 });
			return json(await deliverCallback(payment, result));
		}
		return json({ error: "없는 제어 주소예요" }, { status: 404 });
	}

	async function handle(request: Request): Promise<Response> {
		const url = URL.parse(request.url);
		if (!url) return new Response("Bad request", { status: 400 });
		if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
		if (url.pathname === "/js/v1/payment.js" || url.pathname === "/js/cpay.js") {
			if (state.scenario.checkoutScript === "unavailable")
				return new Response("unavailable", { status: 503 });
			return new Response(checkoutScript(options.origin), {
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "application/javascript; charset=utf-8",
				},
			});
		}
		if (url.pathname === "/__sandbox/checkouts" && request.method === "POST") {
			const body = await readBody(request);
			if (text(body.clientKey) !== credentials.clientKey) {
				return cors(request, json({ error: "clientKey가 맞지 않아요" }, { status: 403 }));
			}
			const payment = registerCheckout({
				callbackUrl: text(body.rstUrl),
				goods: text(body.goods),
				oid: text(body.oid),
				payerName: text(body.payerName),
				total: Number(body.total),
			});
			return cors(
				request,
				json({
					autoComplete: state.scenario.autoComplete,
					fields: {
						approve: callbackFields(payment, "approve"),
						close: callbackFields(payment, "close"),
						decline: callbackFields(payment, "decline"),
					},
				}),
			);
		}
		if (url.pathname.startsWith("/__sandbox/")) return control(request, url.pathname);
		if (request.method !== "POST") return new Response("Not found", { status: 404 });
		const body = await readBody(request);
		if (url.pathname === "/php/auth.php") return partnerAuth(body);
		if (url.pathname === "/php/api.php") return domesticApi(body);
		if (url.pathname === "/api/v1/payments/cards/approval/confirm") return approvalConfirm(body);
		return new Response("Not found", { status: 404 });
	}

	return { handle, state };
}
