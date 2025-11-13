import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyOauth2, { OAuth2Namespace } from "@fastify/oauth2";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import crypto from "crypto";
import * as bcrypt from "bcryptjs";

const FORTYTWO_CONFIGURATION = {
  authorizeHost: "https://api.intra.42.fr",
  authorizePath: "/oauth/authorize",
  tokenHost: "https://api.intra.42.fr",
  tokenPath: "/oauth/token",
};

const GITHUB_CONFIGURATION = {
  authorizeHost: "https://github.com",
  authorizePath: "/login/oauth/authorize",
  tokenHost: "https://github.com",
  tokenPath: "/login/oauth/access_token",
};

// ===== Temporary Reset Token Store (for password reset, optional) =====
const resetTokens = new Map<string, { userId: number; expiry: number }>();

// ===== Helper functions =====
async function upsertOAuth(
  fastify: FastifyInstance,
  userId: number,
  serviceType: string,
  accessToken: string | null,
  refreshToken: string | null,
  expiresAt: number | null
) {
  await fastify.db.run(
    `INSERT INTO OAuth (user_id, service_type, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, service_type) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`,
    [userId, serviceType, accessToken, refreshToken, expiresAt]
  );
}

async function clearOAuthTokens(
  fastify: FastifyInstance,
  userId: number,
  serviceType: string
) {
  await fastify.db.run(
    `UPDATE OAuth SET access_token = NULL, refresh_token = NULL, expires_at = NULL
     WHERE user_id = ? AND service_type = ?`,
    [userId, serviceType]
  );
}

