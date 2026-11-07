//! SQLite connection, schema migrations and whole-database operations (snapshots, restore).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Schema migrations in order. `PRAGMA user_version` records how many have been applied.
pub const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_library.sql"),
    include_str!("../migrations/0003_music.sql"),
    include_str!("../migrations/0004_activity.sql"),
    include_str!("../migrations/0005_custom_order.sql"),
    include_str!("../migrations/0006_playlist_once.sql"),
    include_str!("../migrations/0007_videos_tracks.sql"),
    include_str!("../migrations/0008_online.sql"),
    include_str!("../migrations/0009_one_item_per_file.sql"),
    include_str!("../migrations/0010_pictures.sql"),
    include_str!("../migrations/0011_arcade.sql"),
    include_str!("../migrations/0012_arcade_more.sql"),
];

pub struct Database {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl Database {
    /// Opens (creating if needed) and migrates the database. Before an existing library is
    /// upgraded to a newer schema, a copy is saved in `backups`.
    pub fn open(path: &Path, backups: &Path) -> AppResult<Self> {
        let mut conn = connect(path)?;
        migrate(&mut conn, backups)?;
        Ok(Self { path: path.to_path_buf(), conn: Mutex::new(conn) })
    }

    /// Runs `f` with exclusive access to the connection.
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self.conn.lock().map_err(|_| AppError::msg("database lock poisoned"))?;
        f(&mut conn)
    }

    /// Writes a consistent copy of the live database to `target` (safe while in use).
    pub fn snapshot(&self, target: &Path) -> AppResult<()> {
        self.with(|conn| snapshot(conn, target))
    }

    /// Replaces the database with `source` (a validated backup), then reopens and migrates it.
    pub fn replace_with(&self, source: &Path, backups: &Path) -> AppResult<()> {
        let mut conn = self.conn.lock().map_err(|_| AppError::msg("database lock poisoned"))?;
        let staged = self.path.with_extension("db.restoring");
        fs::copy(source, &staged)?;
        let current = std::mem::replace(&mut *conn, Connection::open_in_memory()?);
        if let Err((current, e)) = current.close() {
            *conn = current;
            let _ = fs::remove_file(&staged);
            return Err(e.into());
        }
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(PathBuf::from(format!("{}{suffix}", self.path.display())));
        }
        let reopened = fs::rename(&staged, &self.path).map_err(AppError::from).and_then(|_| {
            let mut fresh = connect(&self.path)?;
            migrate(&mut fresh, backups)?;
            Ok(fresh)
        });
        match reopened {
            Ok(fresh) => {
                *conn = fresh;
                Ok(())
            }
            Err(e) => {
                let _ = fs::remove_file(&staged);
                *conn = connect(&self.path)?;
                Err(e)
            }
        }
    }
}

fn connect(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

/// A fresh, fully migrated in-memory library for unit tests.
#[cfg(test)]
pub fn memory() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.pragma_update(None, "foreign_keys", "ON").expect("foreign keys");
    for (index, sql) in MIGRATIONS.iter().enumerate() {
        conn.execute_batch(sql).expect("migration");
        crate::reshape::after(&conn, index as i64 + 1).expect("migration");
    }
    conn
}

fn snapshot(conn: &Connection, target: &Path) -> AppResult<()> {
    if target.exists() {
        return Err(AppError::msg(format!("{} already exists", target.display())));
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
    Ok(())
}

/// Local time as `YYYYMMDD-HHMMSS`, for backup file names.
pub fn timestamp(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')", [], |row| row.get(0))?)
}

fn migrate(conn: &mut Connection, backups: &Path) -> AppResult<()> {
    let applied: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if applied > MIGRATIONS.len() as i64 {
        return Err(AppError::msg(
            "This library was saved by a newer version of Digitify. Please update Digitify to open it.",
        ));
    }
    if applied > 0 && applied < MIGRATIONS.len() as i64 {
        fs::create_dir_all(backups)?;
        let target = backups.join(format!("library-{}-before-upgrade.db", timestamp(conn)?));
        snapshot(conn, &target)?;
        log::info!("saved {} before upgrading the library schema", target.display());
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(applied.max(0) as usize) {
        let version = index as i64 + 1;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        crate::reshape::after(&tx, version)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
        log::info!("applied database migration {version}");
    }
    Ok(())
}
