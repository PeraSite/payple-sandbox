import { describe, expect, it } from "bun:test";
import { createPaypleSandbox } from "../src";

const origin = "https://payple.sandbox.test";
const callbackUrl = "https://shop.test/payple/callback";
const credentials = { clientKey: "client", cstId: "shop", custKey: "cust", refundKey: "refund" };
const oid = "order_1";

function kstDate(date = new Date()) {
	return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10).replaceAll("-", "");
}

function setup() {
	const callbacks: Array<Record<string, string>> = [];
	const sandbox = createPaypleSandbox({
		appOrigins: ["https://shop.test"],
		credentials,
		fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
			callbacks.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
			return new Response("ok");
		}) as typeof fetch,
		origin,
		timeoutDelayMs: 30,
	});
	const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
		sandbox
			.handle(
				new Request(`${origin}${path}`, {
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json", ...headers },
					method: "POST",
				}),
			)
			.then(async (response) => ({ body: await response.json(), status: response.status }));
	const partnerAuth = async (extra: Record<string, string> = {}) =>
		(await post("/php/auth.php", { cst_id: "shop", custKey: "cust", ...extra })).body
			.AuthKey as string;
	const api = async (body: Record<string, unknown>) =>
		(await post("/php/api.php", { PCD_AUTH_KEY: await partnerAuth(), PCD_CST_ID: "shop", ...body }))
			.body;
	const complete = (result = "approve") =>
		post(`/__sandbox/payments/${oid}/complete`, { callbackUrl, result, total: 30_000 });
	const confirm = () => {
		const callback = callbacks.at(-1) ?? {};
		return post("/api/v1/payments/cards/approval/confirm", {
			PCD_AUTH_KEY: callback.PCD_AUTH_KEY,
			PCD_CST_ID: "shop",
			PCD_CUST_KEY: "cust",
			PCD_PAY_REQKEY: callback.PCD_PAY_REQKEY,
		});
	};
	const lookup = () => api({ PCD_PAYCHK_FLAG: "Y", PCD_PAY_DATE: kstDate(), PCD_PAY_OID: oid });
	return { api, callbacks, complete, confirm, lookup, partnerAuth, post, sandbox };
}

describe("partner auth", () => {
	it("issues an AuthKey for valid credentials only", async () => {
		const env = setup();
		expect(await env.partnerAuth()).toBeString();
		const bad = await env.post("/php/auth.php", { cst_id: "shop", custKey: "wrong" });
		expect(bad.body.result).toBe("error");
	});

	it("rejects API calls without an issued AuthKey", async () => {
		const env = setup();
		const res = await env.post("/php/api.php", {
			PCD_AUTH_KEY: "forged",
			PCD_CST_ID: "shop",
			PCD_PAYCHK_FLAG: "Y",
		});
		expect(res.body.PCD_PAY_CODE).toBe("PAUT0001");
	});
});

describe("CERT checkout", () => {
	it("is missing until approved, then paid, then duplicate", async () => {
		const env = setup();
		await env.complete();
		expect((await env.lookup()).PCD_PAY_CODE).toBe("PCHK0002");
		expect(env.callbacks[0]).toMatchObject({
			PCD_PAY_OID: oid,
			PCD_PAY_RST: "success",
			PCD_PAY_WORK: "CERT",
		});

		const approved = await env.confirm();
		expect(approved.body).toMatchObject({ PCD_PAY_RST: "success", PCD_PAY_TOTAL: "30000" });
		expect(await env.lookup()).toMatchObject({ PCD_PAY_RST: "success", PCD_PAY_TOTAL: "30000" });
		expect((await env.confirm()).body.PCD_PAY_CODE).toBe("PCCF0007");
	});

	it("delivers decline and close without capturing money", async () => {
		for (const result of ["decline", "close"]) {
			const env = setup();
			await env.complete(result);
			expect(env.callbacks[0]?.PCD_PAY_RST).toBe(result === "decline" ? "error" : "close");
			expect(env.sandbox.state.payments[oid]?.state).toBe(
				result === "decline" ? "declined" : "closed",
			);
		}
	});

	it("opens checkouts from allowed origins with the right clientKey", async () => {
		const env = setup();
		const body = { clientKey: "client", oid, rstUrl: callbackUrl, total: 1000 };
		const ok = await env.sandbox.handle(
			new Request(`${origin}/__sandbox/checkouts`, {
				body: JSON.stringify(body),
				headers: { Origin: "https://shop.test" },
				method: "POST",
			}),
		);
		expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://shop.test");
		expect((await env.post("/__sandbox/checkouts", { ...body, clientKey: "nope" })).status).toBe(
			403,
		);
	});
});

