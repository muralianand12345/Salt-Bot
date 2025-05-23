import discord from "discord.js";
import { CommandLogger } from "./utils/command_logger";

//-----------COMMANDS-----------//

export interface SlashCommand {
    data: typeof data;
    modal?: (
        interaction: discord.ModalSubmitInteraction<discord.CacheType>
    ) => void;
    userPerms?: Array<discord.PermissionResolvable>;
    botPerms?: Array<discord.PermissionResolvable>;
    cooldown?: number;
    owner?: boolean;
    premium?: boolean;
    execute: (
        interaction: discord.ChatInputCommandInteraction,
        client: discord.Client
    ) => void;
    autocomplete?: (
        interaction: discord.AutocompleteInteraction,
        client: discord.Client
    ) => void;
}

export interface Command {
    name: string;
    description: string;
    userPerms?: Array<discord.PermissionResolvable>;
    botPerms?: Array<discord.PermissionResolvable>;
    cooldown?: number;
    owner?: boolean;
    premium?: boolean;
    execute: (
        client: discord.Client,
        message: discord.Message,
        args: Array<string>
    ) => void;
}

//-----------CONFIG-----------//

export interface IConfig {
    bot: {
        owners: Array<string>;
        support: {
            link: string;
        }
        presence: {
            enabled: boolean;
            status: string;
            interval: number;
            activity: Array<BotPresence>;
        };
        command: {
            prefix: string;
            disable_message: boolean;
            cooldown_message: string;
            register_specific_commands: {
                enabled: boolean;
                commands: Array<string>;
            };
        };
        log: {
            command: string;
            server: string;
        };
    }
    embed: {
        color: {
            default: discord.ColorResolvable | null;
            error: discord.ColorResolvable | null;
            success: discord.ColorResolvable | null;
            warning: discord.ColorResolvable | null;
        }
    }
    ticket: {
        default: {
            button: {
                label: string;
                emoji: string;
                style: string;
                embed_title: string;
                embed_description: string;
            };
            category: {
                name: string;
                description: string;
                emoji: string;
            };
            message: {
                welcome_message: string;
                close_message: string;
            };
            select_menu: {
                placeholder: string;
                embed_title: string;
                embed_description: string;
            };
        }
    }
}

//-----------GLOBAL-----------//

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            DEBUG_MODE: boolean | string;
            TOKEN: string;
            POSTGRES_URI: string;
            FEEDBACK_WEBHOOK: string;
        }
    }
}

declare module "discord.js" {
    export interface Client {
        slashCommands: discord.Collection<string, SlashCommand>;
        commands: discord.Collection<string, Command>;
        cooldowns: discord.Collection<string, number>;
        logger: ILogger;
        cmdLogger: typeof CommandLogger;
        config: IConfig;
    }
}

//-----------LOGGER-----------//

export interface ILogger {
    success(message: string | Error): void;
    log(message: string | Error): void;
    error(message: string | Error): void;
    warn(message: string | Error): void;
    info(message: string | Error): void;
    debug(message: string | Error): void;
}

export interface ICommandLogger {
    client: discord.Client;
    commandName: string;
    guild: discord.Guild | null;
    user: discord.User | null;
    channel: discord.TextChannel | null;
}

//-----------EVENTS-----------//

export interface BotEvent {
    name: string;
    once?: boolean | false;
    execute: (...args) => void;
}

//-----------DATABASE/OTHERS-----------//

export interface IBlockUser {
    id?: string;
    userId: string;
    status: boolean;
    data: IBlockReason[];
}

export interface IBlockReason {
    id?: string;
    reason: string;
    timestamp: Date;
}

export interface IPremiumCoupon {
    id?: string;
    code: string;
    userId: string;
    status: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUserData {
    id?: string;
    userId: string;
    premiumStatus: boolean;
    premiumExpiresAt: Date | null;
}

export interface IGuildConfig {
    id: string;
    guildId: string;
    defaultCategoryName: string;
    globalTicketCount: number;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    ticketCategories: ITicketCategory[];
    ticketButton: ITicketButton;
    selectMenu: ISelectMenuConfig;
}

export interface ITicketCategory {
    id: string;
    name: string;
    categoryId: string;
    description?: string;
    emoji?: string;
    supportRoleId?: string;
    ticketCount: number;
    isEnabled: boolean;
    position: number;
    createdAt: Date;
    updatedAt: Date;
    guildConfig: IGuildConfig;
    tickets: ITicket[];
    ticketMessage: ITicketMessage;
}

export interface ITicket {
    id: string;
    ticketNumber: number;
    channelId: string;
    creatorId: string;
    closedById?: string;
    closedAt?: Date;
    claimedById?: string | null;
    claimedAt?: Date | null;
    status: ITicketStatus;
    closeReason?: string;
    createdAt: Date;
    updatedAt: Date;
    category: ITicketCategory;
}

export interface ITicketMessage {
    id: string;
    welcomeMessage?: string;
    closeMessage?: string;
    includeSupportTeam: boolean;
    createdAt: Date;
    updatedAt: Date;
    category: ITicketCategory;
}

export interface ITicketButton {
    id: string;
    label: string;
    emoji: string;
    style: string;
    messageId?: string;
    embedTitle?: string;
    embedDescription?: string;
    embedColor?: string;
    channelId?: string;
    logChannelId?: string;
    createdAt: Date;
    updatedAt: Date;
    guildConfig: IGuildConfig;
}

export interface ISelectMenuConfig {
    id: string;
    placeholder: string;
    messageId?: string;
    minValues: number;
    maxValues: number;
    embedTitle?: string;
    embedDescription?: string;
    embedColor?: string;
    createdAt: Date;
    updatedAt: Date;
    guildConfig: IGuildConfig;
}

export interface IChatbotConfig {
    id: string;
    guildId: string;
    channelId: string;
    apiKey: string;
    baseUrl: string;
    chatbotName: string;
    responseType: string;
    cooldown: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface IMetadata {
    source: {
        name: string;
        path: string;
        type: 'txt' | 'md';
    };
    createdAt: Date;
    updatedAt: Date;
    tags: string[];
    chunkIndex: number;
    totalChunks: number;
    wordCount: number;
    charCount: number;
    hash?: string;
}

interface IDocument {
    content: string;
    metadata: IMetadata;
    embedding?: number[];
}

interface IProcessingOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    tags?: string[];
    skipEmbedding?: boolean;
    deduplicate?: boolean;
    customSeparators?: string[];
    maxConcurrentEmbeddings?: number;
}

//-----------INTERFACE-----------//

export interface BotPresence {
    name: string;
    type: discord.ActivityType;
}

interface OpenAIFunction {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, {
                type: string;
                description: string;
                enum?: string[];
            }>;
            required: string[];
            additionalProperties: boolean;
        };
    };
}

export interface ITicketCreationOptions {
    userId: string;
    guildId: string;
    categoryId: string;
    originalMessage?: string;
    fromChatbot?: boolean;
    additionalContext?: string;
}

export interface ITicketCreationResult {
    success: boolean;
    ticket?: any;
    channel?: discord.TextChannel;
    error?: string;
    ticketNumber?: number;
}