import '@fastify/jwt';
import { User } from './user';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Pick<User, 'id' | 'username'>;
    user: User;
  }
}
