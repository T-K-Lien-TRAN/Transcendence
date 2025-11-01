import { FastifyPluginAsync } from 'fastify';

interface OAuth2PluginOptions {
  credentials: {
    client: { id: string; secret: string };
    auth: any;
  };
  startRedirectPath?: string;
  callbackUri?: string;
  scope?: string[];
}

declare const fastifyOauth2: FastifyPluginAsync<OAuth2PluginOptions> & {
  FORTYTWO_CONFIGURATION: any;
};

export default fastifyOauth2;
