import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import fetch from 'node-fetch';

export default async function userRoutes(fastify: FastifyInstance) {

  // ----------------------------
  // Register new user
  // ----------------------------
  fastify.post("/register", async (req: FastifyRequest<{ Body: { username: string; email: string; password: string } }>, reply: FastifyReply) => {
    const { username, email, password } = req.body;

    if (!username || !password || !email) {
      return reply.code(400).send({ success: false, error: "All fields are required" });
    }

    try {
      const hashed = await bcrypt.hash(password, 10);
      const res = await fastify.db.run(
        "INSERT INTO User (username, email, password) VALUES (?, ?, ?)",
        [username, email, hashed]
      );

      // Initialize stats for the new user
      await fastify.db.run(
        "INSERT INTO UserStats (user_id) VALUES (?)",
        [res.lastID]
      );

      reply.send({ success: true, userId: res.lastID });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ success: false, error: "Username or email already exists" });
      }
      reply.code(500).send({ success: false, error: err.message });
    }
  });
    // ----------------------------
    // Login user (with optional 2FA)
    // ----------------------------
    fastify.post("/api/auth/signin", async (req, reply) => {
        const { username, password, token } = req.body as any;

        if (!username || !password) {
            return reply.code(400).send({ success: false, error: "Username and password required" });
        }

        try {
            const user = (await fastify.db.get("SELECT * FROM User WHERE username = ?", [username])) ||
                (await fastify.db.get("SELECT * FROM User WHERE email = ?", [username]));;
            if (!user) return reply.code(404).send({ success: false, error: "User not found" });

            const match = await bcrypt.compare(password, user.password);
            if (!match) return reply.code(401).send({ success: false, error: "Invalid password" });

            // If 2FA enabled, verify token
            if (user.twofa_secret) {
                if (!token) {
                    return reply.code(403).send({ success: false, require2FA: true, message: "2FA token required" });
                }

                const verified = speakeasy.totp.verify({
                    secret: user.twofa_secret,
                    encoding: "base32",
                    token,
                });

                if (!verified) {
                    return reply.code(401).send({ success: false, error: "Invalid 2FA token" });
                }
            }

            // ✅ Generate JWT after successful password/2FA verification
            const jwt = fastify.jwt.sign({
                id: user.id,
                username: user.username,
            });

            reply.send({
                success: true,
                token: jwt,   // <-- send JWT to client
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    has2FA: !!user.twofa_secret,
                },
            });

        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    });
    // Setup the authenticate decorator
    fastify.decorate("authenticate", async function (
        this: FastifyInstance,
        req: FastifyRequest,
        reply: FastifyReply
    ) {
        try {
            await req.jwtVerify(); // checks Authorization header for a valid JWT
        } catch (err) {
            reply.code(401).send({ success: false, error: "Unauthorized" });
        }
    });
  // ----------------------------
  // Generate 2FA secret (setup)
  // ----------------------------
  fastify.post("/user/:id/2fa/setup", async (req, reply) => {
    const { id } = req.params as any;

    try {
      const secret = speakeasy.generateSecret({
        name: `Transcendence42 (${id})`,
        length: 20,
      });

      await fastify.db.run("UPDATE User SET twofa_secret = ? WHERE id = ?", [secret.base32, id]);
      if (!secret.otpauth_url) {
  throw new Error('Failed to generate 2FA URL');
}
      const qrCodeDataURL = await qrcode.toDataURL(secret.otpauth_url);

      reply.send({
        success: true,
        secret: secret.base32,
        qrCodeDataURL,
      });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------
  // Verify 2FA token
  // ----------------------------
  fastify.post("/user/:id/2fa/verify", async (req, reply) => {
    const { id } = req.params as any;
    const { token } = req.body as any;

    if (!token) {
      return reply.code(400).send({ success: false, error: "2FA token required" });
    }

    try {
      const user = await fastify.db.get("SELECT twofa_secret FROM User WHERE id = ?", [id]);
      if (!user?.twofa_secret) return reply.code(404).send({ success: false, error: "2FA not set up" });

      const verified = speakeasy.totp.verify({
        secret: user.twofa_secret,
        encoding: "base32",
        token,
      });

      if (!verified) return reply.code(401).send({ success: false, error: "Invalid 2FA token" });

      reply.send({ success: true, message: "2FA verified successfully" });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------
  // Disable 2FA
  // ----------------------------
  fastify.delete("/user/:id/2fa", async (req, reply) => {
    const { id } = req.params as any;

    try {
      await fastify.db.run("UPDATE User SET twofa_secret = NULL WHERE id = ?", [id]);
      reply.send({ success: true, message: "2FA disabled successfully" });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });
  function normalizeAvatar(avatar: string | null | undefined) {
        if (!avatar) return "/uploads/default.png";
        if (/^https?:\/\//i.test(avatar)) return avatar;
        const filename = path.basename(avatar);
        return `/uploads/${filename}`;
   }
  // ----------------------------
  // Get user profile by ID (with stats)
  // ----------------------------
  fastify.get("/:id", { preHandler: [fastify.authenticate] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply)=> {
    const { id } = req.params as { id: string };

      try {
          const user = await fastify.db.get(
              `SELECT 
          u.id, u.username, u.email, u.twofa_secret,
          s.elo, s.matches_played, s.winrate, s.friends
         FROM User u
         LEFT JOIN UserStats s ON u.id = s.user_id
         WHERE u.id = ?`,
              [id]
          );

          if (!user) return reply.code(404).send({ success: false, error: "User not found" });
          const avatar = normalizeAvatar(user.avatar);
          reply.send({ success: true, user: { ...user, avatar } });
      } catch (err: any) {
          reply.code(500).send({ success: false, error: err.message });
      }
  });
 // convenience: get current authenticated user
fastify.get("/me", { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {

        const userId = (req as any).user?.id ?? ((req as any).session?.userId);
        if (!userId) return reply.code(401).send({ success: false, error: 'Not authenticated' });
        try {
            const user = await fastify.db.get(
                `SELECT 
                    u.id,
                    u.username,
                    u.email,
                    u.avatar,
                    p.nickname,
                    p.elo,
                    p.rank,
                    us.matches_played,
                    us.winrate
                    FROM User u
                    LEFT JOIN Player p 
                    ON u.id = p.user_id 
                    AND p.tournament_id = 1       -- ← choose your default tournament
                    LEFT JOIN UserStats us 
                    ON u.id = us.user_id
                    WHERE u.id = ?`,
                [userId]
            );
            if (!user) return reply.code(404).send({ success: false, error: "User not found" });

            const avatar = normalizeAvatar(user.avatar);
            reply.send({ success: true, user: { ...user, avatar } });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    }
);
/*
fastify.get("/me", { preHandler: [fastify.authenticate] },
  async (req: FastifyRequest, reply: FastifyReply) => {
    // adapt this to how you attach the authenticated user id
      const userId = (req as any).user?.id ?? ((req as any).session?.userId);
    if (!userId) return reply.code(401).send({ success: false, error: 'Not authenticated' });

    try {
      const user = await fastify.db.get(
        `SELECT u.id, u.username, u.email, u.avatar, s.elo, s.matches_played, s.winrate
         FROM User u
         LEFT JOIN UserStats s ON u.id = s.user_id
         WHERE u.id = ?`,
        [userId]
      );

      if (!user) return reply.code(404).send({ success: false, error: "User not found" });
      const avatar = normalizeAvatar(user.avatar);
        reply.send({ success: true, user: { ...user, avatar } });
    } catch (err: any) {
        reply.code(500).send({ success: false, error: err.message });
    }
  }
);
*/
 // ----------------------------
  // Match complete — update stats + ELO
  // ----------------------------
  fastify.post("/match/complete", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { winnerId, loserId } = req.body as any;

    if (!winnerId || !loserId) {
      return reply.code(400).send({ success: false, error: "winnerId and loserId required" });
    }

    try {
      const winnerStats = await fastify.db.get("SELECT * FROM UserStats WHERE user_id = ?", [winnerId]);
      const loserStats = await fastify.db.get("SELECT * FROM UserStats WHERE user_id = ?", [loserId]);

      if (!winnerStats || !loserStats)
        return reply.code(404).send({ success: false, error: "Stats not found for one or both users" });

      // --- ELO System ---
      const k = 32;
      const expectedWinner = 1 / (1 + Math.pow(10, (loserStats.elo - winnerStats.elo) / 400));
      const expectedLoser = 1 - expectedWinner;

      const newWinnerElo = Math.round(winnerStats.elo + k * (1 - expectedWinner));
      const newLoserElo = Math.round(loserStats.elo + k * (0 - expectedLoser));

      // --- Update stats ---
      const winnerMatches = winnerStats.matches_played + 1;
      const loserMatches = loserStats.matches_played + 1;

      const newWinnerWinrate =
        ((winnerStats.winrate * winnerStats.matches_played + 1) / winnerMatches) * 100;
      const newLoserWinrate =
        ((loserStats.winrate * loserStats.matches_played) / loserMatches) * 100;

      await fastify.db.run(
        "UPDATE UserStats SET elo=?, matches_played=?, winrate=? WHERE user_id=?",
        [newWinnerElo, winnerMatches, newWinnerWinrate, winnerId]
      );

      await fastify.db.run(
        "UPDATE UserStats SET elo=?, matches_played=?, winrate=? WHERE user_id=?",
        [newLoserElo, loserMatches, newLoserWinrate, loserId]
      );

      reply.send({
        success: true,
        updated: {
          winner: { id: winnerId, elo: newWinnerElo, winrate: newWinnerWinrate },
          loser: { id: loserId, elo: newLoserElo, winrate: newLoserWinrate },
        },
      });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------
  // Send friend request
  // ----------------------------
  fastify.post("/friend", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { userId, friendId } = req.body as any;

    if (!userId || !friendId)
      return reply.code(400).send({ success: false, error: "userId and friendId required" });

    try {
      await fastify.db.run(
        "INSERT INTO Friend (user_id, friend_id, status) VALUES (?, ?, 'pending')",
        [userId, friendId]
      );

      reply.send({ success: true });
    } catch {
      reply.code(400).send({ success: false, error: "Friendship already exists" });
    }
  });

  // ----------------------------
  // Accept friend request
  // ----------------------------
  fastify.put("/friend/accept", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { userId, friendId } = req.body as any;

    try {
      await fastify.db.run(
        "UPDATE Friend SET status='accepted' WHERE user_id=? AND friend_id=?",
        [friendId, userId]
      );

      const exists = await fastify.db.get(
        "SELECT 1 FROM Friend WHERE user_id=? AND friend_id=?",
        [userId, friendId]
      );
      if (!exists) {
        await fastify.db.run(
          "INSERT INTO Friend (user_id, friend_id, status) VALUES (?, ?, 'accepted')",
          [userId, friendId]
        );
      }

      // Update friend count for both users
      await fastify.db.run(
        "UPDATE UserStats SET friends = friends + 1 WHERE user_id IN (?, ?)",
        [userId, friendId]
      );

      reply.send({ success: true });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ----------------------------
  // List friends
  // ----------------------------
  fastify.get("/user/:id/friends", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as any;
    try {
      const friends = await fastify.db.all(
        `SELECT f.friend_id AS id, u.username, f.status
         FROM Friend f
         JOIN User u ON f.friend_id = u.id
         WHERE f.user_id = ?`,
        [id]
      );
      reply.send({ success: true, friends });
    } catch (err: any) {
      reply.code(500).send({ success: false, error: err.message });
    }
  });

// ----------------------------
// Get Match History
// ----------------------------
fastify.get("/user/:id/matches", async (req, reply) => {
  const { id } = req.params as any;
  try {
    const matches = await fastify.db.all(
      "SELECT * FROM MatchHistory WHERE user_id = ? ORDER BY date DESC",
      [id]
    );
    reply.send({ success: true, matches });
  } catch (err: any) {
    reply.code(500).send({ success: false, error: err.message });
  }
});

// ----------------------------
// Update Display Name
// ----------------------------
/*
    fastify.put("/displayname", { preHandler: [fastify.authenticate] }, async (req, reply) => {
  const { nickname } = req.body as any;
  const userId = req.user.id;

  if (!nickname) return reply.code(400).send({ success: false, error: "Nickname required" });

  try {
    const existing = await fastify.db.get("SELECT * FROM Player WHERE nickname = ?", [nickname]);
    if (existing) return reply.code(409).send({ success: false, error: "Nickname already taken" });
    // try update
    const result = await fastify.db.run(
        "UPDATE Player SET nickname = ? WHERE user_id = ? AND tournament_id = 1",
        [nickname.trim(), userId]
    );
    // if no rows updated, insert
    if (result.changes === 0) {
        await fastify.db.run(
            "INSERT INTO Player (user_id, tournament_id, nickname) VALUES (?, 1, ?)",
            [userId, nickname.trim()]
        );
    }    
    reply.send({ success: true, message: "Display name updated" });
  } catch (err: any) {
    reply.code(500).send({ success: false, error: err.message });
  }
});
*/
fastify.put("/displayname", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { nickname } = req.body as any;
    const userId = req.user.id;

    if (!nickname || !nickname.trim())
        return reply.code(400).send({ success: false, error: "Nickname required" });

    try {
        const trimmedNick = nickname.trim();

        // Check if nickname is already taken for this tournament (optional)
        const existing = await fastify.db.get(
            "SELECT * FROM Player WHERE nickname = ?",
            [trimmedNick]
        );
        if (existing) return reply.code(409).send({ success: false, error: "Nickname already taken" });

        // Ensure the default tournament exists
        const tournament = await fastify.db.get(
            "SELECT tournament_id FROM Tournament WHERE tournament_id = ?",
            [1]
        );
        if (!tournament) return reply.code(400).send({ success: false, error: "Default tournament not found" });

        // Try updating first
        const result = await fastify.db.run(
            "UPDATE Player SET nickname = ? WHERE user_id = ? AND tournament_id = ?",
            [trimmedNick, userId, 1]
        );

        // If no rows updated, insert a new row
        if (result.changes === 0) {
            await fastify.db.run(
                "INSERT INTO Player (user_id, tournament_id, nickname) VALUES (?, ?, ?)",
                [userId, 1, trimmedNick]
            );
        }
        reply.send({ success: true, message: "Display name updated" });
    } catch (err: any) {
        reply.code(500).send({ success: false, error: err.message });
    }
});
// ----------------------------
// Upload Avatar
// ----------------------------
fastify.post(
  '/avatar',
  { preHandler: [fastify.authenticate] },
  async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' });
    }

    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${req.user?.id}_${Date.now()}_${data.filename}`;
    const filePath = path.join(uploadDir, filename);

    // ✅ New API — use stream or buffer instead of .toFile()
    const fileBuffer = await data.toBuffer();
    await fs.promises.writeFile(filePath, fileBuffer);

    const avatarPath = `/uploads/${filename}`;
    await fastify.db.run('UPDATE User SET avatar = ? WHERE id = ?', [
      avatarPath,
      req.user?.id,
    ]);

    reply.send({ success: true, avatar: avatarPath });
  }
);
}