export default async function authRoutes(fastify: FastifyInstance) {
  // ===== Register 42 OAuth2 =====
  fastify.register(fastifyOauth2, {
    name: "fortyTwoOAuth2",
    scope: ["public"],
    credentials: {
      client: {
        id: process.env.FORTYTWO_CLIENT_ID!,
        secret: process.env.FORTYTWO_CLIENT_SECRET!,
      },
      auth: FORTYTWO_CONFIGURATION,
    },
    startRedirectPath: "/api/auth/signin",
    callbackUri: "https://localhost:3000/api/auth/callback/42",
  });

  // ===== Register GitHub OAuth2 =====
  fastify.register(fastifyOauth2, {
    name: "githubOAuth2",
    scope: ["user:email"],
    credentials: {
      client: {
        id: process.env.GITHUB_CLIENT_ID!,
        secret: process.env.GITHUB_CLIENT_SECRET!,
      },
      auth: GITHUB_CONFIGURATION,
    },
    startRedirectPath: "/api/auth/github/login",
    callbackUri: "https://localhost:3000/api/auth/callback/github",
  });
  // ====== 42 Callback ======
  fastify.get("/api/auth/callback/42", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = await (fastify as FastifyInstance & { fortyTwoOAuth2: OAuth2Namespace })
        .fortyTwoOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

      const accessToken = token.token.access_token;
      const refreshToken = (token.token as any).refresh_token || null;
      const expiresIn = (token.token as any).expires_in ? Number((token.token as any).expires_in) : null;
      const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

      const userData = await fetch("https://api.intra.42.fr/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((res: Response) => res.json() as any);

      type DBUser = { id: number; username: string; email: string };
      let user = (await fastify.db.get("SELECT * FROM User WHERE email = ?", [userData.email])) as DBUser | undefined;

      if (!user) {
        const result = (await fastify.db.run(
          "INSERT INTO User (username, email, password) VALUES (?, ?, ?)",
          [userData.login, userData.email, ""]
        )) as { lastID: number; changes: number };

        user = { id: result.lastID, username: userData.login, email: userData.email };
      }

      // store tokens in OAuth table
      await upsertOAuth(fastify, user.id, "42", accessToken, refreshToken, expiresAt);
      const jwt = fastify.jwt.sign({ id: user.id, username: user.username });
      reply.redirect(`/frontend/index.html?token=${jwt}`);
    } catch (err) {
      fastify.log.error(err as Error, "42 OAuth callback error");
      reply.code(500).send({ error: "42 authentication failed" });
    }
  });

  // ====== GitHub Callback ======
  fastify.get("/api/auth/callback/github", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = await (fastify as FastifyInstance & { githubOAuth2: OAuth2Namespace })
        .githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

      const accessToken = token.token.access_token;
      const refreshToken = (token.token as any).refresh_token || null;
      const expiresIn = (token.token as any).expires_in ? Number((token.token as any).expires_in) : null;
      const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

      // Fetch user data
      const userData = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "transcendence-42-app" },
      }).then((res: Response) => res.json());

      // Fetch verified email
      const emails = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "transcendence-42-app" },
      }).then((res: Response) => res.json());

      const primaryEmail =
        emails.find((e: any) => e.primary && e.verified)?.email || emails[0]?.email;

      if (!primaryEmail) {
        reply.code(400).send({ error: "No verified email found on GitHub account." });
        return;
      }

      type DBUser = { id: number; username: string; email: string };
      let user = (await fastify.db.get("SELECT * FROM User WHERE email = ?", [primaryEmail])) as
        | DBUser
        | undefined;

      if (!user) {
        const result = (await fastify.db.run(
          "INSERT INTO User (username, email, password) VALUES (?, ?, ?)",
          [userData.login, primaryEmail, ""]
        )) as { lastID: number; changes: number };

        user = { id: result.lastID, username: userData.login, email: primaryEmail };
      }

      // store tokens in OAuth table
      await upsertOAuth(fastify, user.id, "github", accessToken, refreshToken, expiresAt);
      const jwt = fastify.jwt.sign({ id: user.id, username: user.username });
      reply.redirect(`/frontend/index.html?token=${jwt}`);
    } catch (err: any) {
      console.error("=== GitHub OAuth error START ===");
      console.error("err:", err);
      if (err.data) console.error("err.data:", err.data);
      if (err.body) console.error("err.body:", err.body);
      if (err.message) console.error("err.message:", err.message);
      if (err.statusCode) console.error("err.statusCode:", err.statusCode);
      console.error("=== GitHub OAuth error END ===");
      reply.code(500).send({ error: "GitHub authentication failed", details: err.message ?? "see server logs" });
    }
  });

  // ---------------------------------------------------------------------------
  // Revoke endpoints (logout helpers)
  // ---------------------------------------------------------------------------
  // Revoke GitHub token (DELETE /applications/:client_id/tokens/:access_token)
  fastify.post("/api/auth/revoke/github", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = (req.headers as any).authorization || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      if (!jwt) return reply.code(401).send({ error: "Unauthorized" });

      const payload = fastify.jwt.verify(jwt) as any;
      const userId = payload?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const row = await fastify.db.get(
        `SELECT access_token FROM OAuth WHERE user_id = ? AND service_type = 'github'`,
        [userId]
      );
      const accessToken = row?.access_token;
      if (!accessToken) return reply.send({ ok: false, message: "No GitHub token stored" });

      const clientId = process.env.GITHUB_CLIENT_ID!;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
      if (!clientId || !clientSecret) return reply.code(500).send({ error: "Server misconfigured" });

      const revokeUrl = `https://api.github.com/applications/${encodeURIComponent(clientId)}/tokens/${encodeURIComponent(accessToken)}`;
      const res = await fetch(revokeUrl, {
        method: "DELETE",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "User-Agent": "transcendence-42-app",
          "Accept": "application/vnd.github+json"
        }
      });

      if (res.status === 204) {
        // remove stored token
        await clearOAuthTokens(fastify, userId, "github");
        return reply.send({ ok: true });
      } else {
        const text = await res.text();
        // log object then message (logger prefers object first)
        fastify.log.warn({ status: res.status, body: text }, "GitHub revoke failed");
        // still clear DB to avoid reuse
        await clearOAuthTokens(fastify, userId, "github");
        return reply.code(500).send({ ok: false, status: res.status, body: text });
      }
    } catch (err) {
      fastify.log.error(err as Error, "Error revoking GitHub token");
      return reply.code(500).send({ error: "Server error" });
    }
  });

  // Try to revoke 42 token via RFC7009-style revocation (provider-dependent)
  fastify.post("/api/auth/revoke/42", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = (req.headers as any).authorization || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      if (!jwt) return reply.code(401).send({ error: "Unauthorized" });

      const payload = fastify.jwt.verify(jwt) as any;
      const userId = payload?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const row = await fastify.db.get(
        `SELECT access_token FROM OAuth WHERE user_id = ? AND service_type = '42'`,
        [userId]
      );
      const accessToken = row?.access_token;
      if (!accessToken) return reply.send({ ok: false, message: "No 42 token stored" });

      // NOTE: 42 does not publicly document a standard revocation endpoint for all instances.
      // If your campus exposes one, adjust revocationEndpoint accordingly.
      const revocationEndpoint = process.env.FORTYTWO_REVOCATION_ENDPOINT || "https://api.intra.42.fr/oauth/revoke";

      const params = new URLSearchParams();
      params.set("token", accessToken);
      if (process.env.FORTYTWO_CLIENT_ID) params.set("client_id", process.env.FORTYTWO_CLIENT_ID);
      if (process.env.FORTYTWO_CLIENT_SECRET) params.set("client_secret", process.env.FORTYTWO_CLIENT_SECRET);

      const res = await fetch(revocationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });

      if (res.ok) {
        await clearOAuthTokens(fastify, userId, "42");
        return reply.send({ ok: true });
      } else {
        const text = await res.text();
        fastify.log.warn({ status: res.status, body: text }, "42 revoke attempt failed");
        // Clear DB anyway (optional) so old token isn't reused
        await clearOAuthTokens(fastify, userId, "42");
        return reply.send({ ok: false, status: res.status, body: text });
      }
    } catch (err) {
      fastify.log.error(err as Error, "Error revoking 42 token");
      return reply.code(500).send({ error: "Server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------  
  fastify.post("/api/auth/signin", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // accept either { user, password } or { username, password }
      const body = request.body as any || {};
      const suppliedUser = body.user || body.username;
      const password = body.password as string | undefined;

      if (!suppliedUser || !password) {
        return reply.code(400).send({ success: false, error: "Username and password required" });
      }

      // find by username or email (keep existing logic)
      const dbUser =
        (await fastify.db.get("SELECT * FROM User WHERE username = ?", [suppliedUser])) ||
        (await fastify.db.get("SELECT * FROM User WHERE email = ?", [suppliedUser]));

      if (!dbUser) {
        return reply.code(401).send({ success: false, error: "Invalid credentials" });
      }

      const hashed = dbUser.password || ""; // ensure string
      const valid = await bcrypt.compare(password, hashed);
      if (!valid) {
        return reply.code(401).send({ success: false, error: "Invalid credentials" });
      }

      // create JWT (include minimal data)
      const jwtToken = fastify.jwt.sign({ id: dbUser.id, username: dbUser.username });

      // reply with full object so frontend can store token + cached user
      return reply.send({
        success: true,
        token: jwtToken,
        user: { id: dbUser.id, username: dbUser.username, email: dbUser.email ?? null }
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        fastify.log.error(err, "signin error");
      } else {
        fastify.log.error({ thrown: err }, "signin error (non-error)");
      }
      return reply.code(500).send({ success: false, error: "Internal server error" });
    }
  });
  // ---------------------------------------------------------------------------
  // Forgot Password
  // ---------------------------------------------------------------------------
  fastify.post("/api/auth/forgot", async (request: FastifyRequest, reply: FastifyReply) => {
    const { email } = request.body as { email?: string };

    if (!email) {
      return reply.code(400).send({ error: "Email required" });
    }

    const user = await fastify.db.get("SELECT id, email FROM User WHERE email = ?", [email]);
    fastify.log.info({ user }, "User from database:");
    if (!user) {
      return reply.send({ message: "If an account exists, a reset email has been sent." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = Date.now() + 15 * 60 * 1000; // 15 min
    resetTokens.set(token, { userId: user.id, expiry });

    const resetLink = `https://localhost:3000/reset-password?token=${token}`;

    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: "lientranthikim@gmail.com",
          pass: "qubvudqwvndqfyeq" // your app password
        },
        logger: true,
        debug: true
      });

      const info = await transporter.sendMail({
        from: '"Transcendence 42" <lientranthikim@gmail.com>',
        to: user.email,
        subject: "Reset your Transcendence password",
        html: `<p>Hello,</p>
             <p>Click below to reset your password:</p>
             <a href="${resetLink}">${resetLink}</a>
             <p>This link expires in 15 minutes.</p>
             <p>Transcendence team</p>`
      });

      fastify.log.info({ messageId: info.messageId }, "Email sent");
      reply.send({ message: "If an account exists, a reset email has been sent." });
    } catch (err: unknown) {
      fastify.log.error(err as Error, "Failed to send email");
      reply.code(500).send({ error: "Failed to send email." });
    }
  });

  // ---------------------------------------------------------------------------
  // Reset Password
  // ---------------------------------------------------------------------------
  fastify.post("/api/auth/reset", async (request: FastifyRequest, reply: FastifyReply) => {
    const { token, newPassword } = request.body as { token?: string; newPassword?: string };

    if (!token || !newPassword) {
      return reply.code(400).send({ error: "Token and new password required" });
    }
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      return reply.code(400).send({ error: "Invalid or expired token" });
    }

    if (Date.now() > tokenData.expiry) {
      resetTokens.delete(token);
      return reply.code(400).send({ error: "Token expired" });
    }

    // IMPORTANT: hash the new password before saving
    const hashed = await bcrypt.hash(newPassword, 10);
    await fastify.db.run("UPDATE User SET password = ? WHERE id = ?", [hashed, tokenData.userId]);

    resetTokens.delete(token);
    reply.send({ message: "Password successfully reset." });
  });
}
