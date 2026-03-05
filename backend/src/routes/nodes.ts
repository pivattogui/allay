import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config.js';
import { nodeManager } from '../modules/agent/node-manager.js';
import type { JwtPayload } from '../types/index.js';
import { ErrorResponse } from '../schemas/common.js';

export const nodesRoutes = new Elysia({ prefix: '/api/nodes', detail: { tags: ['nodes'] } })
  .use(jwt({ name: 'jwt', secret: config.jwt.secret, exp: config.jwt.expiresIn }))
  .post('/register', async ({ body, headers, set }) => {
    const auth = headers.authorization;
    if (!auth?.startsWith('Bearer ') || auth.slice(7) !== config.agent.token) {
      set.status = 401;
      return { error: 'Unauthorized', code: 'UNAUTHORIZED' };
    }

    const { name, host, port, resources } = body as {
      name: string;
      host: string;
      port: number;
      resources: { cpuCores?: number; ramTotalMb?: number; diskTotalGb?: number };
    };

    try {
      const result = await nodeManager.register({ name, host, port, resources });
      return { nodeId: result.nodeId };
    } catch (err) {
      set.status = 500;
      return { error: 'Registration failed', code: 'REGISTRATION_FAILED' };
    }
  }, {
    detail: {
      summary: 'Register agent node',
      description: 'Called by an agent to register itself with the controller',
    },
  })
  .resolve(async ({ jwt: jwtPlugin, headers, set }) => {
    const auth = headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Unauthorized');
    }
    const payload = await jwtPlugin.verify(auth.slice(7));
    if (!payload) {
      set.status = 401;
      throw new Error('Unauthorized');
    }
    return { user: payload as unknown as JwtPayload };
  })
  .get('/', async () => {
    const allNodes = await nodeManager.getAllNodes();
    return { nodes: allNodes };
  }, {
    response: {
      200: t.Object({ nodes: t.Array(t.Any()) }),
      401: ErrorResponse,
    },
    detail: {
      summary: 'List all nodes',
      description: 'Get a list of all registered agent nodes',
      security: [{ bearerAuth: [] }],
    },
  })
  .get('/:id', async ({ params, set }) => {
    const node = await nodeManager.getNode(params.id);
    if (!node) {
      set.status = 404;
      return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
    }
    return { node };
  }, {
    params: t.Object({ id: t.String() }),
    response: {
      200: t.Object({ node: t.Any() }),
      401: ErrorResponse,
      404: ErrorResponse,
    },
    detail: {
      summary: 'Get node details',
      security: [{ bearerAuth: [] }],
    },
  })
  .delete('/:id', async ({ params, set }) => {
    try {
      await nodeManager.deleteNode(params.id);
      return { message: 'Node deleted' };
    } catch (err: any) {
      set.status = 400;
      return { error: err.message, code: 'DELETE_FAILED' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    response: {
      200: t.Object({ message: t.String() }),
      400: ErrorResponse,
      401: ErrorResponse,
    },
    detail: {
      summary: 'Delete node',
      security: [{ bearerAuth: [] }],
    },
  });
