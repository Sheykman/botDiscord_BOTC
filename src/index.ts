
import "dotenv/config";

import {
    Client,
    Events,
    GatewayIntentBits,
    EmbedBuilder,
    Partials,
    MessageReaction,
    User,
    PartialMessageReaction,
    PartialUser,
    ActionRowBuilder,
    StringSelectMenuBuilder
} from "discord.js";

import { randomUUID } from "node:crypto";
import { db } from "./database/database.js";

// Récupération du token
const token = process.env.DISCORD_TOKEN;

if (!token) {
    throw new Error("Le token Discord est introuvable !");
}

// Création du client Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// Événement déclenché lorsque le bot est connecté
client.once(Events.ClientReady, (readyClient) => {
    console.log(`Connecté en tant que ${readyClient.user.tag} !`);
});

// Réception des commandes Discord

client.on(Events.InteractionCreate, async (interaction) => {

    try {

        // Gestion des menus déroulants
        if (interaction.isStringSelectMenu()) {

            // Vérifier qu'il s'agit de notre menu de choix de date
            if (!interaction.customId.startsWith("choose_date:")) {
                return;
            }

            // Vérifier que la commande est utilisée dans un serveur
            if (!interaction.guild) {
                await interaction.reply({
                    content: "Cette action doit être effectuée dans un serveur.",
                    ephemeral: true
                });
                return;
            }

            // Vérifier le rôle MJ
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!member.roles.cache.some(role => role.name === "MJ")) {
                await interaction.reply({
                    content: "Seuls les MJ peuvent choisir la date.",
                    ephemeral: true
                });
                return;
            }

            // Récupérer l'identifiant du sondage
            const pollId = interaction.customId.split(":")[1];

            // Récupérer le sondage
            const poll = db.prepare(`
                SELECT id, title, message_id, selected_option_id
                FROM polls
                WHERE id = ?
                AND channel_id = ?
                AND status = 'closed'
            `).get(pollId, interaction.channelId) as {
                id: string;
                title: string;
                message_id: string | null;
                selected_option_id: string | null;
            } | undefined;

            if (!poll) {
                await interaction.reply({
                    content: "Ce sondage est introuvable ou n'est plus disponible.",
                    ephemeral: true
                });
                return;
            }

            // Empêcher de choisir plusieurs fois une date
            if (poll.selected_option_id) {
                await interaction.reply({
                    content: "Une date a déjà été choisie pour ce sondage.",
                    ephemeral: true
                });
                return;
            }

            // Récupérer la date sélectionnée
            const optionId = interaction.values[0];

            const selectedOption = db.prepare(`
                SELECT id, label
                FROM poll_options
                WHERE id = ?
                AND poll_id = ?
            `).get(optionId, poll.id) as {
                id: string;
                label: string;
            } | undefined;

            if (!selectedOption) {
                await interaction.reply({
                    content: "Cette date ne fait pas partie de ce sondage.",
                    ephemeral: true
                });
                return;
            }

            if (!poll.message_id) {
                await interaction.reply({
                    content: "Le message du sondage est introuvable.",
                    ephemeral: true
                });
                return;
            }

            // Enregistrer le choix dans SQLite
            db.prepare(`
                UPDATE polls
                SET selected_option_id = ?
                WHERE id = ?
            `).run(selectedOption.id, poll.id);

            // Récupérer les résultats du sondage
            const options = db.prepare(`
                SELECT
                    poll_options.id,
                    poll_options.label,
                    COUNT(poll_votes.user_id) AS vote_count
                FROM poll_options
                LEFT JOIN poll_votes
                    ON poll_votes.option_id = poll_options.id
                    AND poll_votes.poll_id = poll_options.poll_id
                WHERE poll_options.poll_id = ?
                GROUP BY poll_options.id, poll_options.label, poll_options.position
                ORDER BY poll_options.position
            `).all(poll.id) as {
                id: string;
                label: string;
                vote_count: number;
            }[];

            // Construire le nouvel embed
            const description = options.map((option, index) => {
                const selected = option.id === selectedOption.id
                    ? " 🏆 **DATE RETENUE**"
                    : "";

                return `**${voteEmojis[index]}** ${option.label} — **${option.vote_count} vote(s)**${selected}`;
            }).join("\n");

            const embed = new EmbedBuilder()
                .setTitle(`📅 ${poll.title}`)
                .setDescription(description)
                .setColor(0x2ECC71)
                .setFooter({
                    text: `Date choisie par le MJ : ${selectedOption.label}`
                });

            // Récupérer et modifier le message public
            const channel = await interaction.guild.channels.fetch(interaction.channelId);

            if (!channel || !channel.isTextBased() || !("messages" in channel)) {
                await interaction.reply({
                    content: "Impossible d'accéder au salon du sondage.",
                    ephemeral: true
                });
                return;
            }

            const pollMessage = await channel.messages.fetch(poll.message_id);

            await pollMessage.edit({
                embeds: [embed]
            });

            // Confirmer le choix et fermer le menu
            await interaction.update({
                content: `La date **${selectedOption.label}** a été retenue pour la soirée !`,
                components: []
            });
        }

        // Gestion des commandes slash
        if (!interaction.isChatInputCommand()) return;
        // Commande /ping
        if (interaction.commandName === "ping") {
            await interaction.reply("Pong ! 🏓");
            return;
        }

        // Commande /proposer
        if (interaction.commandName === "proposer") {

            // Accusé de réception privé pour respecter le délai Discord
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.inGuild() || !interaction.guild) {
                await interaction.editReply(
                    "Cette commande doit être utilisée sur un serveur."
                );
                return;
            }

            // Vérification du rôle MJ
            const roles = await interaction.guild.roles.fetch();
            const mjRole = roles.find(role => role.name === "MJ");

            if (!mjRole) {
                await interaction.editReply(
                    "Le rôle MJ est introuvable sur ce serveur."
                );
                return;
            }

            const member = await interaction.guild.members.fetch(
                interaction.user.id
            );

            if (!member.roles.cache.has(mjRole.id)) {
                await interaction.editReply(
                    "Seuls les MJ peuvent créer un sondage !"
                );
                return;
            }

            // Récupération du titre et des dates
            const titre = interaction.options.getString("titre", true);

            const dates: string[] = [];

            for (let i = 1; i <= 5; i++) {
                const date = interaction.options.getString(`date${i}`);

                if (date) {
                    dates.push(date);
                }
            }

            if (dates.length < 2) {
                await interaction.editReply(
                    "Tu dois proposer au moins deux dates !"
                );
                return;
            }

            if (dates.length > 5) {
                await interaction.editReply(
                    "Tu ne peux pas proposer plus de 5 dates !"
                );
                return;
            }

            // Création des identifiants
            const pollId = randomUUID();

            // Liste des options du sondage
            const pollOptions: { id: string; label: string }[] = [];

            // Enregistrement du sondage dans SQLite
            db.exec("BEGIN");

            try {
                db.prepare(`
                    INSERT INTO polls (
                        id,
                        guild_id,
                        channel_id,
                        creator_id,
                        title
                    )
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    pollId,
                    interaction.guild.id,
                    interaction.channelId,
                    interaction.user.id,
                    titre
                );

                const insertOption = db.prepare(`
                    INSERT INTO poll_options (
                        id,
                        poll_id,
                        label,
                        position
                    )
                    VALUES (?, ?, ?, ?)
                `);

                dates.forEach((date, index) => {
                    const optionId = randomUUID();

                    insertOption.run(
                        optionId,
                        pollId,
                        date,
                        index + 1
                    );

                    pollOptions.push({
                        id: optionId,
                        label: date
                    });
                });

                db.exec("COMMIT");

            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }

            // Création du message public du sondage
            const description = dates
                .map((date, index) =>
                    `**${index + 1}.** ${date} — 0 vote`
                )
                .join("\n");

            const embed = new EmbedBuilder()
                .setTitle(`📅 ${titre}`)
                .setDescription(description)
                .setColor(0x3498DB)
                .setFooter({
                    text: "Sondage BOTC • Vote bientôt disponible"
                });
            

            // Publication du sondage
            const channel = interaction.channel;

            if (!channel || !channel.isSendable()) {
                throw new Error("Impossible d'envoyer le sondage dans ce salon.");
            }

            // Publication du sondage
            const pollMessage = await channel.send({
                embeds: [embed]
            });

            // Emojis associés aux dates
            const voteEmojis = [
                "1️⃣",
                "2️⃣",
                "3️⃣",
                "4️⃣",
                "5️⃣"
            ];

            // Ajout des réactions correspondant aux dates proposées
            for (let i = 0; i < dates.length; i++) {
                await pollMessage.react(voteEmojis[i]);
            }

            // Enregistrement de l'identifiant du message Discord
            db.prepare(`
                UPDATE polls
                SET message_id = ?
                WHERE id = ?
            `).run(pollMessage.id, pollId);

            await interaction.editReply(
                "Ton sondage a bien été créé et enregistré ! 🎉"
            );
        }

        if (interaction.commandName === "cloturer") {
            // Vérifier que la commande est utilisée dans un serveur
            if (!interaction.guild) {
                await interaction.reply({
                    content: "Cette commande doit être utilisée dans un serveur.",
                    ephemeral: true
                });
                return;
            }

            // Récupérer le membre qui utilise la commande
            const member = await interaction.guild.members.fetch(interaction.user.id);

            // Vérifier son rôle MJ
            if (!member.roles.cache.some(role => role.name === "MJ")) {
                await interaction.reply({
                    content: "Seuls les MJ peuvent clôturer un sondage.",
                    ephemeral: true
                });
                return;
            }

            const poll = db.prepare(`
                SELECT id, title, message_id
                FROM polls
                WHERE channel_id = ?
                AND status = 'open'
                ORDER BY created_at DESC
                LIMIT 1
            `).get(interaction.channelId) as
                { id: string; title: string; message_id: string | null } | undefined;

            // Vérifier qu'un sondage ouvert existe
            if (!poll) {
                await interaction.reply({
                    content: "Aucun sondage ouvert n'a été trouvé dans ce salon.",
                    ephemeral: true
                });
                return;
            }

            // Clôturer le sondage dans la base de données
            db.prepare(`
                UPDATE polls
                SET status = 'closed'
                WHERE id = ?
            `).run(poll.id);


            if (!poll.message_id) {
                await interaction.reply({
                    content: "Le sondage a été clôturé, mais son message Discord est introuvable.",
                    ephemeral: true
                });
                return;
            }

            const channel = await interaction.guild.channels.fetch(interaction.channelId);

            if (!channel || !channel.isTextBased() || !("messages" in channel)) {
                await interaction.reply({
                    content: "Impossible d'accéder au salon du sondage.",
                    ephemeral: true
                });
                return;
            }

            const pollMessage = await channel.messages.fetch(poll.message_id);

            // Récupérer les résultats directement depuis SQLite
            const options = db.prepare(`
                SELECT
                    poll_options.id,
                    poll_options.label,
                    COUNT(poll_votes.user_id) AS vote_count
                FROM poll_options
                LEFT JOIN poll_votes
                    ON poll_votes.option_id = poll_options.id
                    AND poll_votes.poll_id = poll_options.poll_id
                WHERE poll_options.poll_id = ?
                GROUP BY poll_options.id, poll_options.label, poll_options.position
                ORDER BY poll_options.position
            `).all(poll.id) as {
                id: string;
                label: string;
                vote_count: number;
            }[];

            // Construire la description avec les résultats
            const description = options
                .map((option, index) =>
                    `**${voteEmojis[index]}** ${option.label} — **${option.vote_count} vote(s)**`
                )
                .join("\n");

            // Construire l'embed final
            const closedEmbed = new EmbedBuilder()
                .setTitle(`📅 ${poll.title}`)
                .setDescription(description)
                .setColor(0x95A5A6)
                .setFooter({
                    text: "Sondage BOTC • Clôturé"
                });

            // Mettre à jour le message Discord
            await pollMessage.edit({
                embeds: [closedEmbed]
            });

            // Supprimer toutes les réactions du sondage
            await pollMessage.reactions.removeAll();


            // Confirmer la clôture
            await interaction.reply({
                content: `Le sondage **${poll.title}** a été clôturé avec succès !`,
                ephemeral: true
            });
        }

        if (interaction.commandName === "choisirdate") {
            // Vérifier que la commande est utilisée dans un serveur
            if (!interaction.guild) {
                await interaction.reply({
                    content: "Cette commande doit être utilisée dans un serveur.",
                    ephemeral: true
                });
                return;
            }

            // Vérifier le rôle MJ
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!member.roles.cache.some(role => role.name === "MJ")) {
                await interaction.reply({
                    content: "Seuls les MJ peuvent choisir la date.",
                    ephemeral: true
                });
                return;
            }

            // Récupérer le dernier sondage clôturé sans date sélectionnée
            const poll = db.prepare(`
                SELECT id, title
                FROM polls
                WHERE channel_id = ?
                AND status = 'closed'
                AND selected_option_id IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            `).get(interaction.channelId) as
                { id: string; title: string } | undefined;

            if (!poll) {
                await interaction.reply({
                    content: "Aucun sondage clôturé sans date sélectionnée n'a été trouvé dans ce salon.",
                    ephemeral: true
                });
                return;
            }

            // Récupérer les dates proposées
            const options = db.prepare(`
                SELECT id, label
                FROM poll_options
                WHERE poll_id = ?
                ORDER BY position
            `).all(poll.id) as {
                id: string;
                label: string;
            }[];

            if (options.length === 0) {
                await interaction.reply({
                    content: "Ce sondage ne contient aucune date.",
                    ephemeral: true
                });
                return;
            }

            // Créer le menu déroulant
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`choose_date:${poll.id}`)
                .setPlaceholder("Sélectionne la date définitive")
                .addOptions(
                    options.map(option => ({
                        label: option.label,
                        value: option.id
                    }))
                );

            const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(selectMenu);

            await interaction.reply({
                content: `**${poll.title}**\nChoisis la date définitive de la soirée :`,
                components: [row],
                ephemeral: true
            });
        }


    } catch (error) {
        console.error("Erreur lors du traitement de l'interaction :", error);

        if (
            interaction.isChatInputCommand() ||
            interaction.isStringSelectMenu()
        ) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(
                    "Une erreur est survenue lors du traitement de cette interaction."
                ).catch(console.error);
            } else {
                await interaction.reply({
                    content: "Une erreur est survenue lors du traitement de cette interaction.",
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }

});

// Emojis associés aux positions des dates
const voteEmojis = [
    "1️⃣",
    "2️⃣",
    "3️⃣",
    "4️⃣",
    "5️⃣"
];

// Actualiser l'affichage d'un sondage
async function updatePollMessage(
    reaction: MessageReaction | PartialMessageReaction
) {
    // Récupération du message complet
    if (reaction.partial) {
        await reaction.fetch();
    }

    if (reaction.message.partial) {
        await reaction.message.fetch();
    }

    const message = reaction.message;

    // Retrouver le sondage
    const poll = db.prepare(`
        SELECT id, title, status
        FROM polls
        WHERE message_id = ?
    `).get(message.id) as
        { id: string; title: string; status: string } | undefined;

    if (!poll) return;

    // Récupérer les dates et leurs nombres de votes
    const options = db.prepare(`
        SELECT
            poll_options.id,
            poll_options.label,
            COUNT(poll_votes.user_id) AS vote_count
        FROM poll_options
        LEFT JOIN poll_votes
            ON poll_votes.option_id = poll_options.id
        WHERE poll_options.poll_id = ?
        GROUP BY poll_options.id
        ORDER BY poll_options.position
    `).all(poll.id) as {
        id: string;
        label: string;
        vote_count: number;
    }[];

    // Construire la description
    const description = options
        .map((option, index) =>
            `**${voteEmojis[index]}** ${option.label} — ${option.vote_count} vote(s)`
        )
        .join("\n");

    // Reconstruire l'embed
    const embed = new EmbedBuilder()
        .setTitle(`📅 ${poll.title}`)
        .setDescription(description)
        .setColor(0x3498DB)
        .setFooter({
            text: "Sondage BOTC • Votez avec les réactions"
        });

    // Modifier le message Discord
    await message.edit({
        embeds: [embed]
    });
}

// Fonction commune pour ajouter ou retirer un vote
async function handlePollReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    action: "add" | "remove"
) {
    // Ignorer les réactions du bot
    if (user.bot) return;

    // Récupérer les données si elles ne sont pas en cache
    if (reaction.partial) {
        await reaction.fetch();
    }

    if (reaction.message.partial) {
        await reaction.message.fetch();
    }

    // Identifier la date grâce à l'emoji
    const emoji = reaction.emoji.name;

    const position = voteEmojis.indexOf(emoji ?? "") + 1;

    if (position === 0) return;

    // Retrouver le sondage grâce au message Discord
    const poll = db.prepare(`
        SELECT id, status
        FROM polls
        WHERE message_id = ?
    `).get(reaction.message.id) as
        { id: string; status: string } | undefined;

    if (!poll || poll.status !== "open") return;

    // Retrouver la date correspondante
    const option = db.prepare(`
        SELECT id
        FROM poll_options
        WHERE poll_id = ? AND position = ?
    `).get(poll.id, position) as
        { id: string } | undefined;

    if (!option) return;

    if (action === "add") {

        // Ajouter le vote sans créer de doublon
        db.prepare(`
            INSERT OR IGNORE INTO poll_votes (
                poll_id,
                option_id,
                user_id
            )
            VALUES (?, ?, ?)
        `).run(
            poll.id,
            option.id,
            user.id
        );

    } else {

        // Retirer le vote
        db.prepare(`
            DELETE FROM poll_votes
            WHERE poll_id = ?
            AND option_id = ?
            AND user_id = ?
        `).run(
            poll.id,
            option.id,
            user.id
        );
    }
    // Actualiser le sondage
    await updatePollMessage(reaction);
}

// Détection de l'ajout d'une réaction
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        await handlePollReaction(reaction, user, "add");
    } catch (error) {
        console.error("Erreur lors de l'ajout d'un vote :", error);
    }
});

// Détection du retrait d'une réaction
client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        await handlePollReaction(reaction, user, "remove");
    } catch (error) {
        console.error("Erreur lors du retrait d'un vote :", error);
    }
});

// Connexion du bot
client.login(token);
