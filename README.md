# 🎲 Bot BOTC — Blood on the Clocktower

Bot Discord permettant de faciliter l'organisation de parties de **Blood on the Clocktower**. Il permet notamment de proposer plusieurs dates, de recueillir les disponibilités des joueurs et de sélectionner la date définitive d'une soirée.

## ✨ Fonctionnalités

### 📅 Gestion des sondages

- `/proposer` : créer un sondage avec un titre et jusqu'à 5 dates possibles.
- Les joueurs votent directement avec des réactions Discord.
- Les résultats sont actualisés automatiquement à chaque vote.
- `/cloturer` : fermer un sondage et afficher les résultats définitifs.

### 🏆 Sélection de la date

- `/choisirdate` : permettre au Maître du Jeu (MJ) de sélectionner la date définitive parmi les propositions.
- Mise à jour automatique du message du sondage pour mettre en évidence la date retenue.
- Enregistrement du choix dans la base de données.

### 💾 Persistance des données

- Stockage des sondages, des propositions et des votes dans une base de données SQLite.
- Conservation des données après redémarrage du bot.
- Création automatique des tables nécessaires au démarrage.

## 🛠️ Technologies utilisées

- **Node.js** — environnement d'exécution JavaScript.
- **TypeScript** — typage statique.
- **discord.js** — interaction avec l'API Discord.
- **SQLite** — stockage des données.
- **dotenv** — gestion des variables d'environnement.

## 📋 Prérequis

Avant de commencer, assure-toi de disposer de :

- [Node.js](https://nodejs.org/) installé.
- [Git](https://git-scm.com/) installé.
- Un compte Discord.
- Une application et un bot créés sur le [Discord Developer Portal](https://discord.com/developers/applications).

## 🚀 Installation

### 1. Cloner le dépôt

```bash
git clone https://github.com/Sheykman/botDiscord_BOTC.git
cd bot-botc
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

Créer un fichier `.env` à la racine du projet en s'inspirant de `.env.example` :

```env
DISCORD_TOKEN=ton_token_discord
DISCORD_CLIENT_ID=ton_client_id
DISCORD_GUILD_ID=ton_guild_id
```

**Important :** ne partage jamais ton fichier `.env` et ne publie jamais ton token Discord.

### 4. Déployer les commandes Discord

```bash
npm run deploy
```

Cette commande enregistre les commandes slash sur le serveur Discord configuré.

### 5. Lancer le bot

En développement :

```bash
npm run dev
```

Compiler le projet :

```bash
npm run build
```

Lancer la version compilée :

```bash
npm start
```

## 🎮 Commandes Discord

| Commande | Description | Permission |
|---|---|---|
| `/ping` | Vérifier que le bot répond | Tous les membres |
| `/proposer` | Créer un sondage de dates | MJ |
| `/cloturer` | Clôturer le sondage en cours | MJ |
| `/choisirdate` | Choisir la date définitive | MJ |

Le rôle Discord `MJ` est nécessaire pour utiliser les commandes de gestion des soirées.

## 📁 Structure du projet

```text
bot-botc/
├── src/
│   ├── commands/       # Commandes Discord
│   ├── database/       # Initialisation de SQLite
│   ├── events/         # Événements Discord
│   ├── utils/          # Fonctions utilitaires
│   ├── deploy-commands.ts
│   └── index.ts        # Point d'entrée du bot
├── data/               # Base de données SQLite
├── .env.example        # Exemple de configuration
├── .gitignore
├── package.json
├── package-lock.json
└── tsconfig.json
```

## 🗺️ Évolutions envisagées

- [ ] Système d'inscription et de désinscription aux soirées.
- [ ] Affichage automatique de la liste des participants.
- [ ] Gestion du nombre maximal de joueurs.
- [ ] Notifications et rappels avant les parties.
- [ ] Amélioration de la gestion des soirées et des sondages.

## 📜 Licence

Projet personnel développé à des fins d'apprentissage et d'utilisation sur un serveur Discord privé.
