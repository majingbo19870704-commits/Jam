// =============================================================================
// db/knowledge-dao.ts · 知识库文件夹与 Markdown 笔记
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface NoteFolder {
  id: string;
  account_id: string;
  parent_id: string | null;
  seq_no: number;
  name: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface Note {
  id: string;
  account_id: string;
  folder_id: string | null;
  title: string;
  content: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listNoteFolders(): Promise<NoteFolder[]> {
  return query<NoteFolder>(
    `SELECT * FROM note_folder
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId()],
  );
}

export async function listNotes(): Promise<Note[]> {
  return query<Note>(
    `SELECT * FROM note
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY updated_at DESC, created_at DESC`,
    [accountId()],
  );
}

/** 按 ID 读取当前账号的一条未删除笔记。 */
export async function getNote(id: string): Promise<Note | null> {
  return queryOne<Note>(`SELECT * FROM note WHERE id = $1 AND account_id = $2 AND is_deleted = 0`, [
    id,
    accountId(),
  ]);
}

export async function createNoteFolder(
  name: string,
  parentId: string | null = null,
): Promise<NoteFolder> {
  const now = new Date().toISOString();
  const acc = accountId();
  const count = await queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM note_folder
     WHERE account_id = $1 AND is_deleted = 0
       AND (parent_id = $2 OR (parent_id IS NULL AND $2 IS NULL))`,
    [acc, parentId],
  );
  const row: NoteFolder = {
    id: uuid(),
    account_id: acc,
    parent_id: parentId,
    seq_no: (count?.n ?? 0) + 1,
    name,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO note_folder (id, account_id, parent_id, seq_no, name, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$6,0)`,
    [row.id, row.account_id, row.parent_id, row.seq_no, row.name, now],
  );
  return row;
}

export async function renameNoteFolder(id: string, name: string): Promise<void> {
  await exec(
    `UPDATE note_folder SET name = $1, updated_at = $2 WHERE id = $3 AND account_id = $4`,
    [name, new Date().toISOString(), id, accountId()],
  );
}

/** Soft-delete only the folder; its notes and children remain accessible. */
export async function deleteNoteFolder(id: string): Promise<void> {
  const acc = accountId();
  const folder = await queryOne<Pick<NoteFolder, 'parent_id'>>(
    `SELECT parent_id FROM note_folder WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, acc],
  );
  if (!folder) return;
  const now = new Date().toISOString();
  await exec(
    `UPDATE note_folder SET parent_id = $1, updated_at = $2 WHERE parent_id = $3 AND account_id = $4 AND is_deleted = 0`,
    [folder.parent_id, now, id, acc],
  );
  await exec(
    `UPDATE note SET folder_id = NULL, updated_at = $1 WHERE folder_id = $2 AND account_id = $3 AND is_deleted = 0`,
    [now, id, acc],
  );
  await exec(
    `UPDATE note_folder SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [now, id, acc],
  );
}

export async function createNote(folderId: string | null = null): Promise<Note> {
  const now = new Date().toISOString();
  const acc = accountId();
  const row: Note = {
    id: uuid(),
    account_id: acc,
    folder_id: folderId,
    title: '未命名笔记',
    content: '',
    tags: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO note (id, account_id, folder_id, title, content, tags, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,0)`,
    [row.id, row.account_id, row.folder_id, row.title, row.content, row.tags, now],
  );
  return row;
}

export async function updateNote(
  id: string,
  patch: Pick<Note, 'title' | 'content' | 'tags' | 'folder_id'>,
): Promise<void> {
  await exec(
    `UPDATE note
     SET title = $1, content = $2, tags = $3, folder_id = $4, updated_at = $5
     WHERE id = $6 AND account_id = $7 AND is_deleted = 0`,
    [
      patch.title,
      patch.content,
      patch.tags,
      patch.folder_id,
      new Date().toISOString(),
      id,
      accountId(),
    ],
  );
}

export async function deleteNote(id: string): Promise<void> {
  await exec(`UPDATE note SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`, [
    new Date().toISOString(),
    id,
    accountId(),
  ]);
}
