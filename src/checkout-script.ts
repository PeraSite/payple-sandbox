// `/js/v1/payment.js`, following Payple's real script:
// - Absolute `PCD_RST_URL` (http/https): the merchant page itself navigates to the
//   payment window (PC shows the loading layer first). The window posts the result
//   to `PCD_RST_URL` as a top-level form.
// - Relative or empty `PCD_RST_URL`: PC opens a dimmed layer with the `cpay_ifr`
//   iframe, mobile opens the `cpayWinOpen` popup (Payple's alert if blocked). The
//   window posts `{ type: "pay_result", data }` back, the layer closes, and the
//   result goes to `callbackFunction` or is form-POSTed to `PCD_RST_URL`.
export function checkoutScript(origin: string) {
	return `(() => {
  const origin = ${JSON.stringify(origin)};
  const mobileAgent = /android.+mobile|iphone|ipod|ipad|iemobile|opera m(ob|in)i|windows phone|blackberry|silk|kindle/i;
  const popupBlocked = " 팝업이 차단되어 결제를 진행할 수 없습니다. \\r\\n 폰 설정에서 팝업차단을 풀어주세요. ";
  let current = null;

  function removeLayer() {
    document.getElementById("layer_cpay")?.remove();
  }

  function createLayer(withFrame) {
    removeLayer();
    const layer = document.createElement("div");
    layer.id = "layer_cpay";
    layer.style.cssText = "position:fixed;inset:0;z-index:16777270;display:grid;place-items:center;background:rgba(0,0,0,.5)";
    const spinner = document.createElement("div");
    spinner.style.cssText = "width:36px;height:36px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:cpay-spin .8s linear infinite";
    const style = document.createElement("style");
    style.textContent = "@keyframes cpay-spin{to{transform:rotate(360deg)}}";
    layer.append(style, spinner);
    if (withFrame) {
      const frame = document.createElement("iframe");
      frame.id = "cpay_ifr";
      frame.name = "cpay_ifr";
      frame.title = "payple";
      frame.style.cssText = "position:absolute;width:min(450px,100vw);height:min(700px,100dvh);border:0;border-radius:12px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.3)";
      layer.appendChild(frame);
    }
    document.body.appendChild(layer);
    return layer.querySelector("iframe");
  }

  function postResult(url, data) {
    const form = document.createElement("form");
    form.name = "PaypleCpayResultForm";
    form.method = "post";
    form.action = url;
    for (const [name, value] of Object.entries(data)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value);
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== origin || !current || event.data?.type !== "pay_result") return;
    const { payload } = current;
    current = null;
    removeLayer();
    if (typeof payload.callbackFunction === "function") {
      setTimeout(() => payload.callbackFunction(event.data.data), 1000);
    } else {
      postResult(payload.PCD_RST_URL, event.data.data);
    }
  });

  window.PaypleCpayAuthCheck = (payload) => {
    const isMobile = mobileAgent.test(navigator.userAgent);
    const topLevel = /^https?:\\/\\//.test(payload.PCD_RST_URL || "");
    let target = null;
    if (topLevel) {
      if (!isMobile) createLayer(false);
    } else if (isMobile) {
      // Opened before any await so the browser treats it as user-initiated.
      target = window.open("", "cpayWinOpen", "width:450px,height:100%,toolbars=no,menubars=no,status=no,resizable=no,location=no");
      if (!target) {
        alert(popupBlocked);
        return false;
      }
    } else {
      target = createLayer(true).contentWindow;
    }
    current = { payload };
    fetch(origin + "/__sandbox/checkouts", {
      body: JSON.stringify({
        clientKey: payload.clientKey,
        goods: payload.PCD_PAY_GOODS,
        oid: payload.PCD_PAY_OID,
        payerName: payload.PCD_PAYER_NAME,
        rstUrl: payload.PCD_RST_URL || "",
        total: Number(payload.PCD_PAY_TOTAL),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then((response) => response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body.error || "결제창을 열 수 없습니다."))))
      .then((checkout) => {
        if (topLevel) window.location.href = checkout.windowUrl;
        else target.location.href = checkout.windowUrl + "?embed=1";
      })
      .catch((error) => {
        current = null;
        removeLayer();
        if (isMobile && target) target.close();
        alert(error.message);
      });
    return true;
  };
})();`;
}
