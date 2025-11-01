import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyOauth2, { OAuth2Namespace } from "@fastify/oauth2";
import fetch from "node-fetch";

const FORTYTWO_CONFIGURATION = {
  authorizeHost: "https://api.intra.42.fr",
  authorizePath: "/oauth/authorize",
  tokenHost: "https://api.intra.42.fr",
  tokenPath: "/oauth/token",
};

export default async function authRoutes(fastify: FastifyInstance) {
  // Register OAuth2 plugin
  fastify.register(fastifyOauth2, {
    name: "fortyTwoOAuth2",
    credentials: {
      client: {
        id: process.env.FORTYTWO_CLIENT_ID!,
        secret: process.env.FORTYTWO_CLIENT_SECRET!,
      },
      auth: FORTYTWO_CONFIGURATION, 
    },
    startRedirectPath: "/api/auth/signin",
    callbackUri: "https://localhost:3000/api/auth/callback",
  });

  // OAuth2 callback route
  fastify.get("/api/auth/callback", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = await (fastify as FastifyInstance & { fortyTwoOAuth2: OAuth2Namespace })
      .fortyTwoOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

    const userData = await fetch("https://api.intra.42.fr/v2/me", {
      headers: { Authorization: `Bearer ${token.token.access_token}` },
    }).then((res: Response) => res.json() as any);

// ✅ Explicitly type user
type DBUser = { id: number; username: string; email: string };

// Cast the result from db.get instead of using a generic
let user = (await fastify.db.get("SELECT * FROM User WHERE email = ?", [userData.email])) as DBUser | undefined;

if (!user) {
  // Explicitly type the result from db.run
  const result = (await fastify.db.run(
    "INSERT INTO User (username, email, password) VALUES (?, ?, ?)",
    [userData.login, userData.email, ""]
  )) as { lastID: number; changes: number };

  user = { id: result.lastID, username: userData.login, email: userData.email };
}

// Sign JWT with both id and username
const jwt = fastify.jwt.sign({ id: user.id, username: user.username });

// Redirect user to frontend
reply.redirect(`/frontend/index.html?token=${jwt}`);
});
}

