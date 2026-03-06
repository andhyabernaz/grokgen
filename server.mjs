import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, "dist");
const port = Number.parseInt(process.env.PORT || "4173", 10);
const geminiApiKey = process.env.GEMINI_API_KEY || "";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

const cspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    mediaSrc: ["'self'", "blob:"],
    upgradeInsecureRequests: []
};

app.use(
    helmet({
        contentSecurityPolicy: { useDefaults: false, directives: cspDirectives },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "same-origin" },
        referrerPolicy: { policy: "no-referrer" }
    })
);

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});

app.use((req, res, next) => {
    const p = (req.path || "").toLowerCase();
    // Block sensitive files unless they are inside node_modules (which we explicitly allow)
    if (
        p.includes("..") ||
        p.startsWith("/.") ||
        p.includes("/.git") ||
        p.endsWith(".env") ||
        (p.endsWith("package.json") && !p.includes("node_modules")) ||
        (p.endsWith("server.mjs") && !p.includes("node_modules")) ||
        (p.endsWith("build.mjs") && !p.includes("node_modules"))
    ) {
        return res.status(404).end();
    }
    next();
});

// Serve node_modules to allow unrestricted access as requested
app.use("/node_modules", express.static(path.join(__dirname, "node_modules"), {
    index: false,
    dotfiles: "allow", // Allow dotfiles inside node_modules if needed
    redirect: false
}));

app.get("/api/health", (req, res) => {
    res.json({ mode: "proxy" });
});

const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
});
app.use("/api", apiLimiter);

app.use(express.json({ limit: "15mb" }));

const fetchJson = async (url, options) => {
    const res = await fetch(url, options);
    const body = await res.text();
    let parsed = {};
    try {
        parsed = body ? JSON.parse(body) : {};
    } catch {
        parsed = {};
    }
    if (!res.ok) {
        const msg = parsed?.error?.message || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
    return parsed;
};

app.get("/api/models", async (req, res) => {
    if (!geminiApiKey) return res.status(500).json({ error: { message: "GEMINI_API_KEY belum diset di server." } });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiApiKey)}`;
        const data = await fetchJson(url, { method: "GET" });
        res.json(data);
    } catch (e) {
        res.status(e.status || 500).json({ error: { message: e.message || "Gagal mengambil daftar model." } });
    }
});

app.post("/api/generate", async (req, res) => {
    if (!geminiApiKey) return res.status(500).json({ error: { message: "GEMINI_API_KEY belum diset di server." } });
    const model = typeof req.body?.model === "string" ? req.body.model : "";
    const payload = req.body?.payload;
    const isModelOk = /^[a-z0-9][a-z0-9.\-]*$/i.test(model);
    if (!isModelOk) return res.status(400).json({ error: { message: "Model tidak valid." } });
    if (!payload || typeof payload !== "object") return res.status(400).json({ error: { message: "Payload tidak valid." } });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
        const data = await fetchJson(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        res.json(data);
    } catch (e) {
        res.status(e.status || 500).json({ error: { message: e.message || "Gagal memproses permintaan." } });
    }
});

app.use(
    express.static(distDir, {
        index: false,
        dotfiles: "deny",
        redirect: false
    })
);

app.get("*", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});

