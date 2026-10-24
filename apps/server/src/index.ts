import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { GeminiSession } from "./geminiSession.js";
import { ClientMessage } from "@celyn/shared";

const server = http.createServer((req, res) => {
  // CORS & Health check
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "Celyn AI Bot Backend Server",
        geminiConfigured: !!config.geminiApiKey,
        model: config.geminiModel,
        voice: config.geminiVoice,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔌 Klien web terhubung dari: ${clientIp}`);

  const session = new GeminiSession(ws);
  session.connect();

  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString("utf8")) as ClientMessage;
      session.handleClientMessage(msg);
    } catch (err) {
      console.error("Gagal mem-parse pesan dari klien:", err);
    }
  });

  ws.on("close", () => {
    console.log(`❌ Klien terputus: ${clientIp}`);
    session.close();
  });

  ws.on("error", (err) => {
    console.error("Client WebSocket error:", err);
    session.close();
  });
});

server.listen(config.port, () => {
  console.log(`
=====================================================
🚀 Celyn AI BOT Server berjalan di: http://localhost:${config.port}
🔌 WebSocket endpoint: ws://localhost:${config.port}
🎯 Gemini Model: ${config.geminiModel} | Voice: ${config.geminiVoice}
🔑 API Key status: ${config.geminiApiKey ? "TERPASANG ✅" : "BELUM TERPASANG ⚠️"}
=====================================================
  `);
});
