import { FastifyInstance } from "fastify";

export default async function statsRoutes(fastify: FastifyInstance) {
  const normalizeAvatar = (avatar: string | null | undefined) => {
    if (!avatar) return "/uploads/default.png";
    if (/^https?:\/\//i.test(avatar)) return avatar;
    return avatar.startsWith("/uploads/") ? avatar : `/uploads/${avatar}`;
  };
  // Leaderboard by ELO
  fastify.get("/leaderboard", async (_, reply) => {
    const rows = await fastify.db.all(`
      SELECT U.id, U.username, U.avatar, S.elo, S.matches_played, S.winrate
      FROM UserStats S
      JOIN User U ON U.id = S.user_id
      ORDER BY S.elo DESC
      LIMIT 20
    `);
    const leaderboard = rows.map((r: any, idx: number) => ({
      ...r,
      rank: idx + 1,
      avatar: normalizeAvatar(r.avatar),
    }));
    reply.send({ success: true, leaderboard });
  });

  // Get stats for specific user
  fastify.get("/stats/:id", async (req, reply) => {
    const { id } = req.params as any;
    const stats = await fastify.db.get(
      "SELECT * FROM UserStats WHERE user_id = ?",
      [id]
    );
    reply.send(stats ?? {});
  });
}
