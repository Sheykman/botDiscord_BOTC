
import "dotenv/config";

import {
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js";

// Récupération des identifiants
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
    throw new Error("Une variable Discord est manquante dans .env");
}

// Commande /ping
const pingCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifie si le bot fonctionne !");

// Commande /proposer
const proposerCommand = new SlashCommandBuilder()
    .setName("proposer")
    .setDescription("Propose plusieurs dates pour une soirée BOTC")
    .addStringOption(option =>
        option
            .setName("titre")
            .setDescription("Titre du sondage")
            .setRequired(true)
            .setMaxLength(100)
    );


// Commande /choisirdate
const choisirDateCommand = new SlashCommandBuilder()
    .setName("choisirdate")
    .setDescription("Choisit la date définitive d'une soirée BOTC");



// Ajout de 5 paramètres de dates
for (let i = 1; i <= 5; i++) {
    proposerCommand.addStringOption(option =>
        option
            .setName(`date${i}`)
            .setDescription(`Date proposée ${i} (JJ/MM/AAAA HH:mm)`)
            .setRequired(i === 1)
            .setMaxLength(16)
    );
}

// Commande /annuler
const annulerCommand = new SlashCommandBuilder()
    .setName("annuler")
    .setDescription("Annule une soirée BOTC")
    .addStringOption(option =>
        option
            .setName("raison")
            .setDescription("Raison de l'annulation (facultatif)")
            .setRequired(false)
            .setMaxLength(200)
    );

// Liste des commandes
const commands = [
    pingCommand.toJSON(),
    proposerCommand.toJSON(),
    choisirDateCommand.toJSON(),
    annulerCommand.toJSON()
];

// Connexion à l'API Discord
const rest = new REST({ version: "10" }).setToken(token);

// Enregistrement des commandes
async function deployCommands() {
    try {
        console.log("Enregistrement des commandes...");

        await rest.put(
            Routes.applicationGuildCommands(clientId!, guildId!),
            { body: commands }
        );

        console.log("Commandes enregistrées avec succès !");
    } catch (error) {
        console.error("Erreur lors de l'enregistrement :", error);
    }
}

deployCommands();
