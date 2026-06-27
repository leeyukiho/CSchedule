import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const docs = require('./api-docs.data.js');
const rootDir = process.cwd();
const controllersDir = path.join(rootDir, 'backend', 'src', 'modules');
const httpMethods = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

const documented = new Map();
for (const group of docs.groups || []) {
  for (const endpoint of group.endpoints || []) {
    const key = routeKey(endpoint.method, endpoint.path);
    documented.set(key, { ...endpoint, group: group.title });
  }
}

const actual = new Map();
for (const file of listControllerFiles(controllersDir)) {
  for (const route of extractRoutes(file)) {
    actual.set(routeKey(route.method, route.path), route);
  }
}

const missing = [...actual.entries()].filter(([key]) => !documented.has(key));
const stale = [...documented.entries()].filter(([key]) => !actual.has(key));

printSummary();

if (missing.length || stale.length) {
  process.exitCode = 1;
}

function printSummary() {
  console.log(`API docs check: ${actual.size} code routes, ${documented.size} documented routes`);

  if (!missing.length && !stale.length) {
    console.log('OK: api-docs.data.js matches backend controller routes.');
    return;
  }

  if (missing.length) {
    console.log('\nMissing in docs:');
    for (const [, route] of missing) {
      console.log(`  ${route.method.padEnd(6)} ${route.path}  (${relative(route.file)}:${route.line})`);
    }
  }

  if (stale.length) {
    console.log('\nDocumented but not found in code:');
    for (const [, endpoint] of stale) {
      console.log(`  ${endpoint.method.padEnd(6)} ${endpoint.path}  (${endpoint.group})`);
    }
  }

  console.log('\nUpdate api-docs.data.js, then rerun: node check-api-docs.mjs');
}

function listControllerFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listControllerFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      result.push(fullPath);
    }
  }

  return result.sort();
}

function extractRoutes(file) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  const routes = [];
  let controllerPath = '';

  lines.forEach((line, index) => {
    const controllerMatch = line.match(/@Controller\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/);
    if (controllerMatch) {
      controllerPath = controllerMatch[2] || '';
      return;
    }

    const routeMatch = line.match(/@(Get|Post|Put|Patch|Delete)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/);
    if (routeMatch && httpMethods.has(routeMatch[1])) {
      routes.push({
        method: routeMatch[1].toUpperCase(),
        path: joinRoute(controllerPath, routeMatch[3] || ''),
        file,
        line: index + 1,
      });
    }
  });

  return routes;
}

function joinRoute(base, leaf) {
  const parts = [base, leaf]
    .map((item) => String(item || '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);

  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

function routeKey(method, rawPath) {
  return `${String(method).toUpperCase()} ${normalizePath(rawPath)}`;
}

function normalizePath(rawPath) {
  const withoutBase = String(rawPath || '')
    .replace(/^\/?api\/v1(?=\/|$)/, '')
    .replace(/^\/+/, '/');
  const withSlash = withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;

  return withSlash
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\{([A-Za-z0-9_]+)\}/g, '{$1}')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function relative(file) {
  return path.relative(rootDir, file).replace(/\\/g, '/');
}
