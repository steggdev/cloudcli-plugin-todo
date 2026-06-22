/**
 * Todo plugin — module entry point.
 *
 * The host calls mount(container, api) when the plugin tab is activated and
 * unmount(container) when it is torn down. All backend calls go through
 * api.rpc; the UI respects the active theme and re-renders on context change.
 */

import type { PluginAPI, PluginContext } from './types.js';

// ── Types ──────────────────────────────────────────────────────────────

interface Todo {
  id: string;
  text: string;
  done: boolean;
  project: string;
  createdAt: number;
}

interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
}

function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        bg: '#0e0e1a',
        surface: '#16162a',
        border: '#262640',
        text: '#e2e0f0',
        muted: '#7c7aa0',
        accent: '#6366f1',
        danger: '#f43f5e',
      }
    : {
        bg: '#fafaf9',
        surface: '#ffffff',
        border: '#e8e6f0',
        text: '#15141f',
        muted: '#8a87a5',
        accent: '#6366f1',
        danger: '#e11d48',
      };
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// ── Mount / Unmount ────────────────────────────────────────────────────

export function mount(container: HTMLElement, api: PluginAPI): void {
  let todos: Todo[] = [];
  let projectOnly = false;
  let loaded = false;
  let errorMsg = '';

  const root = document.createElement('div');
  Object.assign(root.style, {
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding: '16px',
    fontFamily: FONT,
  });
  container.appendChild(root);

  function currentProjectPath(): string {
    return api.context.project?.path ?? '';
  }

  function visibleTodos(): Todo[] {
    const p = currentProjectPath();
    const list = projectOnly && p ? todos.filter((t) => t.project === p) : todos;
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }

  async function loadTodos(): Promise<void> {
    try {
      const data = (await api.rpc('GET', '/todos')) as Todo[];
      todos = Array.isArray(data) ? data : [];
      errorMsg = '';
    } catch (err) {
      errorMsg = (err as Error).message;
    }
    loaded = true;
    render();
  }

  async function addTodo(text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    try {
      const todo = (await api.rpc('POST', '/todos', {
        text: value,
        project: currentProjectPath(),
      })) as Todo;
      todos.push(todo);
      errorMsg = '';
    } catch (err) {
      errorMsg = (err as Error).message;
    }
    render();
  }

  async function toggleTodo(todo: Todo): Promise<void> {
    try {
      const updated = (await api.rpc('PATCH', `/todos/${encodeURIComponent(todo.id)}`, {
        done: !todo.done,
      })) as Todo;
      const i = todos.findIndex((t) => t.id === todo.id);
      if (i >= 0) todos[i] = updated;
      errorMsg = '';
    } catch (err) {
      errorMsg = (err as Error).message;
    }
    render();
  }

  async function deleteTodo(todo: Todo): Promise<void> {
    try {
      await api.rpc('DELETE', `/todos/${encodeURIComponent(todo.id)}`);
      todos = todos.filter((t) => t.id !== todo.id);
      errorMsg = '';
    } catch (err) {
      errorMsg = (err as Error).message;
    }
    render();
  }

  function render(): void {
    const ctx: PluginContext = api.context;
    const c = themeColors(ctx.theme === 'dark');
    root.style.background = c.bg;
    root.style.color = c.text;
    root.innerHTML = '';

    // Header / add form
    const header = document.createElement('div');
    Object.assign(header.style, { maxWidth: '640px', margin: '0 auto' });

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: '1.15rem',
      fontWeight: '700',
      marginBottom: '12px',
      letterSpacing: '-0.01em',
    });
    title.textContent = 'Todo';
    header.appendChild(title);

    const form = document.createElement('form');
    Object.assign(form.style, { display: 'flex', gap: '8px', marginBottom: '12px' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a todo…';
    Object.assign(input.style, {
      flex: '1',
      minWidth: '0',
      padding: '10px 12px',
      fontSize: '0.9rem',
      fontFamily: FONT,
      color: c.text,
      background: c.surface,
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
      outline: 'none',
      boxSizing: 'border-box',
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.textContent = 'Add';
    Object.assign(addBtn.style, {
      flexShrink: '0',
      padding: '10px 18px',
      fontSize: '0.9rem',
      fontWeight: '600',
      fontFamily: FONT,
      color: '#fff',
      background: c.accent,
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
    });

    form.appendChild(input);
    form.appendChild(addBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      void addTodo(v);
    });
    header.appendChild(form);

    // Project-only toggle
    const toggleRow = document.createElement('label');
    Object.assign(toggleRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '0.8rem',
      color: c.muted,
      marginBottom: '14px',
      cursor: ctx.project ? 'pointer' : 'not-allowed',
      userSelect: 'none',
    });
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = projectOnly;
    toggle.disabled = !ctx.project;
    toggle.style.cursor = ctx.project ? 'pointer' : 'not-allowed';
    toggle.addEventListener('change', () => {
      projectOnly = toggle.checked;
      render();
    });
    const toggleText = document.createElement('span');
    toggleText.textContent = ctx.project
      ? `Current project only${projectOnly ? ` · ${ctx.project.name}` : ''}`
      : 'Current project only (no project selected)';
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(toggleText);
    header.appendChild(toggleRow);

    // Error
    if (errorMsg) {
      const err = document.createElement('div');
      Object.assign(err.style, {
        padding: '10px 12px',
        marginBottom: '12px',
        fontSize: '0.8rem',
        color: c.danger,
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: '8px',
      });
      err.textContent = `✗ ${errorMsg}`;
      header.appendChild(err);
    }

    // List
    const list = document.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

    const items = visibleTodos();

    if (!loaded) {
      const loading = document.createElement('div');
      Object.assign(loading.style, { padding: '24px 4px', fontSize: '0.85rem', color: c.muted });
      loading.textContent = 'Loading…';
      list.appendChild(loading);
    } else if (items.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, {
        padding: '32px 16px',
        textAlign: 'center',
        fontSize: '0.85rem',
        color: c.muted,
      });
      empty.textContent = projectOnly && ctx.project ? 'No todos for this project yet.' : 'No todos yet.';
      list.appendChild(empty);
    } else {
      for (const todo of items) {
        list.appendChild(renderRow(todo, c));
      }
    }

    header.appendChild(list);
    root.appendChild(header);
  }

  function renderRow(todo: Todo, c: ThemeColors): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 12px',
      background: c.surface,
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
    });

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = todo.done;
    Object.assign(check.style, { flexShrink: '0', width: '16px', height: '16px', cursor: 'pointer' });
    check.addEventListener('change', () => void toggleTodo(todo));

    const text = document.createElement('span');
    text.textContent = todo.text;
    Object.assign(text.style, {
      flex: '1',
      minWidth: '0',
      fontSize: '0.9rem',
      wordBreak: 'break-word',
      color: todo.done ? c.muted : c.text,
      textDecoration: todo.done ? 'line-through' : 'none',
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Delete';
    Object.assign(del.style, {
      flexShrink: '0',
      width: '26px',
      height: '26px',
      lineHeight: '1',
      fontSize: '0.8rem',
      color: c.muted,
      background: 'transparent',
      border: `1px solid ${c.border}`,
      borderRadius: '6px',
      cursor: 'pointer',
    });
    del.addEventListener('mouseover', () => {
      del.style.color = c.danger;
      del.style.borderColor = c.danger;
    });
    del.addEventListener('mouseout', () => {
      del.style.color = c.muted;
      del.style.borderColor = c.border;
    });
    del.addEventListener('click', () => void deleteTodo(todo));

    row.appendChild(check);
    row.appendChild(text);
    row.appendChild(del);
    return row;
  }

  // Initial load + react to context (theme / project) changes
  void loadTodos();

  const unsubscribe = api.onContextChange(() => {
    render();
  });

  (container as any)._todoUnsubscribe = unsubscribe;
}

export function unmount(container: HTMLElement): void {
  if (typeof (container as any)._todoUnsubscribe === 'function') {
    (container as any)._todoUnsubscribe();
    delete (container as any)._todoUnsubscribe;
  }
  container.innerHTML = '';
}
