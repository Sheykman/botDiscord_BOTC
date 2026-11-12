
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Créer le dossier data s'il n'existe pas
mkdirSync("data", { recursive: true });

// Ouvrir ou créer la base de données
export const db = new DatabaseSync("data/botc.sqlite");

// Activer les clés étrangères
db.exec("PRAGMA foreign_keys = ON");

// Création des tables
db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        creator_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poll_options (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL,
        label TEXT NOT NULL,
        position INTEGER NOT NULL,

        UNIQUE (id, poll_id),

        FOREIGN KEY (poll_id)
            REFERENCES polls(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id TEXT NOT NULL,
        option_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        PRIMARY KEY (poll_id, option_id, user_id),

        FOREIGN KEY (option_id, poll_id)
            REFERENCES poll_options(id, poll_id)
            ON DELETE CASCADE
    );
`);


// Vérifier si la colonne selected_option_id existe déjà
const pollColumns = db.prepare(`
    PRAGMA table_info(polls)
`).all() as { name: string }[];

// Ajouter la colonne si elle n'existe pas
if (!pollColumns.some(column => column.name === "selected_option_id")) {
    db.exec(`
        ALTER TABLE polls
        ADD COLUMN selected_option_id TEXT
    `);

    console.log("Colonne selected_option_id ajoutée !");
}


console.log("Base de données initialisée !");
