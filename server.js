const express = require("express"); const http = require("http"); const { Server } = require("socket.io");
const app = express(); const server = http.createServer(app); const io = new Server(server);
app.use(express.static("public"));
io.on("connection", (socket) => { socket.on("join-room", (room, callback) => { const clients = io.sockets.adapter.rooms.get(room); const count = clients ? clients.size : 0;
if (count >= 2) {
  return callback({ ok: false, error: "Xona to'la" });
}

socket.join(room);
socket.data.room = room;

callback({ ok: true, count: count + 1 });
socket.to(room).emit("peer-joined");
});
["offer", "answer", "ice-candidate"].forEach(event => { socket.on(event, data => { if (socket.data.room) { socket.to(socket.data.room).emit(event, data); } }); });
socket.on("disconnect", () => { if (socket.data.room) { socket.to(socket.data.room).emit("peer-left"); } }); });
server.listen(process.env.PORT || 3000, "0.0.0.0");
