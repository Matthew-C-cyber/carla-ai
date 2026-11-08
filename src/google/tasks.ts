import { google, type tasks_v1 } from 'googleapis';
import { UserFacingError } from '../errors';
import type { OAuthClient } from './auth';

export type Task = tasks_v1.Schema$Task;

/** The user's default task list ("My Tasks"). */
const LIST = '@default';
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; tasks: Task[] }>();

function api(auth: OAuthClient) {
  return google.tasks({ version: 'v1', auth });
}

/** Google Tasks stores only a date; the time part must be midnight UTC. */
export function dueFromDate(isoDate: string): string {
  return `${isoDate}T00:00:00.000Z`;
}

/** "YYYY-MM-DD" from a task's due field, read without any timezone shift. */
export function dueDate(task: Task): string | null {
  return task.due ? task.due.slice(0, 10) : null;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const doneA = a.status === 'completed' ? 1 : 0;
    const doneB = b.status === 'completed' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    const dueA = dueDate(a) ?? '9999-12-31';
    const dueB = dueDate(b) ?? '9999-12-31';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

export async function listTasks(auth: OAuthClient, includeCompleted = false): Promise<Task[]> {
  const items: Task[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api(auth).tasks.list({
      tasklist: LIST,
      showCompleted: includeCompleted,
      showHidden: includeCompleted, // tasks completed in Google's own apps are "hidden"
      maxResults: 100,
      pageToken,
    });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && items.length < 300);
  return sortTasks(items.filter((t) => t.title?.trim()));
}

export async function createTask(
  auth: OAuthClient,
  input: { title: string; notes?: string | null; due?: string | null },
): Promise<Task> {
  const res = await api(auth).tasks.insert({
    tasklist: LIST,
    requestBody: { title: input.title, notes: input.notes ?? undefined, due: input.due ?? undefined },
  });
  return res.data;
}

export async function patchTask(auth: OAuthClient, taskId: string, body: Task): Promise<Task> {
  const res = await api(auth).tasks.patch({ tasklist: LIST, task: taskId, requestBody: body });
  return res.data;
}

export async function completeTask(auth: OAuthClient, taskId: string): Promise<Task> {
  return patchTask(auth, taskId, { status: 'completed' });
}

export async function reopenTask(auth: OAuthClient, taskId: string): Promise<Task> {
  return patchTask(auth, taskId, { status: 'needsAction', completed: null });
}

export async function deleteTask(auth: OAuthClient, taskId: string): Promise<void> {
  await api(auth).tasks.delete({ tasklist: LIST, task: taskId });
}

// ---------- autocomplete support ----------

/** All tasks (open + completed), cached briefly so autocomplete stays fast. */
export async function cachedTasks(discordId: string, auth: OAuthClient): Promise<Task[]> {
  const hit = cache.get(discordId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tasks;
  const tasks = await listTasks(auth, true);
  cache.set(discordId, { at: Date.now(), tasks });
  return tasks;
}

export function invalidateTasks(discordId: string): void {
  cache.delete(discordId);
}

/**
 * Autocomplete fills the option with the task ID. If the user typed text instead,
 * fall back to matching the title so `/tasks complete task:Buy milk` still works.
 */
export async function resolveTask(discordId: string, auth: OAuthClient, input: string): Promise<Task> {
  const tasks = await cachedTasks(discordId, auth);
  const needle = input.trim().toLowerCase();
  const found =
    tasks.find((t) => t.id === input) ??
    tasks.find((t) => t.title?.trim().toLowerCase() === needle) ??
    tasks.find((t) => t.title?.toLowerCase().includes(needle));
  if (!found?.id) throw new UserFacingError(`No task matches "${input}". Pick one from the suggestions list.`);
  return found;
}
