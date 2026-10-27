import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Express } from 'express';
import { createApp } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    schemas?: Record<
      string,
      { type?: string; required?: string[]; properties?: Record<string, unknown> }
    >;
  };
}

/**
 * Traverses Express router stack layers to extract registered route methods and normalized paths.
 */
function extractExpressRoutes(app: Express): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  interface ExpressLayer {
    route?: {
      path: string;
      methods: Record<string, boolean>;
    };
    name?: string;
    regexp?: RegExp;
    handle?: {
      stack?: ExpressLayer[];
    };
  }

  function walk(stack: ExpressLayer[], prefix = ''): void {
    for (const layer of stack) {
      if (layer.route) {
        const subPath = layer.route.path === '/' && prefix !== '' ? '' : layer.route.path;
        const fullPath = prefix + subPath;
        // Convert Express :param to OpenAPI {param}
        const openApiPath = fullPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({
            method: method.toUpperCase(),
            path: openApiPath,
          });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let mount = '';
        if (layer.regexp) {
          const match = /^\^\\\/([a-zA-Z0-9_-]+)/.exec(layer.regexp.source);
          if (match) {
            mount = '/' + match[1];
          }
        }
        walk(layer.handle.stack, prefix + mount);
      }
    }
  }

  // Access internal stack for route introspection
  const internalStack = (app as unknown as { _router?: { stack: ExpressLayer[] } })._router?.stack;
  if (internalStack) {
    walk(internalStack);
  }

  return routes;
}

describe('OpenAPI Specification Integrity & Anti-Drift Tests', () => {
  const apiSpecPath = join(__dirname, 'openapi.json');
  const docsSpecPath = join(__dirname, '../../../docs/openapi.json');

  const apiSpecContent = readFileSync(apiSpecPath, 'utf-8');
  const docsSpecContent = readFileSync(docsSpecPath, 'utf-8');
  const spec = JSON.parse(apiSpecContent) as OpenApiDocument;

  it('ensures services/api/src/openapi.json and docs/openapi.json are identical and synchronized', () => {
    expect(JSON.parse(apiSpecContent)).toEqual(JSON.parse(docsSpecContent));
  });

  it('validates OpenAPI document structure and metadata', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Flood Rescue Resource Allocation Platform API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.servers).toBeInstanceOf(Array);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.paths).toBeDefined();
    expect(spec.components?.schemas).toBeDefined();
  });

  it('serves OpenAPI spec at GET /openapi.json with HTTP 200', async () => {
    const app = createApp();
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Flood Rescue Resource Allocation Platform API');
  });

  it('verifies that every registered Express endpoint is documented in the OpenAPI specification (zero drift)', () => {
    const app = createApp();
    const registeredRoutes = extractExpressRoutes(app);

    expect(registeredRoutes.length).toBeGreaterThan(0);

    for (const route of registeredRoutes) {
      const pathItem = spec.paths[route.path];
      expect(
        pathItem,
        `Express route [${route.method}] ${route.path} is missing from OpenAPI spec.paths`,
      ).toBeDefined();

      const operation = pathItem?.[route.method.toLowerCase()];
      expect(
        operation,
        `Method [${route.method}] for path ${route.path} is missing from OpenAPI spec`,
      ).toBeDefined();
    }
  });

  it('verifies that every OpenAPI operation corresponds to a real registered Express route (no phantom endpoints)', () => {
    const app = createApp();
    const registeredRoutes = extractExpressRoutes(app);

    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
      for (const methodStr of Object.keys(pathItem)) {
        const method = methodStr.toUpperCase();
        const exists = registeredRoutes.some((r) => r.path === pathStr && r.method === method);
        expect(
          exists,
          `OpenAPI operation [${method}] ${pathStr} has no corresponding registered Express route`,
        ).toBe(true);
      }
    }
  });

  it('verifies that all component $ref references resolve to defined schemas', () => {
    const schemas = spec.components?.schemas ?? {};
    const specString = JSON.stringify(spec);

    const refRegex = /"\$ref":\s*"#\/components\/schemas\/([a-zA-Z0-9_]+)"/g;
    let match: RegExpExecArray | null;

    const referencedSchemas = new Set<string>();
    while ((match = refRegex.exec(specString)) !== null) {
      referencedSchemas.add(match[1]!);
    }

    expect(referencedSchemas.size).toBeGreaterThan(0);
    for (const schemaName of referencedSchemas) {
      expect(
        schemas[schemaName],
        `Schema "$ref: #/components/schemas/${schemaName}" is referenced but not defined in components.schemas`,
      ).toBeDefined();
    }
  });

  it('verifies schema property alignment between OpenAPI spec and platform data contracts', () => {
    const schemas = spec.components?.schemas ?? {};

    // CreateRescueRequest schema alignment
    const createReq = schemas['CreateRescueRequest'];
    expect(createReq).toBeDefined();
    expect(createReq?.required).toEqual(
      expect.arrayContaining(['lat', 'lng', 'peopleCount', 'urgency']),
    );
    expect(createReq?.properties?.['lat']).toBeDefined();
    expect(createReq?.properties?.['lng']).toBeDefined();
    expect(createReq?.properties?.['peopleCount']).toBeDefined();
    expect(createReq?.properties?.['urgency']).toBeDefined();

    // CommitAssignmentRequest schema alignment
    const commitReq = schemas['CommitAssignmentRequest'];
    expect(commitReq).toBeDefined();
    expect(commitReq?.required).toEqual(['operatorId']);

    // RouteStop schema alignment
    const routeStop = schemas['RouteStop'];
    expect(routeStop).toBeDefined();
    expect(routeStop?.required).toEqual(
      expect.arrayContaining([
        'stopNumber',
        'type',
        'targetId',
        'lat',
        'lng',
        'passengersPickedUp',
        'passengersDroppedOff',
        'estimatedArrivalMinutes',
      ]),
    );
  });
});
