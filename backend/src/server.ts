import path from "path";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { FastifyRequest, FastifyReply } from "fastify";
import http from "http";
import fs from "fs";
import dotenv from "dotenv";
import fastifyCookie from "@fastify/cookie";

import dbPlugin from "./plugins/db";
import userRoutes from "./routes/user";
import tournamentRoutes from "./routes/tournament";
import statsRoutes from "./routes/stats";
import notificationRoutes from "./routes/notification";
import { setupWebSocket } from "./ws/game";
import authRoutes from "./routes/auth";

// -------------------------
// Load environment variables
// -------------------------
dotenv.config();

const certsPath = path.join(__dirname, "../certs");

// ✅ Create Fastify instance with HTTPS
const fastify = Fastify({
    logger: true,
    https: {
        key: fs.readFileSync(path.join(certsPath, "server.key")),
        cert: fs.readFileSync(path.join(certsPath, "server.crt")),
    },
});

// register cookie plugin (before fastifyOauth2)
fastify.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET || "dev_cookie_secret",
  parseOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // <-- DEV ONLY
    path: "/",
  },
});

// -------------------------
// Register plugins
// -------------------------
fastify.register(fastifyCors, { origin: "*" });
fastify.register(dbPlugin);
fastify.register(fastifyMultipart);

// -------------------------
// JWT Setup (before routes)
// -------------------------
fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || "supersecret",
});

fastify.decorate(
  "authenticate",
  async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  }
);

// -------------------------
// API Routes
// -------------------------
fastify.register(authRoutes);
fastify.register(userRoutes, { prefix: "/api/user" });
fastify.register(tournamentRoutes, { prefix: "/api/tournament" });
fastify.register(statsRoutes, { prefix: "/api/stats" });
fastify.register(notificationRoutes, { prefix: "/api/notifications" });

// -------------------------
// Example DB endpoints
// -------------------------
fastify.get("/api/tables", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = fastify.db;
    const rows: { name: string }[] = await db.all(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);
    return rows.map((r) => r.name);
});

fastify.get<{ Params: { name: string } }>("/api/table/:name", async (request, reply) => {
    const db = fastify.db;
    const table = request.params.name;

    if (!/^[A-Za-z0-9_]+$/.test(table)) {
        reply.code(400).send({ error: "Invalid table name" });
        return;
    }

    try {
        const rows = await db.all(`SELECT * FROM "${table}" LIMIT 10`);
        return rows;
    } catch (err: any) {
        reply.code(500).send({ error: err.message });
    }
});

// -------------------------
// Static frontend & uploads
// -------------------------
const frontendPath = path.join(__dirname, "frontend");
const uploadsPath = path.join(__dirname, "../uploads");

// Ensure uploads folder exists
if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
}

// Serve uploads manually — no overlap with static
fastify.get<{ Params: { "*": string } }>("/uploads/*", async (req, reply) => {
    const filePath = path.join(uploadsPath, req.params["*"]);
    if (fs.existsSync(filePath)) {
        return reply.type("application/octet-stream").send(fs.createReadStream(filePath));
    }
    return reply.code(404).send({ error: "File not found" });
});

// Serve built frontend
fastify.register(fastifyStatic, {
    root: frontendPath,
    prefix: "/",
    index: "index.html",
});

// SPA fallback (after static)
fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/uploads")) {
        return reply.code(404).send({ error: "Not found" });
    }

    const indexPath = path.join(frontendPath, "index.html");
    if (fs.existsSync(indexPath)) {
        return reply.type("text/html").send(fs.readFileSync(indexPath));
    }

    reply.code(404).send({ error: "Frontend not found" });
});

// -------------------------
// Start server
// -------------------------
const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: "0.0.0.0" });
        setupWebSocket(fastify.server as http.Server);
        console.log("🚀 Transcendence running at https://localhost:3000");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

