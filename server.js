require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "development-only-change-this-secret";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "services.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'citizen' CHECK(role IN ('citizen','admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    image_path TEXT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Resolved')),
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const adminEmail = (process.env.ADMIN_EMAIL || "admin@ecitizen.local").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
if (!db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail)) {
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
    .run("Portal Administrator", adminEmail, bcrypt.hashSync(adminPassword, 12));
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, "public")));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: "draft-7", legacyHeaders: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Only JPG, PNG or WEBP images are allowed."), allowed.includes(file.mimetype));
  }
});

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}
function cleanRequest(row) {
  return {
    id: row.id, citizenName: row.citizen_name, citizenEmail: row.citizen_email,
    category: row.category, location: row.location, description: row.description,
    imageUrl: row.image_path ? `/uploads/${path.basename(row.image_path)}` : null,
    status: row.status, adminNote: row.admin_note, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
const requestSelect = `
 SELECT r.*, u.name AS citizen_name, u.email AS citizen_email
 FROM requests r JOIN users u ON u.id = r.user_id
`;

app.post("/api/auth/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const info = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(name, email, bcrypt.hashSync(password, 12));
    const user = { id: Number(info.lastInsertRowid), name, email, role: "citizen" };
    res.status(201).json({ token: createToken(user), user });
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "An account with this email already exists." });
    res.status(500).json({ error: "Could not create your account." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: "Email or password is incorrect." });
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ token: createToken(user), user });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT id,name,email,role,created_at FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "Account not found." });
  res.json({ user });
});

app.get("/api/requests", auth, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(requestSelect + " ORDER BY r.created_at DESC").all()
    : db.prepare(requestSelect + " WHERE r.user_id = ? ORDER BY r.created_at DESC").all(req.user.id);
  res.json({ requests: rows.map(cleanRequest) });
});

app.post("/api/requests", auth, upload.single("image"), (req, res) => {
  const category = String(req.body.category || "").trim();
  const location = String(req.body.location || "").trim();
  const description = String(req.body.description || "").trim();
  const categories = ["Roads & Streetlights", "Water & Sanitation", "Garbage Collection", "Public Safety", "Licensing & Documents", "Other"];
  if (!categories.includes(category)) return res.status(400).json({ error: "Choose a valid request category." });
  if (location.length < 3 || location.length > 180) return res.status(400).json({ error: "Location must be between 3 and 180 characters." });
  if (description.length < 10 || description.length > 2000) return res.status(400).json({ error: "Description must be between 10 and 2,000 characters." });
  const imagePath = req.file ? req.file.path : null;
  const info = db.prepare("INSERT INTO requests(user_id,category,location,description,image_path) VALUES(?,?,?,?,?)")
    .run(req.user.id, category, location, description, imagePath);
  const row = db.prepare(requestSelect + " WHERE r.id=?").get(info.lastInsertRowid);
  res.status(201).json({ request: cleanRequest(row), message: "Your service request has been submitted." });
});

app.patch("/api/requests/:id/status", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");
  const note = String(req.body.adminNote || "").trim().slice(0, 500);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid request ID." });
  if (!["Pending", "In Progress", "Resolved"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const existing = db.prepare("SELECT id FROM requests WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Request not found." });
  db.prepare("UPDATE requests SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, note || null, id);
  const row = db.prepare(requestSelect + " WHERE r.id=?").get(id);
  res.json({ request: cleanRequest(row), message: "Request updated successfully." });
});

app.get("/api/analytics", auth, adminOnly, (_, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='In Progress' THEN 1 ELSE 0 END) AS inProgress,
      SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) AS resolved
    FROM requests
  `).get();
  const categories = db.prepare("SELECT category,COUNT(*) AS count FROM requests GROUP BY category ORDER BY count DESC").all();
  const recent = db.prepare("SELECT date(created_at) AS day,COUNT(*) AS count FROM requests WHERE created_at >= date('now','-6 days') GROUP BY date(created_at) ORDER BY day").all();
  res.json({ totals: { total: totals.total || 0, pending: totals.pending || 0, inProgress: totals.inProgress || 0, resolved: totals.resolved || 0 }, categories, recent });
});

app.get("/api/health", (_, res) => res.json({ status: "ok" }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Image must be 5 MB or smaller." : err.message });
  if (err) return res.status(400).json({ error: err.message || "Something went wrong." });
  next();
});
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API endpoint not found." });
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Mini eCitizen running at http://localhost:${PORT}`);
  console.log(`Admin login: ${adminEmail}`);
  if (!process.env.ADMIN_PASSWORD) console.log("Development admin password: ChangeMe123! (change this before deployment)");
});
