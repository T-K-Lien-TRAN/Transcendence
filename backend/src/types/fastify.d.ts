// backend/src/types/fastify.d.ts

import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    jwt: any;
    authenticate: any;
    fortytwoOAuth2: any;
    db:any; // your database plugin
  }

  interface FastifyRequest {
    user?: import('./user').User;
  }
}
