import type { CheckoutResult } from "./sandbox";

export type CheckoutWindowInput = Readonly<{
	autoComplete: CheckoutResult | null;
	callbackUrl: string;
	/** Inside the PC layer iframe or mobile popup: report back with postMessage. */
	embedded: boolean;
	fields: Readonly<Record<CheckoutResult, Readonly<Record<string, string>>>>;
	goods: string;
	total: number;
}>;

type Method = Readonly<{
	color: string;
	id: string;
	label: string;
	mark: string;
	markColor?: string;
}>;

const easyPays: readonly Method[] = [
	{ color: "#03C75A", id: "naverpay", label: "네이버페이", mark: "N" },
	{ color: "#FEE500", id: "kakaopay", label: "카카오페이", mark: "K", markColor: "#191919" },
	{ color: "#0064FF", id: "tosspay", label: "토스페이", mark: "T" },
	{ color: "#FA2828", id: "payco", label: "페이코", mark: "P" },
	{ color: "#1428A0", id: "samsungpay", label: "삼성페이", mark: "S" },
	{ color: "#000000", id: "applepay", label: "애플페이", mark: "Pay" },
];

const cards: readonly Method[] = [
	{ color: "#0046FF", id: "shinhan", label: "신한", mark: "신" },
	{ color: "#FFBC00", id: "kb", label: "KB국민", mark: "KB", markColor: "#5C4A2E" },
	{ color: "#1428A0", id: "samsung", label: "삼성", mark: "삼" },
	{ color: "#222222", id: "hyundai", label: "현대", mark: "H" },
	{ color: "#E60012", id: "lotte", label: "롯데", mark: "L" },
	{ color: "#009490", id: "hana", label: "하나", mark: "하" },
	{ color: "#0067AC", id: "woori", label: "우리", mark: "우" },
	{ color: "#F04A50", id: "bc", label: "BC", mark: "BC" },
	{ color: "#00A651", id: "nh", label: "NH농협", mark: "NH" },
];

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
	);

function methodButtons(methods: readonly Method[], group: string) {
	return methods
		.map(
			(method) =>
				`<label class="method"><input type="radio" name="method" value="${group}:${method.id}"><span class="mark" style="background:${method.color};color:${method.markColor ?? "#fff"}">${method.mark}</span><span class="name">${method.label}</span></label>`,
		)
		.join("");
}

/** Payment window shown at the top level, in the PC layer iframe or in the mobile popup. */
export function checkoutWindowHtml(input: CheckoutWindowInput) {
	const amount = input.total.toLocaleString("ko-KR");
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>payple</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#222;background:#fff;-webkit-font-smoothing:antialiased;font-size:14px}
.page{min-height:100%;display:flex;flex-direction:column;max-width:450px;margin:0 auto}
header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid #eee}
.wordmark{font-size:20px;font-weight:800;letter-spacing:-.04em;color:#3a5bff}
.sandbox{margin-left:6px;font-size:10px;font-weight:700;color:#999;letter-spacing:.06em;vertical-align:middle}
.x{border:0;background:none;width:32px;height:32px;margin-right:-8px;font-size:26px;line-height:1;color:#999;cursor:pointer}
main{flex:1;padding:0 20px 20px}
.order{padding:20px 0;border-bottom:8px solid #f5f6f8;margin:0 -20px;padding-left:20px;padding-right:20px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:4px 0;color:#777}
.row b{color:#222;font-weight:600;text-align:right;word-break:keep-all}
.row.total b{font-size:22px;font-weight:800;color:#222}
.row.total b small{font-size:15px;font-weight:700;margin-left:1px}
h2{margin:24px 0 12px;font-size:15px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.method{position:relative;cursor:pointer}
.method input{position:absolute;opacity:0;pointer-events:none}
.method span.name{display:block;font-size:13px;font-weight:500;text-align:center;margin-top:6px;color:#444}
.method{display:flex;flex-direction:column;align-items:center;padding:12px 4px 10px;border:1px solid #e5e5e5;border-radius:8px;transition:border-color .12s,background .12s}
.method:has(input:checked){border-color:#3a5bff;background:#f3f5ff}
.method:has(input:checked) .name{color:#3a5bff;font-weight:700}
.method:has(input:focus-visible){outline:2px solid #3a5bff;outline-offset:2px}
.mark{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;letter-spacing:-.04em}
footer{position:sticky;bottom:0;background:#fff;padding:12px 20px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #eee}
.pay{width:100%;height:52px;border:0;border-radius:8px;background:#3a5bff;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.tools{display:flex;justify-content:center;gap:16px;margin-top:10px}
.tools button{border:0;background:none;padding:4px;font-size:12px;color:#999;text-decoration:underline;cursor:pointer}
.wait{position:fixed;inset:0;display:none;place-items:center;background:rgba(255,255,255,.85)}
.wait.on{display:grid}
.spinner{width:34px;height:34px;border:3px solid #e5e5e5;border-top-color:#3a5bff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="page">
<header>
<div><span class="wordmark">payple</span><span class="sandbox">SANDBOX</span></div>
<button class="x" type="button" aria-label="닫기" data-result="close">×</button>
</header>
<main>
<section class="order">
<div class="row"><span>상품명</span><b>${escapeHtml(input.goods || "-")}</b></div>
<div class="row total"><span>결제금액</span><b>${amount}<small>원</small></b></div>
</section>
<h2>간편결제</h2>
<div class="grid">${methodButtons(easyPays, "easy")}</div>
<h2>신용·체크카드</h2>
<div class="grid">${methodButtons(cards, "card")}</div>
</main>
<footer>
<button class="pay" type="button" data-result="approve" data-testid="payple-sandbox-approve">${amount}원 결제하기</button>
<div class="tools">
<button type="button" data-result="decline" data-testid="payple-sandbox-decline">승인 거절</button>
<button type="button" data-result="close" data-testid="payple-sandbox-close">결제 취소</button>
</div>
</footer>
</div>
<div class="wait" role="status" aria-label="처리 중"><div class="spinner"></div></div>
<script>
const fields = ${JSON.stringify(input.fields).replaceAll("<", "\\u003c")};
const callbackUrl = ${JSON.stringify(input.callbackUrl).replaceAll("<", "\\u003c")};
const embedded = ${input.embedded};
let sent = false;
function send(result) {
  if (sent) return;
  sent = true;
  document.querySelector(".wait").classList.add("on");
  const data = fields[result];
  const host = window.opener || (window.parent !== window ? window.parent : null);
  if (embedded && host) {
    host.postMessage({ type: "pay_result", data }, "*");
    if (window.opener) window.close();
    return;
  }
  const form = document.createElement("form");
  form.method = "post";
  form.action = callbackUrl;
  for (const [name, value] of Object.entries(data)) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }
  document.body.appendChild(form);
  form.submit();
}
document.querySelectorAll("[data-result]").forEach((button) => {
  button.addEventListener("click", () => send(button.dataset.result));
});
const auto = ${JSON.stringify(input.autoComplete)};
if (auto) setTimeout(() => send(auto), 300);
</script>
</body>
</html>`;
}
