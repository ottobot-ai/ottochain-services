// OttoChain API Gateway
// GraphQL server with subscriptions for real-time updates

import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { createServer } from 'http';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';

import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { createContext, type Context } from './context.js';
import { getConfig } from '@ottochain/shared';

async function main() {
  const config = getConfig();
  const httpServer = createServer();
  
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

  const { url } = await startStandaloneServer(server, {
    context: createContext,
    listen: { port: config.GATEWAY_PORT },
  });

  console.log(`🚀 Gateway ready at ${url}`);
  console.log(`🔌 WebSocket subscriptions at ws://localhost:${config.GATEWAY_PORT}/graphql`);
}

main().catch(console.error);
