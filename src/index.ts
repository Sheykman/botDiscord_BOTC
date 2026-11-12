import "dotenv/config";
import cron from "node-cron";

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
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    StringSelectMenuBuilder,
    ChatInputCommandInteraction,
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
    // Vérifier les rappels toutes les minutes
    cron.schedule("* * * * *", () => {
        console.log("[CRON] Vérification des rappels déclenchée.");

        checkReminders().catch(error => {
            console.error("Erreur lors de la vérification des rappels :", error);
        });
    });

    // Vérifier immédiatement les rappels au démarrage
    checkReminders().catch(error => {
        console.error("Erreur lors de la vérification initiale des rappels :", error);
    });
});


async function updateRegistrationMessage(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    pollId: string
) {
    // Récupérer les informations du sondage
    const poll = db.prepare(`
        SELECT
            id,
            title,
            channel_id,
            registration_message_id,
            selected_option_id,
            status,
            cancel_reason
        FROM polls
        WHERE id = ?
    `).get(pollId) as {
        id: string;
        title: string;
        channel_id: string;
        registration_message_id: string | null;
        selected_option_id: string | null;
        status: string;
        cancel_reason: string | null;
    } | undefined;

    if (!poll || !poll.registration_message_id) return;

    // Récupérer la date retenue
    const selectedOption = db.prepare(`
        SELECT label
        FROM poll_options
        WHERE id = ?
    `).get(poll.selected_option_id) as {
        label: string;
    } | undefined;

    // Récupérer les participants
    const participants = db.prepare(`
        SELECT user_id, status
        FROM participants
        WHERE poll_id = ?
        ORDER BY joined_at ASC
    `).all(poll.id) as {
        user_id: string;
        status: "confirmed" | "maybe";
    }[];

    const confirmed = participants.filter(
        participant => participant.status === "confirmed"
    );

    const maybe = participants.filter(
        participant => participant.status === "maybe"
    );

    // Construire les listes de mentions
    const confirmedList = confirmed.length > 0
        ? confirmed.map(p => `<@${p.user_id}>`).join("\n")
        : "Aucun participant pour le moment.";

    const maybeList = maybe.length > 0
        ? maybe.map(p => `<@${p.user_id}>`).join("\n")
        : "Aucun joueur indécis pour le moment.";

    // Construire le nouvel embed
    const isCancelled = poll.status === "cancelled";

    const registrationEmbed = new EmbedBuilder()
        .setTitle(
            isCancelled
                ? `❌ Soirée annulée — ${poll.title}`
                : `🎲 Inscriptions — ${poll.title}`
        )
        .setDescription(
            (isCancelled
                ? `**Cette soirée a été annulée.**\n` +
                `Raison : ${poll.cancel_reason ?? "Aucune raison précisée."}\n\n`
                : ""
            ) +
            `📅 **Date retenue :** ${selectedOption?.label ?? "Non définie"}\n\n` +
            `**✅ Participants (${confirmed.length}/16)**\n` +
            `${confirmedList}\n\n` +
            `**❔ Peut-être (${maybe.length})**\n` +
            `${maybeList}`
        )
        .setColor(isCancelled ? 0xE74C3C : 0x3498DB);

    // Récupérer et modifier le message Discord
    const channel = await interaction.guild!.channels.fetch(
        poll.channel_id
    );

    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
        console.error("Impossible de retrouver le salon des inscriptions.");
        return;
    }

    const message = await channel.messages.fetch(
        poll.registration_message_id
    );

    await message.edit({
        embeds: [registrationEmbed],
        components: isCancelled ? [] : message.components
    });
}

async function checkReminders() {
    // Récupérer les rappels arrivés à échéance
    const now = formatLocalDateTime(new Date());

    const reminders = db.prepare(`
        SELECT
            scheduled_reminders.id,
            scheduled_reminders.poll_id,
            scheduled_reminders.reminder_type,
            polls.title
        FROM scheduled_reminders
        INNER JOIN polls
            ON polls.id = scheduled_reminders.poll_id
        WHERE scheduled_reminders.sent = 0
        AND scheduled_reminders.scheduled_at <= ?
        AND polls.status = 'closed'
    `).all(now) as {
        id: number;
        poll_id: string;
        reminder_type: "2h" | "30min";
        title: string;
    }[];

    // Traiter chaque rappel
    for (const reminder of reminders) {
        // Récupérer les participants confirmés
        const participants = db.prepare(`
            SELECT user_id
            FROM participants
            WHERE poll_id = ?
            AND status = 'confirmed'
        `).all(reminder.poll_id) as {
            user_id: string;
        }[];

        const delay = reminder.reminder_type === "2h"
            ? "2 heures"
            : "30 minutes";

        // Envoyer un message privé à chaque participant
        for (const participant of participants) {
            try {
                const user = await client.users.fetch(participant.user_id);

                await user.send(
                    `⏰ **Rappel Blood on the Clocktower**\n\n` +
                    `La soirée **${reminder.title}** commence dans ${delay} !`
                );
            } catch (error) {
                console.error(
                    `Impossible d'envoyer le rappel à ${participant.user_id} :`,
                    error
                );
            }
        }

        // Marquer le rappel comme envoyé
        db.prepare(`
            UPDATE scheduled_reminders
            SET sent = 1
            WHERE id = ?
        `).run(reminder.id);

        console.log(
            `Rappel ${reminder.reminder_type} traité pour "${reminder.title}".`
        );
    }
}

