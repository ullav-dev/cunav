// Notes API — Notes, NoteFolder.
import type { Note, NoteFolder } from "./types";

const BASE =
  typeof window === "undefined"
    ? (process.env.API_URL ?? "http://localhost:8085")
    : "/api";

async function apiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const listNotes = (token: string, entityType: string, entityId: string): Promise<Note[]> =>
  apiRequest(`/notes?entity_type=${entityType}&entity_id=${entityId}`, token);

export const createNote = (
  token: string,
  payload: { entity_type: string; entity_id: string; title: string; body?: string; is_shared?: boolean }
): Promise<Note> =>
  apiRequest("/notes", token, { method: "POST", body: JSON.stringify(payload) });

export const updateNote = (
  token: string,
  id: string,
  patch: { title?: string; body?: string; is_shared?: boolean }
): Promise<Note> =>
  apiRequest(`/notes/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteNote = (token: string, id: string): Promise<void> =>
  apiRequest(`/notes/${id}`, token, { method: "DELETE" });

export const listNoteReplies = (token: string, noteId: string): Promise<Note[]> =>
  apiRequest(`/notes/${noteId}/replies`, token);

export const createNoteReply = (token: string, noteId: string, body: string): Promise<Note> =>
  apiRequest(`/notes/${noteId}/replies`, token, { method: "POST", body: JSON.stringify({ body }) });

export const moveNote = (token: string, noteId: string, folderId: string | null): Promise<Note> =>
  apiRequest(`/notes/${noteId}/folder`, token, { method: "PUT", body: JSON.stringify({ folder_id: folderId }) });

export const listNoteFolders = (token: string): Promise<NoteFolder[]> =>
  apiRequest("/note-folders", token);

export const createNoteFolder = (token: string, name: string): Promise<NoteFolder> =>
  apiRequest("/note-folders", token, { method: "POST", body: JSON.stringify({ name }) });

export const updateNoteFolder = (token: string, id: string, name: string): Promise<NoteFolder> =>
  apiRequest(`/note-folders/${id}`, token, { method: "PUT", body: JSON.stringify({ name }) });

export const deleteNoteFolder = (token: string, id: string): Promise<void> =>
  apiRequest(`/note-folders/${id}`, token, { method: "DELETE" });
