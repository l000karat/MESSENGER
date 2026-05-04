const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB for MVP
});

app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "public")));

const messages = [];

app.get("/api/messages", (_req, res) => {
  res.json(messages.slice(-200));
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "File is required" });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const imageExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
  const videoExt = [".mp4", ".webm", ".mov", ".mkv"];
  let mediaType = "file";

  if (imageExt.includes(ext)) mediaType = "image";
  if (videoExt.includes(ext)) mediaType = "video";

  return res.json({
    url: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    mediaType
  });
});

io.on("connection", (socket) => {
  socket.on("chat-message", (payload) => {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      user: String(payload.user || "Guest").slice(0, 30),
      text: String(payload.text || "").slice(0, 2000),
      mediaUrl: payload.mediaUrl || null,
      mediaType: payload.mediaType || null,
      createdAt: new Date().toISOString()
    };

    messages.push(msg);
    if (messages.length > 1000) messages.shift();
    io.emit("chat-message", msg);
  });
});

server.listen(PORT, () => {
  console.log(`Messenger server running on http://localhost:${PORT}`);
});
