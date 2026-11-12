import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Créer le dossier data s'il n'existe pas
mkdirSync("data", { recursive: true });

// Ouvrir ou créer la base de données
export const db = new DatabaseSync("data/botc.sqlite");
console.log("[DATABASE] Fichier utilisé :", resolve("data/botc.sqlite"));

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

    CREATE TABLE IF NOT EXISTS participants (
        poll_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (poll_id, user_id),

        FOREIGN KEY (poll_id)
            REFERENCES polls(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id TEXT NOT NULL,
        reminder_type TEXT NOT NULL CHECK (
            reminder_type IN ('2h', '30min')
        ),
        scheduled_at TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,

        UNIQUE (poll_id, reminder_type),

        FOREIGN KEY (poll_id)
            REFERENCES polls(id)
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
if (!pollColumns.some(column => column.name === "cancel_reason")) {
    db.exec(`
        ALTER TABLE polls
        ADD COLUMN cancel_reason TEXT
    `);
    console.log("Colonne cancel_reason ajoutée !");
}

// Migration : ajout du statut des participants
const participantColumns = db.prepare(`
    PRAGMA table_info(participants)
`).all() as { name: string }[];

if (!participantColumns.some(column => column.name === "status")) {
    db.exec(`
        ALTER TABLE participants
        ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'maybe'))
    `);

    console.log("Colonne status ajoutée aux participants !");
}

// Migration : ajout de l'identifiant du message d'inscription
const registrationMessageColumn = db.prepare(`
    PRAGMA table_info(polls)
`).all() as { name: string }[];

if (!registrationMessageColumn.some(column => column.name === "registration_message_id")) {
    db.exec(`
        ALTER TABLE polls
        ADD COLUMN registration_message_id TEXT
    `);
    console.log("Colonne registration_message_id ajoutée !");
}

// Ajouter la date réelle de chaque option
const optionColumns = db.prepare(`
    PRAGMA table_info(poll_options)
`).all() as { name: string }[];

if (!optionColumns.some(column => column.name === "scheduled_at")) {
    db.exec(`
        ALTER TABLE poll_options
        ADD COLUMN scheduled_at TEXT
    `);
}


console.log("Base de données initialisée !");
