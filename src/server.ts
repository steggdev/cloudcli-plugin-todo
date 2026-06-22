/**
 * Todo plugin — backend server subprocess.
 *
 * Persists todos as JSON and exposes a small REST API reached through
 * the host proxy (api.rpc). Uses only Node.js built-in modules.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

// ── Types ──────────────────────────────────────────────────────────────

interface Todo {
  id: string;
  text: string;
  done: boolean;
  project: string;
  createdAt: number;
}

// ── Persistence ────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.env.HOME || '', '.cloudcli-todo-plugin');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

function ensureStore(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function readTodos(): Todo[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

function writeTodos(todos: Todo[]): void {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf-8');
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Request helpers ────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(); // basic guard
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// ── HTTP server ────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const { pathname } = new URL(req.url || '/', 'http://localhost');

    // GET /todos -> all todos
    if (method === 'GET' && pathname === '/todos') {
      sendJson(res, 200, readTodos());
      return;
    }

    // POST /todos -> create
    if (method === 'POST' && pathname === '/todos') {
      const body = await readBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const project = typeof body.project === 'string' ? body.project : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required' });
        return;
      }
      const todo: Todo = {
        id: makeId(),
        text,
        done: false,
        project,
        createdAt: Date.now(),
      };
      const todos = readTodos();
      todos.push(todo);
      writeTodos(todos);
      sendJson(res, 201, todo);
      return;
    }

    // PATCH /todos/:id -> update
    const patchMatch = method === 'PATCH' && /^\/todos\/([^/]+)$/.exec(pathname);
    if (patchMatch) {
      const id = decodeURIComponent(patchMatch[1]);
      const body = await readBody(req);
      const todos = readTodos();
      const todo = todos.find((t) => t.id === id);
      if (!todo) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (typeof body.done === 'boolean') todo.done = body.done;
      if (typeof body.text === 'string' && body.text.trim()) todo.text = body.text.trim();
      writeTodos(todos);
      sendJson(res, 200, todo);
      return;
    }

    // DELETE /todos/:id -> delete
    const delMatch = method === 'DELETE' && /^\/todos\/([^/]+)$/.exec(pathname);
    if (delMatch) {
      const id = decodeURIComponent(delMatch[1]);
      const todos = readTodos();
      const next = todos.filter((t) => t.id !== id);
      if (next.length === todos.length) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      writeTodos(next);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message });
  }
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr !== 'string') {
    // Signal readiness to the host — this JSON line is required
    console.log(JSON.stringify({ ready: true, port: addr.port }));
  }
});
