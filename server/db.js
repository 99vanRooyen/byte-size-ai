// server/db.js
const Database = require("better-sqlite3");
const path = require("path");

// Creates /server/data.sqlite (if it doesn't exist yet)
const db = new Database(path.join(__dirname, "data.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_state (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

module.exports = db;
