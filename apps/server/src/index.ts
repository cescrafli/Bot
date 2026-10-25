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

const wss = new WebSocketServer({
  server,
  maxPayload: config.maxPayloadBytes,
});

// Interface untuk melacak heartbeat klien
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Heartbeat ping interval untuk mendeteksi koneksi mati (dead peer)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws: AliveWebSocket) => {
    if (ws.isAlive === false) {
      console.log("⏱️ [Heartbeat] Klien tidak merespons ping, menutup koneksi.");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, config.heartbeatIntervalMs);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

wss.on("connection", (ws: AliveWebSocket, req) => {
  const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

  // Tandai klien aktif saat pertama terhubung dan saat merespons pong
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

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

  // Idle timeout timer: jika tidak ada interaksi dalam 5 menit, putuskan sesi secara tertib
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`💤 [Idle Timeout] Sesi untuk ${clientIp} dihentikan karena tidak ada aktivitas.`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "status",
            status: "idle",
            message: "Sesi ditutup otomatis karena tidak ada aktivitas selama 5 menit.",
          })
        );
        ws.close(1000, "Idle timeout");
      }
    }, config.idleTimeoutMs);
  };
  resetIdleTimer();

  // Rate limit pesan dari klien (maks 30 pesan / detik)
  let messageCounter = 0;
  const rateLimitInterval = setInterval(() => {
    messageCounter = 0;
  }, 1000);

  ws.on("message", (data: Buffer) => {
    resetIdleTimer();
    messageCounter++;
    if (messageCounter > 30) {
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
    if (idleTimer) clearTimeout(idleTimer);
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
