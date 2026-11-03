import type { CheckoutResult } from "./sandbox";

export type CheckoutWindowInput = Readonly<{
	autoComplete: CheckoutResult | null;
	callbackUrl: string;
	fields: Readonly<Record<CheckoutResult, Readonly<Record<string, string>>>>;
	goods: string;
	payerName: string;
	total: number;
}>;

const cards = [
	"신한카드",
	"KB국민카드",
	"삼성카드",
	"현대카드",
	"롯데카드",
	"하나카드",
	"우리카드",
	"BC카드",
];

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
	);

function resultForm(result: CheckoutResult, input: CheckoutWindowInput) {
	const hidden = Object.entries(input.fields[result])
		.map(
			([name, value]) =>
				`<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
		)
		.join("");
	return `<form id="form-${result}" method="POST" action="${escapeHtml(input.callbackUrl)}">${hidden}</form>`;
}

/** The hosted card window rendered inside the PC layer iframe or the mobile popup. */
export function checkoutWindowHtml(input: CheckoutWindowInput) {
	const amount = `${input.total.toLocaleString("ko-KR")}원`;
	const cardOptions = cards
		.map(
			(card, index) =>
				`<label class="card"><input type="radio" name="card" value="${card}"${index === 0 ? " checked" : ""}><span>${card}</span></label>`,
		)
		.join("");
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>페이플 샌드박스 결제</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Segoe UI",sans-serif;color:#0f172a;background:#fff;-webkit-font-smoothing:antialiased}
.page{min-height:100%;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f1f5f9}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;letter-spacing:-.01em}
.logo{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#3b82f6,#6366f1);display:grid;place-items:center;color:#fff;font-size:13px}
.badge{font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;border-radius:999px;padding:3px 8px}
.x{border:0;background:none;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:4px}
main{flex:1;padding:24px 20px;display:flex;flex-direction:column;gap:24px}
.summary{display:flex;flex-direction:column;gap:6px}
.goods{font-size:14px;color:#64748b}
.amount{font-size:30px;font-weight:800;letter-spacing:-.02em}
.payer{font-size:13px;color:#94a3b8}
h2{margin:0 0 10px;font-size:14px;font-weight:700;color:#334155}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.card{position:relative;display:block;cursor:pointer}
.card input{position:absolute;opacity:0}
.card span{display:block;padding:13px 12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;text-align:center;transition:all .15s}
.card input:checked+span{border-color:#3b82f6;background:#eff6ff;color:#1d4ed8;box-shadow:0 0 0 1px #3b82f6}
.card input:focus-visible+span{outline:2px solid #1d4ed8;outline-offset:2px}
.notice{font-size:12px;line-height:1.6;color:#64748b;background:#f8fafc;border-radius:12px;padding:12px 14px}
footer{position:sticky;bottom:0;background:#fff;padding:16px 20px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;border-top:1px solid #f1f5f9}
.pay{height:52px;border:0;border-radius:14px;background:#2563eb;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.pay:hover{background:#1d4ed8}
.sub{display:flex;gap:8px}
.sub button{flex:1;height:44px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer}
.sub button:hover{background:#f8fafc}
.processing{position:fixed;inset:0;display:none;place-items:center;align-content:center;gap:14px;background:rgba(255,255,255,.92);font-size:15px;font-weight:600;color:#334155}
.processing.on{display:grid}
.spinner{width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="page">
<header>
<div class="brand"><span class="logo">P</span>payple<span class="badge">SANDBOX</span></div>
<button class="x" type="button" aria-label="결제창 닫기" data-result="close">×</button>
</header>
<main>
<section class="summary">
<div class="goods">${escapeHtml(input.goods || "주문 상품")}</div>
<div class="amount">${amount}</div>
${input.payerName ? `<div class="payer">${escapeHtml(input.payerName)}님</div>` : ""}
</section>
<section><h2>카드 선택</h2><div class="cards">${cardOptions}</div></section>
<div class="notice">테스트용 결제창이에요. 실제 카드 결제는 일어나지 않아요.<br>“카드사 거절”로 실패 흐름도 확인할 수 있어요.</div>
</main>
<footer>
<button class="pay" type="button" data-result="approve" data-testid="payple-sandbox-approve">${amount} 결제하기</button>
<div class="sub">
<button type="button" data-result="decline" data-testid="payple-sandbox-decline">카드사 거절</button>
<button type="button" data-result="close" data-testid="payple-sandbox-close">결제 취소</button>
</div>
</footer>
</div>
<div class="processing" role="status" aria-live="polite"><div class="spinner"></div><span>결제를 처리하고 있어요</span></div>
${resultForm("approve", input)}${resultForm("decline", input)}${resultForm("close", input)}
<script>
const submit = (result) => {
  document.querySelector(".processing").classList.add("on");
  document.getElementById("form-" + result).submit();
};
document.querySelectorAll("[data-result]").forEach((button) => {
  button.addEventListener("click", () => submit(button.dataset.result));
});
const auto = ${JSON.stringify(input.autoComplete)};
if (auto) setTimeout(() => submit(auto), 300);
</script>
</body>
</html>`;
}
