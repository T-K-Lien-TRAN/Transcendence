import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyOauth2, { OAuth2Namespace } from "@fastify/oauth2";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import crypto from "crypto";

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
// ===== Main Auth Routes =====
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
    const token = await (fastify as FastifyInstance & { fortyTwoOAuth2: OAuth2Namespace })
      .fortyTwoOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

    const userData = await fetch("https://api.intra.42.fr/v2/me", {
      headers: { Authorization: `Bearer ${token.token.access_token}` },
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

    const jwt = fastify.jwt.sign({ id: user.id, username: user.username });
    reply.redirect(`/frontend/index.html?token=${jwt}`);
  });
// ====== GitHub Callback ======
  fastify.get("/api/auth/callback/github", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = await (fastify as FastifyInstance & { githubOAuth2: OAuth2Namespace })
        .githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

      // Fetch user data
      const userData = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token.token.access_token}` },
      }).then((res: Response) => res.json());

      // Fetch verified email
      const emails = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${token.token.access_token}` },
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

      const jwt = fastify.jwt.sign({ id: user.id, username: user.username });
      reply.redirect(`/frontend/index.html?token=${jwt}`);
    }  catch (err: any) {
  console.error("=== GitHub OAuth error START ===");
  console.error("err:", err);
  // common places libs put details:
  if (err.data) console.error("err.data:", err.data);
  if (err.body) console.error("err.body:", err.body);
  if (err.message) console.error("err.message:", err.message);
  if (err.statusCode) console.error("err.statusCode:", err.statusCode);
  console.error("=== GitHub OAuth error END ===");
  reply.code(500).send({ error: "GitHub authentication failed", details: err.message ?? "see server logs" });
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
 // 🔹 Add this line to test if email is retrieved
fastify.log.info('User from database:', user);
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
      pass: "qubvudqwvndqfyeq" //your_app_password_of gmail
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

  fastify.log.info(`Email sent: ${info.messageId}`);
  reply.send({ message: "If an account exists, a reset email has been sent." });
} catch (err: unknown) {
  fastify.log.error(`Failed to send email: ${err instanceof Error ? err.message : String(err)}`);
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

// TODO: hash newPassword before saving
await fastify.db.run("UPDATE User SET password = ? WHERE id = ?", [newPassword, tokenData.userId]);

resetTokens.delete(token);
reply.send({ message: "Password successfully reset." });
});
}


