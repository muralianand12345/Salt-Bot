import fs from "fs";
import path from "path";
import yaml from "yaml";
import discord from "discord.js";
import Logger from "./utils/logger";
import { ConfigManager } from "./utils/config";
import CommandLogger from "./utils/command_logger";
import { Command, SlashCommand } from "./types";

// Load environment variables
const configManager = ConfigManager.getInstance();

/**
 * Loads configuration from YAML file
 * @returns Configuration object
 */
const loadConfig = (client: discord.Client) => {
    try {
        const configPath = path.join(__dirname, "../config/config.yml");
        const file = fs.readFileSync(configPath, "utf8");
        return yaml.parse(file);
    } catch (error) {
        client.logger.error(`[SALT] Failed to load configuration: ${error}`);
        process.exit(1);
    }
};

/**
 * Creates and configures the Discord client with all necessary properties
 * @returns Configured Discord client
 */
const createClient = (): discord.Client => {
    const client = new discord.Client({
        intents: [
            discord.GatewayIntentBits.Guilds,
            discord.GatewayIntentBits.GuildWebhooks,
            discord.GatewayIntentBits.GuildMessages,
            discord.GatewayIntentBits.MessageContent,
        ],
        shards: "auto",
    });

    // Initialize client properties
    client.logger = new Logger();
    client.cmdLogger = new CommandLogger();

    // Initialize collections
    client.slashCommands = new discord.Collection<string, SlashCommand>();
    client.commands = new discord.Collection<string, Command>();
    client.cooldowns = new discord.Collection<string, number>();

    // Load configuration
    client.config = loadConfig(client);

    return client;
};

// Create the client instance
const client = createClient();

export default client;