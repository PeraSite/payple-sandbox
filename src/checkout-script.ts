// Hosted checkout served as `/js/v1/payment.js`. Merchants call the global
// `PaypleCpayAuthCheck(payload)`; the sandbox shows a card window and posts the
// CERT result to `PCD_RST_URL` as a full-page form, like Payple on mobile.
export function checkoutScript(origin: string) {
	return `(() => {
  const origin = ${JSON.stringify(origin)};
  function post(url, fields) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value);
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }
  function button(label, testId, primary) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.dataset.testid = testId;
    element.style.cssText = "width:100%;padding:14px;border-radius:10px;font:600 15px sans-serif;border:1px solid #d4d4d8;" + (primary ? "background:#2563eb;color:#fff;border-color:#2563eb" : "background:#fff;color:#18181b");
    return element;
  }
  window.PaypleCpayAuthCheck = async (payload) => {
    const response = await fetch(origin + "/__sandbox/checkouts", {
      body: JSON.stringify({
        clientKey: payload.clientKey,
        goods: payload.PCD_PAY_GOODS,
        oid: payload.PCD_PAY_OID,
        payerName: payload.PCD_PAYER_NAME,
        rstUrl: payload.PCD_RST_URL,
        total: Number(payload.PCD_PAY_TOTAL),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("Payple sandbox rejected the checkout");
    const checkout = await response.json();
    const complete = (result) => post(payload.PCD_RST_URL, checkout.fields[result]);
    if (checkout.autoComplete) return complete(checkout.autoComplete);

    const overlay = document.createElement("div");
    overlay.id = "payple-sandbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Payple sandbox checkout");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:grid;place-items:end center";
    const sheet = document.createElement("div");
    sheet.style.cssText = "width:min(420px,100%);background:#fff;border-radius:16px 16px 0 0;padding:20px;display:grid;gap:10px;font:14px sans-serif;color:#18181b";
    const amount = Number(payload.PCD_PAY_TOTAL).toLocaleString("ko-KR");
    sheet.innerHTML = '<div style="font:700 12px sans-serif;color:#dc2626">SANDBOX · 실제 결제되지 않아요 (no real charge)</div>'
      + '<div style="font:700 18px sans-serif"></div><div style="font:800 26px sans-serif"></div>';
    sheet.children[1].textContent = payload.PCD_PAY_GOODS || "주문";
    sheet.children[2].textContent = amount + "원";
    const approve = button("결제하기 (승인)", "payple-sandbox-approve", true);
    const decline = button("카드사 거절", "payple-sandbox-decline", false);
    const close = button("결제창 닫기", "payple-sandbox-close", false);
    approve.onclick = () => complete("approve");
    decline.onclick = () => complete("decline");
    close.onclick = () => complete("close");
    sheet.append(approve, decline, close);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  };
})();`;
}