describe("cancellation", () => {
	it("is cumulative and visible in list lookup", async () => {
		const env = setup();
		await env.complete();
		await env.confirm();
		const cancel = (amount: number) =>
			env.api({
				PCD_PAYCANCEL_FLAG: "Y",
				PCD_PAY_OID: oid,
				PCD_REFUND_KEY: "refund",
				PCD_REFUND_TOTAL: String(amount),
			});
		const list = async () =>
			(
				await env.api({
					PCD_END_DATE: kstDate(),
					PCD_PAYCHK_LIST_FLAG: "Y",
					PCD_START_DATE: kstDate(),
				})
			).PCD_DATA.PCD_CONTENT[0];

		expect((await cancel(5_000)).PCD_PAY_RST).toBe("success");
		expect(await list()).toMatchObject({
			PCD_PAY_STATE: "부분승인취소완료",
			PCD_PAY_TOTAL: "25000",
		});
		await cancel(25_000);
		expect(await list()).toMatchObject({ PCD_PAY_STATE: "승인취소완료", PCD_PAY_TOTAL: "0" });
		expect((await cancel(1)).PCD_PAY_CODE).toBe("PCCN0003");
	});

	it("requires the refund key", async () => {
		const env = setup();
		await env.complete();
		await env.confirm();
		const res = await env.api({
			PCD_PAYCANCEL_FLAG: "Y",
			PCD_PAY_OID: oid,
			PCD_REFUND_KEY: "x",
			PCD_REFUND_TOTAL: "1",
		});
		expect(res.PCD_PAY_CODE).toBe("PCCN0001");
	});
});

describe("scenarios", () => {
	it("captures less than requested on amount_mismatch", async () => {
		const env = setup();
		await env.post("/__sandbox/scenario", { approvalConfirm: "amount_mismatch" });
		await env.complete();
		expect((await env.confirm()).body.PCD_PAY_TOTAL).toBe("29000");
	});

	it("captures money but answers late on timeout", async () => {
		const env = setup();
		await env.post("/__sandbox/scenario", { approvalConfirm: "timeout" });
		await env.complete();
		const started = performance.now();
		const pending = env.confirm();
		await Bun.sleep(5);
		expect(env.sandbox.state.payments[oid]?.state).toBe("paid");
		await pending;
		expect(performance.now() - started).toBeGreaterThanOrEqual(25);
	});

	it("rejects approval and fails lookups on demand", async () => {
		const env = setup();
		await env.post("/__sandbox/scenario", { approvalConfirm: "reject", lookup: "server_error" });
		await env.complete();
		expect((await env.confirm()).body.PCD_PAY_CODE).toBe("PCCF0003");
		const lookup = await env.post("/php/api.php", {
			PCD_AUTH_KEY: await env.partnerAuth(),
			PCD_CST_ID: "shop",
			PCD_PAYCHK_FLAG: "Y",
		});
		expect(lookup.status).toBe(500);
	});

	it("ignores unknown scenario keys and resets", async () => {
		const env = setup();
		await env.post("/__sandbox/scenario", { autoComplete: "approve", bogus: 1 });
		expect(env.sandbox.state.scenario).not.toHaveProperty("bogus");
		await env.post("/__sandbox/reset", {});
		expect(env.sandbox.state.scenario.autoComplete).toBeNull();
	});

	it("can make the checkout script unavailable", async () => {
		const env = setup();
		expect((await env.sandbox.handle(new Request(`${origin}/js/v1/payment.js`))).status).toBe(200);
		await env.post("/__sandbox/scenario", { checkoutScript: "unavailable" });
		expect((await env.sandbox.handle(new Request(`${origin}/js/v1/payment.js`))).status).toBe(503);
	});
});
