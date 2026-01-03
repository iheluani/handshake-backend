import { WebSocket, WebSocketServer } from "ws";
import { getHand } from "./storage.js";
import Hand from "../models/hand.js";

interface Connection {
  socket: WebSocket;
  uuid: string;
}

const connections = new Map<string, Connection>();

/** Broadcast the current peer list to all connected Hands */
function broadcastPeerList() {
  const peerList = Array.from(connections.values()).map(({ uuid }) => {
    const hand = getHand(uuid);
    return hand;
  }).filter(Boolean);

  const msg = JSON.stringify({ type: "peerList", peers: peerList });

  for (const { socket } of connections.values()) {
    try {
      socket.send(msg);
    } catch (err) {
      console.error("Failed to send peer list:", err);
    }
  }
}

export function initWebSocket(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket, _req) => {
    let hand: Hand | undefined = undefined;

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // First message should be { type: "subscribe", uuid: "..." }
        if (msg.type === "subscribe") {
          hand = getHand(msg.uuid);
          if (!hand) {
            socket.send(JSON.stringify({ error: "Invalid Hand UUID" }));
            socket.close();
            return;
          }
          connections.set(hand.uuid, { socket, uuid: hand.uuid });
          socket.send(JSON.stringify({ status: "subscribed" }));

          broadcastPeerList();
          return;
        }

        // Forward encrypted chat messages
        if (msg.type === "send" && hand) {
          const peerConn = connections.get(msg.to);
          if (peerConn) {
            peerConn.socket.send(JSON.stringify({
              from: hand.uuid,
              content: msg.content
            }));
          }
          return;
        }

        if (!hand) {
          socket.send(JSON.stringify({ error: "Handshake not established" }));
          return;
        }
      } catch (err) {
        socket.send(JSON.stringify({ error: "Malformed message", details: err instanceof Error ? err.message : String(err) }));
      }
    });

    socket.on("close", () => {
      if (hand) {
        console.log(`Connection closed for Hand: ${hand.name} (${hand.uuid})`);
        connections.delete(hand.uuid);
        broadcastPeerList();
      }
    });
  });

  return wss;
}
