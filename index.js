const express = require("express");
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const app = express();

// ==== Cấu hình lấy từ Environment Variables (đặt trong Render.com, không hardcode) ====
const TMPROXY_API_KEY = process.env.TMPROXY_API_KEY; // API key mua từ TMProxy
const RELAY_SECRET = process.env.RELAY_SECRET;       // Khóa bí mật tự đặt, để Make xác thực khi gọi relay này

// Cache proxy hiện tại trong bộ nhớ để tránh gọi TMProxy quá nhiều lần liên tiếp
let cachedProxy = null;
let cachedProxyExpiresAtMs = 0;

async function getFreshProxy() {
  const now = Date.now();
  if (cachedProxy && now < cachedProxyExpiresAtMs) {
    return cachedProxy;
  }

  const resp = await fetch("https://tmproxy.com/api/proxy/get-current-proxy", {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_key: TMPROXY_API_KEY }),
  });

  if (!resp.ok) {
    throw new Error(`TMProxy API tra loi loi: HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`TMProxy API tra ve loi: ${json.message}`);
  }

  const data = json.data;
  // data.https la dang "ip:port" theo tai lieu TMProxy
  cachedProxy = {
    proxyUrl: `http://${data.username}:${data.password}@${data.https}`,
  };

  // Cache trong 60s hoac den truoc "next_request" (tuy TMProxy quy dinh) de tranh goi lien tuc
  const bufferMs = 5000;
  const ttlMs = (data.next_request ? data.next_request * 1000 : 60000);
  cachedProxyExpiresAtMs = now + Math.max(ttlMs - bufferMs, 5000);

  return cachedProxy;
}

app.get("/download", async (req, res) => {
  try {
    // Xac thuc: Make phai gui dung header nay moi duoc dung relay
    const providedSecret = req.header("X-Relay-Secret");
    if (!RELAY_SECRET || providedSecret !== RELAY_SECRET) {
      return res.status(401).json({ error: "Thieu hoac sai X-Relay-Secret" });
    }

    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: "Thieu query param 'url'" });
    }

    const { proxyUrl } = await getFreshProxy();
    const agent = new HttpsProxyAgent(proxyUrl);

    const fileResp = await fetch(targetUrl, { agent, timeout: 60000 });

    if (!fileResp.ok) {
      return res.status(502).json({
        error: `Khong tai duoc file goc, HTTP ${fileResp.status}`,
      });
    }

    // Chuyen tiep dung Content-Type cua file goc (thuong la audio/wav)
    const contentType = fileResp.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    fileResp.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Endpoint kiem tra relay con song khong (dung de test nhanh sau khi deploy)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Relay dang chay tren port ${PORT}`);
});
