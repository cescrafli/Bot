import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { GeminiSession } from "./geminiSession.js";
import { ClientMessage } from "@celyn/shared";

// Metrik Global Server
const serverStats = {
  startTime: Date.now(),
  totalConnections: 0,
  activeConnections: 0,
};

// Rate limiter sederhana per IP (maksimal 5 koneksi bersamaan per IP)
const ipConnectionCount = new Map<string, number>();

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === "/api/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "Celyn AI Bot Backend Server",
        geminiConfigured: !!config.geminiApiKey,
        model: config.geminiModel,
        voice: config.geminiVoice,
        activeConnections: serverStats.activeConnections,
        uptimeSeconds: Math.floor((Date.now() - serverStats.startTime) / 1000),
      })
    );
    return;
  }

  // Stats endpoint
  if (req.url === "/api/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        uptimeSeconds: Math.floor((Date.now() - serverStats.startTime) / 1000),
        totalConnections: serverStats.totalConnections,
        activeConnections: serverStats.activeConnections,
        geminiModel: config.geminiModel,
        geminiVoice: config.geminiVoice,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket, req) => {
  const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

  // Periksa batas koneksi per IP
  const currentCount = ipConnectionCount.get(clientIp) || 0;
  if (currentCount >= 5) {
    console.warn(`⛔ [Rate Limit] IP ${clientIp} melebihi batas 5 koneksi simultan.`);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Batas koneksi per IP terlampaui (maksimal 5 koneksi simultan).",
      })
    );
    ws.close(1008, "Rate limit exceeded");
    return;
  }

  ipConnectionCount.set(clientIp, currentCount + 1);
  serverStats.totalConnections++;
  serverStats.activeConnections++;

  console.log(`🔌 [Klien Masuk] Terhubung dari ${clientIp} (Aktif: ${serverStats.activeConnections})`);

  const session = new GeminiSession(ws);
  session.connect();

  // Rate limit pesan dari klien (maks 25 pesan / detik untuk menghindari spamming)
  let messageCounter = 0;
  const rateLimitInterval = setInterval(() => {
    messageCounter = 0;
  }, 1000);

  ws.on("message", (data: Buffer) => {
    messageCounter++;
    if (messageCounter > 25) {
      console.warn(`⚠️ [Throttled] Klien ${clientIp} mengirim pesan terlalu cepat.`);
      return;
    }

    try {
      const msg = JSON.parse(data.toString("utf8")) as ClientMessage;
      session.handleClientMessage(msg);
    } catch (err) {
      console.error("Gagal mem-parse pesan dari klien:", err);
    }
  });

  const cleanup = () => {
    clearInterval(rateLimitInterval);
    const count = ipConnectionCount.get(clientIp) || 1;
    if (count <= 1) {
      ipConnectionCount.delete(clientIp);
    } else {
      ipConnectionCount.set(clientIp, count - 1);
    }
    serverStats.activeConnections = Math.max(0, serverStats.activeConnections - 1);
    console.log(`❌ [Klien Keluar] ${clientIp} terputus (Tersisa: ${serverStats.activeConnections})`);
    session.close();
  };

  ws.on("close", cleanup);
  ws.on("error", (err) => {
    console.error(`WebSocket error untuk ${clientIp}:`, err.message);
    cleanup();
  });
});

// Graceful shutdown
const handleShutdown = () => {
  console.log("\n🛑 Mematikan server Celyn AI secara tertib...");
  wss.clients.forEach((client) => {
    client.close(1001, "Server shutdown");
  });
  server.close(() => {
    console.log("Server berhasil dihentikan.");
    process.exit(0);
  });
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

server.listen(config.port, () => {
  console.log(`
=====================================================
🚀 Celyn AI BOT Server siap melayani!
🌐 URL: http://localhost:${config.port}
🔌 WebSocket endpoint: ws://localhost:${config.port}
🎯 Gemini Model: ${config.geminiModel} | Voice: ${config.geminiVoice}
🔑 API Key status: ${config.geminiApiKey ? "TERPASANG ✅" : "BELUM TERPASANG ⚠️"}
📊 Health check: http://localhost:${config.port}/api/health
=====================================================
  `);
});