function parseEventDate(value: string): {
    date: Date;
    label: string;
} | null {
    const match = value.match(
        /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/
    );

    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);

    const date = new Date(year, month - 1, day, hours, minutes);

    // Vérifier que la date existe réellement
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hours ||
        date.getMinutes() !== minutes
    ) {
        return null;
    }

    const label = new Intl.DateTimeFormat("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);

    return {
        date,
        label: label.replace(":", "h")
    };
}

function formatLocalDateTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

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
                AND status = 'open'
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
                SELECT id, label, scheduled_at
                FROM poll_options
                WHERE id = ?
                AND poll_id = ?
            `).get(optionId, poll.id) as {
                id: string;
                label: string;
                scheduled_at: string | null;
            } | undefined;

            // Vérifier que la date existe
            if (!selectedOption) {
                await interaction.reply({
                    content: "Cette date ne fait pas partie de ce sondage.",
                    ephemeral: true
                });
                return;
            }

            // Vérifier que la date est exploitable
            if (!selectedOption.scheduled_at) {
                await interaction.reply({
                    content: "Cette option ne possède pas de date exploitable. Crée un nouveau sondage.",
                    ephemeral: true
                });
                return;
            }

            const eventDate = new Date(selectedOption.scheduled_at);

            if (Number.isNaN(eventDate.getTime())) {
                await interaction.reply({
                    content: "La date de cette soirée est invalide.",
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

            // Enregistrer le choix et clôturer le sondage
            db.prepare(`
                UPDATE polls
                SET selected_option_id = ?,
                    status = 'closed'
                WHERE id = ?
            `).run(selectedOption.id, poll.id);

            // Calculer les horaires des rappels
            const reminder2h = new Date(
                eventDate.getTime() - 2 * 60 * 60 * 1000
            );

            const reminder30min = new Date(
                eventDate.getTime() - 30 * 60 * 1000
            );

            // Préparer l'enregistrement des rappels
            const insertReminder = db.prepare(`
                INSERT OR IGNORE INTO scheduled_reminders (
                    poll_id,
                    reminder_type,
                    scheduled_at
                )
                VALUES (?, ?, ?)
            `);

            // Enregistrer les deux rappels
            insertReminder.run(
                poll.id,
                "2h",
                formatLocalDateTime(reminder2h)
            );

            insertReminder.run(
                poll.id,
                "30min",
                formatLocalDateTime(reminder30min)
            );

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

            // Récupérer les identifiants des votants pour chaque date
            const voters = db.prepare(`
                SELECT option_id, user_id
                FROM poll_votes
                WHERE poll_id = ?
            `).all(poll.id) as {
                option_id: string;
                user_id: string;
            }[];

            // Construire le nouvel embed avec les noms des votants
            const description = await Promise.all(
                options.map(async (option, index) => {

                    // Récupérer les votants de cette date
                    const optionVoters = voters.filter(
                        voter => voter.option_id === option.id
                    );

                    // Récupérer les noms Discord
                    const voterNames = await Promise.all(
                        optionVoters.map(async voter => {
                            try {
                                const member = await interaction.guild!.members.fetch(voter.user_id);
                                return `- <@${member.id}>`;
                            } catch (error) {
                                console.error(
                                    `Impossible de récupérer l'utilisateur ${voter.user_id}`,
                                    error
                                );

                                return "- Utilisateur inconnu";
                            }
                        })
                    );

                    const selected = option.id === selectedOption.id
                        ? " 🏆 **DATE RETENUE**"
                        : "";

                    const voterList = voterNames.length > 0
                        ? voterNames.join("\n")
                        : "- Aucun votant";

                    return (
                        `**${voteEmojis[index]} ${option.label}** — **${option.vote_count} vote(s)**${selected}\n` +
                        `${voterList}`
                    );
                })
            ).then(results => results.join("\n\n"));

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
                embeds: [embed],
                components: []
            });

            // Créer les boutons d'inscription
            const registrationButtons = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`join:${poll.id}`)
                        .setLabel("Je participe")
                        .setEmoji("✅")
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`maybe:${poll.id}`)
                        .setLabel("Peut-être")
                        .setEmoji("❔")
                        .setStyle(ButtonStyle.Secondary),

                    new ButtonBuilder()
                        .setCustomId(`leave:${poll.id}`)
                        .setLabel("Me désinscrire")
                        .setEmoji("❌")
                        .setStyle(ButtonStyle.Danger)
                );

            // Supprimer les réactions du sondage
            await pollMessage.reactions.removeAll();

            // Créer le message dédié aux inscriptions
            const registrationEmbed = new EmbedBuilder()
                .setTitle(`🎲 Inscriptions — ${poll.title}`)
                .setDescription(
                    `📅 **Date retenue :** ${selectedOption.label}\n\n` +
                    `**✅ Participants (0/16)**\n` +
                    `Aucun participant pour le moment.\n\n` +
                    `**❔ Peut-être (0)**\n` +
                    `Aucun joueur indécis pour le moment.`
                )
                .setColor(0x3498DB);

            // Publier le nouveau message
            const registrationMessage = await channel.send({
                embeds: [registrationEmbed],
                components: [registrationButtons]
            });

            // Enregistrer l'identifiant du message d'inscription dans la BDD
            db.prepare(`
                UPDATE polls
                SET registration_message_id = ?
                WHERE id = ?
            `).run(registrationMessage.id, poll.id);

            // Confirmer le choix et fermer le menu
            await interaction.update({
                content: `La date **${selectedOption.label}** a été retenue pour la soirée !`,
                components: []
            });
        }

        // Gestion des boutons d'inscription
        if (interaction.isButton()) {
            const [action, pollId] = interaction.customId.split(":");

            // Vérifier qu'il s'agit d'un bouton d'inscription
            if (!["join", "maybe", "leave"].includes(action)) return;

            // Vérifier que le sondage existe
            const poll = db.prepare(`
                SELECT id, title, registration_message_id
                FROM polls
                WHERE id = ?
                AND status = 'closed'
            `).get(pollId) as {
                id: string;
                title: string;
                registration_message_id: string | null;
            } | undefined;

            if (!poll || !poll.registration_message_id) {
                await interaction.reply({
                    content: "Ce sondage n'existe plus ou ses inscriptions ne sont pas disponibles.",
                    ephemeral: true
                });
                return;
            }

            // La suite de la gestion des inscriptions sera ajoutée ici
            // Récupérer le statut actuel du joueur
            const participant = db.prepare(`
                SELECT status
                FROM participants
                WHERE poll_id = ?
                AND user_id = ?
            `).get(poll.id, interaction.user.id) as {
                status: "confirmed" | "maybe";
            } | undefined;

            // Action : Je participe
            if (action === "join") {

                // Compter les participants confirmés
                const result = db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM participants
                    WHERE poll_id = ?
                    AND status = 'confirmed'
                `).get(poll.id) as { count: number };

                // Vérifier si le joueur est déjà confirmé
                if (participant?.status === "confirmed") {
                    await interaction.reply({
                        content: "Tu es déjà inscrit comme participant confirmé !",
                        ephemeral: true
                    });
                    return;
                }

                // Sécuriser l'inscription avec une transaction SQLite
                db.exec("BEGIN IMMEDIATE");

                try {
                    // Compter les participants confirmés
                    const result = db.prepare(`
                        SELECT COUNT(*) AS count
                        FROM participants
                        WHERE poll_id = ?
                        AND status = 'confirmed'
                    `).get(poll.id) as { count: number };

                    // Vérifier la limite de 16 joueurs
                    if (result.count >= 16) {
                        db.exec("ROLLBACK");

                        await interaction.reply({
                            content: "Désolé, les 16 places sont déjà prises ! Tu peux toujours choisir « Peut-être ».",
                            ephemeral: true
                        });
                        return;
                    }

                    // Ajouter ou mettre à jour le participant
                    db.prepare(`
                        INSERT INTO participants (poll_id, user_id, status)
                        VALUES (?, ?, 'confirmed')
                        ON CONFLICT (poll_id, user_id)
                        DO UPDATE SET status = 'confirmed'
                    `).run(poll.id, interaction.user.id);

                    // Valider la transaction
                    db.exec("COMMIT");

                } catch (error) {
                    db.exec("ROLLBACK");
                    throw error;
                }

                // Actualiser le message d'inscription
                await updateRegistrationMessage(interaction, poll.id);

                await interaction.reply({
                    content: "Tu es maintenant inscrit comme participant confirmé !",
                    ephemeral: true
                });
                return;
            }

            // Action : Peut-être
            if (action === "maybe") {

                if (participant?.status === "maybe") {
                    await interaction.reply({
                        content: "Tu es déjà dans la liste des joueurs indécis !",
                        ephemeral: true
                    });
                    return;
                }

                db.prepare(`
                    INSERT INTO participants (poll_id, user_id, status)
                    VALUES (?, ?, 'maybe')
                    ON CONFLICT (poll_id, user_id)
                    DO UPDATE SET status = 'maybe'
                `).run(poll.id, interaction.user.id);

                // Actualiser le message d'inscription
                await updateRegistrationMessage(interaction, poll.id);

                await interaction.reply({
                    content: "Tu as été ajouté à la liste des joueurs indécis !",
                    ephemeral: true
                });
                return;
            }

            // Action : Me désinscrire
            if (action === "leave") {

                if (!participant) {
                    await interaction.reply({
                        content: "Tu n'es inscrit dans aucune des deux listes.",
                        ephemeral: true
                    });
                    return;
                }

                db.prepare(`
                    DELETE FROM participants
                    WHERE poll_id = ?
                    AND user_id = ?
                `).run(poll.id, interaction.user.id);

                // Actualiser le message d'inscription
                await updateRegistrationMessage(interaction, poll.id);

                await interaction.reply({
                    content: "Tu as bien été désinscrit de la soirée.",
                    ephemeral: true
                });
                return;
            }
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

            const parsedDates = dates.map(date => ({
                original: date,
                parsed: parseEventDate(date)
            }));

            const invalidDate = parsedDates.find(item => !item.parsed);

            if (invalidDate) {
                await interaction.editReply(
                    `La date **${invalidDate.original}** est invalide.\n` +
                    `Format attendu : JJ/MM/AAAA HH:mm (exemple : 14/11/2026 20:30).`
                );
                return;
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

                    const parsed = parseEventDate(date)!;

                    const scheduledAt = [
                        parsed.date.getFullYear(),
                        String(parsed.date.getMonth() + 1).padStart(2, "0"),
                        String(parsed.date.getDate()).padStart(2, "0")
                    ].join("-") + "T" + [
                        String(parsed.date.getHours()).padStart(2, "0"),
                        String(parsed.date.getMinutes()).padStart(2, "0")
                    ].join(":");

                    insertOption.run(
                        optionId,
                        pollId,
                        parsed.label,
                        index + 1
                    );

                    db.prepare(`
                        UPDATE poll_options
                        SET scheduled_at = ?
                        WHERE id = ?
                    `).run(scheduledAt, optionId);

                    pollOptions.push({
                        id: optionId,
                        label: parsed.label
                    });
                });

                db.exec("COMMIT");

            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }

            // Création du message public du sondage
            const description = parsedDates
                .map((item, index) =>
                    `**${index + 1}.** ${item.parsed?.label ?? item.original} — 0 vote`
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
                AND status = 'open'
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

        if (interaction.commandName === "annuler") {

            // Accuser réception immédiatement pour respecter le délai Discord
            await interaction.deferReply({ ephemeral: true });

            // Vérifier que la commande est utilisée sur un serveur
            if (!interaction.guild) {
                await interaction.editReply(
                    "Cette commande doit être utilisée sur un serveur."
                );
                return;
            }

            // Vérifier le rôle MJ
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!member.roles.cache.some(role => role.name === "MJ")) {
                await interaction.editReply(
                    "Seuls les MJ peuvent annuler une soirée."
                );
                return;
            }

            // Récupérer la raison facultative
            const reason = interaction.options.getString("raison")
                ?? "Aucune raison précisée.";

            // Rechercher la dernière soirée dont la date a été choisie
            const poll = db.prepare(`
                SELECT id, title
                FROM polls
                WHERE channel_id = ?
                AND status = 'closed'
                AND selected_option_id IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
            `).get(interaction.channelId) as {
                id: string;
                title: string;
            } | undefined;

            // Vérifier qu'une soirée existe
            if (!poll) {
                await interaction.editReply(
                    "Aucune soirée programmée à annuler dans ce salon."
                );
                return;
            }

            // Annuler la soirée dans la base de données
            db.prepare(`
                UPDATE polls
                SET status = 'cancelled',
                    cancel_reason = ?
                WHERE id = ?
            `).run(reason, poll.id);

            await interaction.editReply(
                `La soirée **${poll.title}** a été annulée.\n` +
                `Raison : ${reason}`
            );

            await updateRegistrationMessage(
                interaction,
                poll.id
            );
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
