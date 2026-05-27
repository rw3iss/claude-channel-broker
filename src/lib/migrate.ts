import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface MigrationFile {
  name: string;
  sql: string;
}

export function loadMigrationsFromDir(dir: string): MigrationFile[] {
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return entries.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(dir, name), 'utf8'),
  }));
}

export function runMigrations(
  db: Database.Database,
  migrations: MigrationFile[],
): { applied: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const checkStmt = db.prepare<[string]>(
    `SELECT 1 FROM _migrations WHERE name = ?`,
  );
  const insertStmt = db.prepare<[string, number]>(
    `INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`,
  );

  const applied: string[] = [];
  const tx = db.transaction((files: MigrationFile[]) => {
    for (const file of files) {
      if (checkStmt.get(file.name)) continue;
      db.exec(file.sql);
      insertStmt.run(file.name, Date.now());
      applied.push(file.name);
    }
  });
  tx(migrations);

  return { applied };
}

export function appliedMigrations(db: Database.Database): string[] {
  const exists = db
    .prepare<[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    )
    .get();
  if (!exists) return [];
  return db
    .prepare<[]>(`SELECT name FROM _migrations ORDER BY name`)
    .all()
    .map((r: unknown) => (r as { name: string }).name);
}
