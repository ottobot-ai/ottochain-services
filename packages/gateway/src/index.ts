// OttoChain API Gateway
// GraphQL server with subscriptions for real-time updates

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { createContext, type Context } from './context.js';
import { getConfig } from '@ottochain/shared';

async function main() {
  const config = getConfig();
  const app = express();
  const httpServer = createServer(app);
  
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // WebSocket server for subscriptions
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  const serverCleanup = useServer({ schema }, wsServer);

  // Apollo Server
  const server = new ApolloServer<Context>({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await server.start();

  // Apply middleware
  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    bodyParser.json(),
    expressMiddleware(server, {
      context: createContext,
    }),
  );

  // Health check
  app.get('/health', (_, res) => {
    res.json({ status: 'ok', service: 'gateway' });
  });

  // Start server
  await new Promise<void>((resolve) => {
    httpServer.listen({ port: config.GATEWAY_PORT, host: '0.0.0.0' }, resolve);
  });

  console.log(`🚀 Gateway ready at http://0.0.0.0:${config.GATEWAY_PORT}/graphql`);
  console.log(`🔌 WebSocket subscriptions at ws://0.0.0.0:${config.GATEWAY_PORT}/graphql`);
}

main().catch(console.error);
