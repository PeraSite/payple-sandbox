// `/js/v1/payment.js`. Mirrors how Payple's real script opens its window:
// - PC: a dimmed layer over the merchant page with a 450px iframe (`cpay_ifr`)
// - Mobile: a popup window opened synchronously inside the click; if the browser
//   blocks it, Payple's own alert is shown and nothing else happens.
// The window page (served by the sandbox) posts the CERT result to `PCD_RST_URL`
// from inside the iframe/popup, so the merchant callback page sees a
// `window.parent` / `window.opener` exactly as it would with Payple.
export function checkoutScript(origin: string) {
	return `(() => {
  const origin = ${JSON.stringify(origin)};
  const mobileAgent = /android.+mobile|iphone|ipod|ipad|iemobile|opera m(ob|in)i|windows phone|blackberry|silk|kindle/i;
  const popupBlocked = " 팝업이 차단되어 결제를 진행할 수 없습니다. \\r\\n 폰 설정에서 팝업차단을 풀어주세요. ";

  function removeLayer() {
    document.getElementById("layer_cpay")?.remove();
  }

  function createLayer() {
    removeLayer();
    const layer = document.createElement("div");
    layer.id = "layer_cpay";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-label", "페이플 샌드박스 결제창");
    layer.style.cssText = "position:fixed;inset:0;z-index:16777270;display:grid;place-items:center;background:rgba(15,23,42,.55)";
    const frame = document.createElement("iframe");
    frame.id = "cpay_ifr";
    frame.name = "cpay_ifr";
    frame.title = "페이플 샌드박스 결제창";
    frame.style.cssText = "width:min(450px,100vw);height:min(720px,100dvh);border:0;border-radius:16px;background:#fff;box-shadow:0 24px 64px rgba(0,0,0,.35)";
    layer.appendChild(frame);
    document.body.appendChild(layer);
    return frame;
  }

  window.PaypleCpayAuthCheck = (payload) => {
    const isMobile = mobileAgent.test(navigator.userAgent);
    // Open the window before any await so popup blockers treat it as user-initiated.
    let target;
    if (isMobile) {
      target = window.open("", "payple_sandbox_popup", "width:450px,height:100%,toolbars=no,menubars=no,status=no,resizable=no,location=no");
      if (!target) {
        alert(popupBlocked);
        return false;
      }
    } else {
      target = createLayer().contentWindow;
    }
    fetch(origin + "/__sandbox/checkouts", {
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
    })
      .then((response) => response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body.error || "결제창을 열 수 없어요"))))
      .then((checkout) => { target.location.href = checkout.windowUrl; })
      .catch((error) => {
        removeLayer();
        if (isMobile) target.close();
        alert(error.message);
      });
    return true;
  };
})();`;
}
