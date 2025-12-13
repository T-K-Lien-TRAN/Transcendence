import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import fetch from 'node-fetch';

export default async function userRoutes(fastify: FastifyInstance) {
	//const getOnlineUsers = () =>
    //   (fastify as any).onlineUsers as Map<number, string> | undefined;

    // --- CORRECTION TRANSCENDENCE ---
    // 1. On récupère 'io' depuis fastify pour l'utiliser dans toutes les routes ci-dessous
    const io = (fastify as any).io;

    // 2. On récupère 'onlineUsers' et on FORCE le type en Map<number, string>
    // Cela corrige l'erreur "Property 'get' does not exist on type 'Set'"
    const onlineUsers = (fastify as any).onlineUsers as Map<number, string>;
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
    // Setup 2FA
    // ----------------------------
    fastify.post("/2fa/setup", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const userId = (req as any).user.id; // from JWT

        try {
            const secret = speakeasy.generateSecret({
                name: `Transcendence42 (${userId})`,
                length: 20,
            });

            if (!secret.base32 || !secret.otpauth_url) {
                throw new Error("Failed to generate 2FA secret or URL");
            }

            await fastify.db.run("UPDATE User SET twofa_secret = ? WHERE id = ?", [secret.base32, userId]);

            const qrCodeDataURL = await qrcode.toDataURL(secret.otpauth_url);

            reply.send({
                success: true,
                secret: secret.base32,
                qrCodeDataURL,
            });
        } catch (err: any) {
            console.error("2FA setup error:", err);
            reply.code(500).send({ success: false, error: err.message });
        }
    });

    // ----------------------------
    // Verify 2FA token
    // ----------------------------
    fastify.post("/2fa/verify", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const userId = (req as any).user.id;
        const { token } = req.body as any;

        if (!token) return reply.code(400).send({ success: false, error: "2FA token required" });

        try {
            const user = await fastify.db.get("SELECT twofa_secret FROM User WHERE id = ?", [userId]);
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
    fastify.delete("/2fa", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        console.log("Disable 2FA hit, user:", (req as any).user);
        try {
            const userId = (req as any).user.id;
            console.log("Disabling 2FA for userId:", userId);
            await fastify.db.run("UPDATE User SET twofa_secret = NULL WHERE id = ?", [userId]);
            reply.send({ success: true, message: "2FA disabled successfully" });
        } catch (err: any) {
            console.error("Error disabling 2FA:", err);
            reply.code(500).send({ success: false, error: err.message });
        }
    });
  function normalizeAvatar(avatar: string | null | undefined) {
        if (!avatar) return "/uploads/default.png";
        if (/^https?:\/\//i.test(avatar)) return avatar;
        const filename = path.basename(avatar);
        return `/uploads/${filename}`;
    }
    async function getFullUserProfile(db: any, userId: number) {
        return db.get(
            `SELECT
            u.id,
            u.username,
            u.email,
            u.avatar,
            u.twofa_secret,
            p.nickname,
            p.elo,
            p.rank,
            us.matches_played,
            us.winrate,
            us.friends
        FROM User u
        LEFT JOIN Player p ON u.id = p.user_id
        LEFT JOIN UserStats us ON u.id = us.user_id
        WHERE u.id = ?
        ORDER BY p.tournament_id DESC
        LIMIT 1`,
            [userId]
        );
    }

  // ----------------------------
  // Get user profile by ID (with stats)
  // ----------------------------
  fastify.get("/:id", { preHandler: [fastify.authenticate] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply)=> {
    const { id } = req.params as { id: string };

      try {
          const user = await getFullUserProfile(fastify.db, Number(id));
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

            const userId = req.user?.id;
        if (!userId) return reply.code(401).send({ success: false, error: 'Not authenticated' });
        try {
            const user = await getFullUserProfile(fastify.db, Number(userId));
            if (!user) return reply.code(404).send({ success: false, error: "User not found" });

            const avatar = normalizeAvatar(user.avatar);
            reply.send({ success: true, user: { ...user, avatar } });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    }
);
    async function addFriendHistoryEvent(db: any, userId: number) {
        await db.run(
            "INSERT INTO FriendsHistory (user_id, count) VALUES (?, 1)",
            [userId]
        );
    }

  // ----------------------------
  // Send friend request using username
  // ----------------------------
    fastify.post("/friend-by-username", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const { username } = req.body as any;
        const userId = req.user.id;

        if (!username) return reply.code(400).send({ success: false, error: "Username required" });

        try {
            const friend = await fastify.db.get("SELECT id FROM User WHERE username = ? OR email = ?",
            [username, username]
            );
            if (!friend) return reply.code(404).send({ success: false, error: "User not found" });
            if (friend.id === userId) return reply.code(400).send({ success: false, error: "Cannot add yourself" });

            // Prevent duplicate requests
            const existing = await fastify.db.get(
                `SELECT 1 FROM Friend
                WHERE (user_id=? AND friend_id=?)
                    OR (user_id=? AND friend_id=?)`,
                [userId, friend.id, friend.id, userId]
            );
            if (existing) return reply.code(400).send({ success: false, error: "Friend request already sent" });

            await fastify.db.run(
                "INSERT INTO Friend (user_id, friend_id, status) VALUES (?, ?, 'pending')",
                [userId, friend.id]
            );
            // --- Add notification for recipient ---
            const sender = await fastify.db.get("SELECT username FROM User WHERE id = ?", [userId]);
            const title = "New Friend Request";
            const type = "friend_request";
            const data = JSON.stringify({ fromUserId: userId, fromUsername: sender.username });

            await fastify.db.run(
                "INSERT INTO Notification (title, type, data, owner_id) VALUES (?, ?, ?, ?)",
                [title, type, data, friend.id]
            );
            // --- Ici, onlineUsers et io sont maintenant connus grâce à la déclaration en haut ---
            const friendSocketId = onlineUsers.get(friend.id);
            if (friendSocketId) {
                io.to(friendSocketId).emit("friend:request", {
                    fromUserId: userId,
                    fromUsername: (req.user as any).username
                });
                fastify.log.info(`Notification temps réel envoyée à ${friend.id}`);
            }
            reply.send({ success: true, friendId: friend.id });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    });

    //Sent requestS
    fastify.get("/:id/sent-requests", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const { id } = req.params as any;
        try {
            const sent = await fastify.db.all(
                `SELECT f.friend_id AS id, u.username, f.status
                 FROM Friend f
                 JOIN User u ON f.friend_id = u.id
                 WHERE f.user_id = ? AND (f.status = 'pending' OR f.status = 'blocked')`,
                [id]
            );
            reply.send({ success: true, sent });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    });

    // Incoming friend requests
    fastify.get("/:id/friend-requests", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const { id } = req.params as any;

        try {
            const requests = await fastify.db.all(
             `SELECT f.user_id AS id, u.username, f.status
             FROM Friend f
             JOIN User u ON f.user_id = u.id
             WHERE f.friend_id = ? AND (f.status = 'pending' OR f.status = 'blocked')`,
                [id]
            );
            reply.send({ success: true, requests });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    });

    // --- use global onlineUsers from socket.ts ---
    //const onlineUsers = fastify.onlineUsers;

    // List friends with online info
    fastify.get("/:id/friends", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const { id } = req.params as any;

        try {
            const friends = await fastify.db.all(
                `SELECT u.id, u.username
                FROM User u
                JOIN Friend f
                    ON ((f.user_id = ? AND f.friend_id = u.id)
                    OR (f.friend_id = ? AND f.user_id = u.id))
                WHERE f.status = 'accepted'`,
                [id, id]
            );

            const result = friends.map((f: any) => ({
                ...f,
                online: onlineUsers.has(f.id)   // <-- ONLINE STATUS HERE
            }));

            reply.send({ success: true, friends: result });
        } catch (err: any) {
            reply.code(500).send({ success: false, error: err.message });
        }
    });

  // ----------------------------
  // Accept friend request
  // ----------------------------
 fastify.put("/friend/accept", { preHandler: [fastify.authenticate] }, async (req, reply) => {
  const { userId } = req.body as any; // sender ID
  const friendId = (req.user as any).id; // receiver ID

  try {
    // Update the existing pending request (either direction)
/*
      const result = await fastify.db.run(
      `UPDATE Friend
       SET status='accepted'
       WHERE (user_id=? AND friend_id=?)
          OR (user_id=? AND friend_id=?)`,
      [userId, friendId, friendId, userId]
    );
    */
      const result = await fastify.db.run(
          `UPDATE Friend
         SET status = 'accepted'
         WHERE status = 'pending'
           AND (
                (user_id = ? AND friend_id = ?)
             OR (user_id = ? AND friend_id = ?)
           )`,
          [userId, friendId, friendId, userId]
      );
    // Increase stats only if the row was actually updated
      //if (result.changes > 0) {
      // Increment friends ONLY when pending -> accepted
      if (result.changes === 1) {
      await fastify.db.run(
        "UPDATE UserStats SET friends = friends + 1 WHERE user_id IN (?, ?)",
        [userId, friendId]
        );
        const senderSocketId = onlineUsers.get(userId);
        if (senderSocketId) {
            io.to(senderSocketId).emit("friend:accepted", { userId: friendId });
        }

        const receiverSocketId = onlineUsers.get(friendId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("friend:accepted", { userId: userId });
        }
    }
      await addFriendHistoryEvent(fastify.db, userId);
      await addFriendHistoryEvent(fastify.db, friendId);
    reply.send({ success: true });
  } catch (err: any) {
    reply.code(500).send({ success: false, error: err.message });
  }
});
 fastify.put("/friend/block", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { userId } = req.body as any;  // the person being blocked
    const blockerId = (req.user as any).id;

    try {
        await fastify.db.run(
            `UPDATE Friend
             SET status='blocked'
             WHERE (user_id=? AND friend_id=?)
                OR (user_id=? AND friend_id=?)`,
            [blockerId, userId, userId, blockerId]
        );
        reply.send({ success: true });
    } catch (err: any) {
        reply.code(500).send({ success: false, error: err.message });
    }
});

fastify.put("/friend/unblock", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { userId } = req.body as any;  // the person being unblocked
    const blockerId = (req.user as any).id;

    try {
        await fastify.db.run(
            `UPDATE Friend
            SET status='pending'
            WHERE (user_id=? AND friend_id=?)
            OR (user_id=? AND friend_id=?)`,
            [blockerId, userId, userId, blockerId]
        );
        reply.send({ success: true });
    } catch (err: any) {
        reply.code(500).send({ success: false, error: err.message });
    }
});

    // ----------------------------
    // Get Match History
    // ----------------------------
    fastify.get("/:id/match-history",
        { preHandler: [fastify.authenticate] },
        async (req, reply) => {

            const { id } = req.params as any;
            fastify.log.info({ id }, "Fetching match history"); 
            try {
                const rows = await fastify.db.all(
                    `SELECT 
                        mh.match_id,
                        mh.user_id,
                        u1.username AS user_name,
                        mh.opponent_id,
                        u2.username AS opponent_name,
                        mh.user_score,
                        mh.opponent_score,
                        mh.user_elo,
                        mh.date,
                        mh.result
                     FROM MatchHistory mh
                     LEFT JOIN User u1 ON mh.user_id = u1.id
                     LEFT JOIN User u2 ON mh.opponent_id = u2.id
                     WHERE mh.user_id = ? OR mh.opponent_id = ?
                     ORDER BY mh.date DESC`,
                    [id, id]
                );
                fastify.log.info({ id, rows }, "MatchHistory query result");
                reply.send({ success: true, matches: rows });

            } catch (err: any) {
                reply.code(500).send({ success: false, error: err.message });
            }
        });

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
// Update Display Name
// ----------------------------
    fastify.put("/displayname", { preHandler: [fastify.authenticate] }, async (req, reply) => {
        const { nickname } = req.body as any;
        const userId = req.user.id;

        if (!nickname || !nickname.trim())
            return reply.code(400).send({ success: false, error: "Nickname required" });

        try {
            const trimmedNick = nickname.trim();

            // Check if nickname is already taken (all players)
            const existing = await fastify.db.get(
                "SELECT 1 FROM Player WHERE nickname = ?",
                [trimmedNick]
            );
            if (existing) {
                return reply.code(409).send({ success: false, error: "Nickname already taken" });
            }

            // Update nickname for this player
            await fastify.db.run(
                "UPDATE Player SET nickname = ? WHERE user_id = ?",
                [trimmedNick, userId]
            );
            // Fetch updated user profile
            const updatedUser = await getFullUserProfile(fastify.db, userId);

            reply.send({ success: true, user: updatedUser });
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

    fastify.get("/players", async (req, reply) => {
        try {
            const players = await fastify.db.all(`
                  SELECT 
                    u.id,
                    u.username,
                    u.avatar,
                    us.elo,
                    us.matches_played,
                    us.winrate,
                    us.friends
                  FROM User u
                  JOIN UserStats us ON us.user_id = u.id
                  ORDER BY us.elo DESC
                `);

            reply.send({ players });
        } catch (err: any) {
            reply.code(500).send({ error: err.message });
        }
    });

    fastify.get("/matches", async (req, reply) => {
        try {
            const matches = await fastify.db.all(`
                  SELECT
                    mh.match_id,
                    u1.username AS user_name,
                    u2.username AS opponent_name,
                    mh.user_score,
                    mh.opponent_score,
                    mh.result,
                    mh.date
                  FROM MatchHistory mh
                  JOIN User u1 ON u1.id = mh.user_id
                  JOIN User u2 ON u2.id = mh.opponent_id
                  ORDER BY mh.date DESC
                  LIMIT 50
                `);

            reply.send({ matches });
        } catch (err: any) {
            reply.code(500).send({ error: err.message });
        }
    });

    fastify.get("/tournaments", async (request, reply) => {
        try {
            // Query tournaments with player counts
            const tournaments = await fastify.db.all(`
                  SELECT
                    t.tournament_id,
                    t.name,
                    t.status,
                    t.max_players,
                    COUNT(p.player_id) AS player_count
                  FROM Tournament t
                  LEFT JOIN Player p ON p.tournament_id = t.tournament_id
                  GROUP BY t.tournament_id
                  ORDER BY t.tournament_id DESC
                `);

            reply.send({ tournaments });
        } catch (err: any) {
            console.error("Error fetching tournaments:", err);
            reply.code(500).send({ error: "Failed to fetch tournaments" });
        }
    });

    fastify.get("/rankings", async (req, reply) => {
        try {
            const totalUsers = await fastify.db.get(
                `SELECT COUNT(*) AS count FROM User`
            );

            const totalMatches = await fastify.db.get(
                `SELECT COUNT(*) AS count FROM MatchHistory`
            );

            const ongoingTournaments = await fastify.db.get(
                `SELECT COUNT(*) AS count FROM Tournament WHERE status='ongoing'`
            );

            const topPlayers = await fastify.db.all(`
                  SELECT u.username, us.elo
                  FROM UserStats us
                  JOIN User u ON u.id = us.user_id
                  ORDER BY us.elo DESC
                  LIMIT 5
                `);

            const recentMatches = await fastify.db.all(`
                  SELECT
                    u1.username AS player,
                    u2.username AS opponent,
                    mh.result,
                    mh.date
                  FROM MatchHistory mh
                  JOIN User u1 ON u1.id = mh.user_id
                  JOIN User u2 ON u2.id = mh.opponent_id
                  ORDER BY mh.date DESC
                  LIMIT 5
                `);

            reply.send({
                totalUsers: totalUsers.count,
                totalMatches: totalMatches.count,
                ongoingTournaments: ongoingTournaments.count,
                topPlayers,
                recentMatches
            });
        } catch (err: any) {
            reply.code(500).send({ error: err.message });
        }
    });
}
