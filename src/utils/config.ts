import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { z } from 'zod';
import { config } from 'dotenv';
import discord from 'discord.js';

/**
 * Schema for validating environment variables
 * Defines the required structure and types for the bot's configuration
 */
const EnvSchema = z.object({
	TOKEN: z.string(),
	POSTGRES_URI: z.string(),
	DEBUG_MODE: z.union([z.boolean(), z.string()]).transform((val) => {
		if (typeof val === 'string') {
			return val.toLowerCase() === 'true';
		}
		return val;
	}),
	FEEDBACK_WEBHOOK: z.string(),
	MASTER_ENCRYPTION_KEY: z.string().min(32, 'Master encryption key must be at least 32 characters long'),
	DEFAULT_CHATBOT_API_KEY: z.string(),
	DEFAULT_CHATBOT_MODEL: z.string().default('gpt-4o-mini'),
	DEFAULT_CHATBOT_BASE_URL: z.string().default('https://api.openai.com/v1'),
});

/**
 * Manages application configuration using environment variables
 * Implements the Singleton pattern to ensure only one configuration instance exists
 * @class ConfigManager
 */
export class ConfigManager {
	private static instance: ConfigManager;
	private config: z.infer<typeof EnvSchema>;

	/**
	 * Private constructor to prevent direct instantiation
	 * Loads and validates environment variables from the appropriate .env file
	 * @private
	 * @throws {Error} If environment variables cannot be loaded or validated
	 */
	private constructor() {
		const environment = process.env.NODE_ENV || 'prod';
		const envPath = path.resolve(process.cwd(), `.env.${environment}`);
		let dotenvConfig: { debug: boolean; quiet: boolean; path?: string } = { debug: typeof process.env.DEBUG_MODE === 'string' && process.env.DEBUG_MODE.toLowerCase() === 'true', quiet: true };
		if (require('fs').existsSync(envPath)) dotenvConfig = { ...dotenvConfig, path: envPath };

		const result = config(dotenvConfig)
		if (result.error) throw new Error(`Failed to load environment variables: ${result.error.message}`);

		try {
			this.config = EnvSchema.parse({
				TOKEN: process.env.TOKEN,
				POSTGRES_URI: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`,
				DEBUG_MODE: process.env.DEBUG_MODE || false,
				FEEDBACK_WEBHOOK: process.env.FEEDBACK_WEBHOOK,
				MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY,
				DEFAULT_CHATBOT_API_KEY: process.env.DEFAULT_CHATBOT_API_KEY,
				DEFAULT_CHATBOT_MODEL: process.env.DEFAULT_CHATBOT_MODEL || 'gpt-4o-mini',
				DEFAULT_CHATBOT_BASE_URL: process.env.DEFAULT_CHATBOT_BASE_URL || 'https://api.openai.com/v1',
			});
		} catch (error) {
			if (error instanceof z.ZodError) {
				const missingVars = error.issues.map((issue) => issue.path.join('.'));
				throw new Error(`Missing or invalid environment variables: ${missingVars.join(', ')}`);
			}
			throw error;
		}
	}

	/**
	 * Gets the singleton instance of ConfigManager
	 * Creates a new instance if one doesn't exist
	 * @static
	 * @returns {ConfigManager} The singleton ConfigManager instance
	 */
	public static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	/**
	 * Retrieves the complete configuration object
	 * @returns {z.infer<typeof EnvSchema>} The complete configuration object
	 */
	public getConfig(): z.infer<typeof EnvSchema> {
		return this.config;
	}

	/**
	 * Gets the Discord bot token
	 * @returns {string} The Discord bot token from environment variables
	 */
	public getToken(): string {
		return this.config.TOKEN;
	}

	/**
	 * Gets the PostgreSQL connection URI
	 * @returns {string} The PostgreSQL connection URI from environment variables
	 */
	public getPostgresUri(): string {
		return this.config.POSTGRES_URI;
	}

	/**
	 * Gets the debug mode status
	 * @returns {boolean} The current debug mode status
	 */
	public isDebugMode(): boolean {
		return this.config.DEBUG_MODE;
	}

	/**
	 * Gets the feedback webhook URL
	 * @returns {string} The feedback webhook URL from environment variables
	 */
	public getFeedbackWebhook(): string {
		return this.config.FEEDBACK_WEBHOOK;
	}

	/**
	 * Gets the master encryption key
	 * @returns {string} The master encryption key from environment variables
	 */
	public getMasterEncryptionKey(): string {
		return this.config.MASTER_ENCRYPTION_KEY;
	}

	/**
	 * Gets the default chatbot API key
	 * @returns {string} The default chatbot API key from environment variables
	 */
	public getDefaultChatbotApiKey(): string {
		return this.config.DEFAULT_CHATBOT_API_KEY;
	}

	/**
	 * Gets the default chatbot model
	 * @returns {string} The default chatbot model from environment variables
	 */
	public getDefaultChatbotModel(): string {
		return this.config.DEFAULT_CHATBOT_MODEL;
	}

	/**
	 * Gets the default chatbot base URL
	 * @returns {string} The default chatbot base URL from environment variables
	 */
	public getDefaultChatbotBaseUrl(): string {
		return this.config.DEFAULT_CHATBOT_BASE_URL;
	}
}

/**
 * Loads configuration from YAML file
 * @returns Configuration object
 */
export const loadConfig = (client: discord.Client) => {
	try {
		const configPath = path.join(__dirname, '../../config/config.yml');
		const file = fs.readFileSync(configPath, 'utf8');
		return yaml.parse(file);
	} catch (error) {
		client.logger.error(`[SALT] Failed to load configuration: ${error}`);
		process.exit(1);
	}
};
