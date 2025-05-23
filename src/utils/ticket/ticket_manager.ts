import discord from "discord.js";
import client from "../../salt";
import { TicketRepository } from "../../events/database/repo/ticket_system";
import { ITicketStatus } from "../../events/database/entities/ticket_system";
import { ITicketCreationOptions, ITicketCreationResult } from "../../types"


/**
 * Centralized ticket management class that handles all ticket creation logic
 * This eliminates code duplication across button handlers and chatbot service
 */
export class TicketManager {
    private ticketRepo: TicketRepository;

    constructor(dataSource: any) {
        this.ticketRepo = new TicketRepository(dataSource);
    }

    /**
     * Check if user already has an open ticket in the guild
     * @param userId - Discord user ID
     * @param guildId - Discord guild ID
     * @returns Existing open ticket or null
     */
    public checkExistingTicket = async (userId: string, guildId: string): Promise<{ ticket: any; channel?: discord.TextChannel } | null> => {
        try {
            const guildTickets = await this.ticketRepo.getGuildTickets(guildId);
            const userOpenTickets = guildTickets.filter(ticket =>
                ticket.creatorId === userId &&
                ticket.status === ITicketStatus.OPEN
            );

            if (userOpenTickets.length > 0) {
                const existingTicket = userOpenTickets[0];
                const ticketChannel = client.channels.cache.get(existingTicket.channelId) as discord.TextChannel;

                if (ticketChannel) {
                    return { ticket: existingTicket, channel: ticketChannel };
                } else {
                    await this.ticketRepo.updateTicketStatus(
                        existingTicket.id,
                        ITicketStatus.CLOSED,
                        "system",
                        "Ticket channel was deleted"
                    );
                }
            }

            return null;
        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error checking existing ticket: ${error}`);
            return null;
        }
    };

    /**
     * Validate ticket creation prerequisites
     * @param guildId - Discord guild ID
     * @param categoryId - Category ID for the ticket
     * @returns Validation result with guild config and category
     */
    public validateCreationPrerequisites = async (guildId: string, categoryId: string): Promise<{
        valid: boolean;
        error?: string;
        guildConfig?: any;
        category?: any;
    }> => {
        try {
            const guildConfig = await this.ticketRepo.getGuildConfig(guildId);
            if (!guildConfig || !guildConfig.isEnabled) {
                return {
                    valid: false,
                    error: "The ticket system is currently disabled for this server."
                };
            }

            const category = await this.ticketRepo.getTicketCategory(categoryId);
            if (!category) {
                return {
                    valid: false,
                    error: "The selected ticket category no longer exists."
                };
            }

            if (!category.isEnabled) {
                return {
                    valid: false,
                    error: "The selected ticket category is currently disabled."
                };
            }

            return {
                valid: true,
                guildConfig,
                category
            };
        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error validating prerequisites: ${error}`);
            return {
                valid: false,
                error: "An error occurred while validating ticket creation requirements."
            };
        }
    };

    /**
     * Create Discord channel with proper permissions
     * @param guild - Discord guild
     * @param category - Ticket category
     * @param userId - User ID creating the ticket
     * @returns Created channel or null if failed
     */
    private createDiscordChannel = async (
        guild: discord.Guild,
        category: any,
        userId: string
    ): Promise<discord.TextChannel | null> => {
        try {
            const tempChannelName = `ticket-new`;

            const channel = await guild.channels.create({
                name: tempChannelName,
                type: discord.ChannelType.GuildText,
                parent: category.categoryId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        deny: [discord.PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: client.user!.id,
                        allow: [
                            discord.PermissionFlagsBits.ViewChannel,
                            discord.PermissionFlagsBits.SendMessages,
                            discord.PermissionFlagsBits.ManageChannels,
                            discord.PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: userId,
                        allow: [
                            discord.PermissionFlagsBits.ViewChannel,
                            discord.PermissionFlagsBits.SendMessages,
                            discord.PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });

            if (category.supportRoleId) {
                try {
                    await channel.permissionOverwrites.create(
                        category.supportRoleId,
                        {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        }
                    );
                } catch (permissionError) {
                    client.logger.warn(`[TICKET_MANAGER] Could not set permissions for support role ${category.supportRoleId}: ${permissionError}`);
                }
            }

            return channel;
        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error creating Discord channel: ${error}`);
            return null;
        }
    };

    /**
     * Generate welcome message content
     * @param category - Ticket category
     * @param options - Ticket creation options
     * @returns Welcome message string
     */
    private generateWelcomeMessage = (category: any, options: ITicketCreationOptions): string => {
        const ticketMessage = category.ticketMessage;
        let welcomeMessage = ticketMessage?.welcomeMessage ||
            `Welcome to your ticket in the **${category.name}** category!\n\nPlease describe your issue and wait for a staff member to assist you.`;

        if (options.fromChatbot && options.originalMessage) {
            welcomeMessage += `\n\n**Original question:** *${options.originalMessage}*`;
        }

        if (options.additionalContext) {
            welcomeMessage += `\n\n${options.additionalContext}`;
        }

        return welcomeMessage;
    };

    /**
     * Create and send welcome embed with ticket information
     * @param channel - Discord channel
     * @param ticket - Created ticket
     * @param category - Ticket category
     * @param options - Creation options
     * @returns Success boolean
     */
    private sendWelcomeMessage = async (
        channel: discord.TextChannel,
        ticket: any,
        category: any,
        options: ITicketCreationOptions
    ): Promise<boolean> => {
        try {
            const welcomeMessage = this.generateWelcomeMessage(category, options);
            const creationTimestamp = Math.floor(Date.now() / 1000);

            const welcomeEmbed = new discord.EmbedBuilder()
                .setTitle(`Ticket #${ticket.ticketNumber}`)
                .setDescription(welcomeMessage)
                .addFields(
                    { name: "Ticket ID", value: `#${ticket.ticketNumber}`, inline: true },
                    { name: "Category", value: `${category.emoji || "🎫"} ${category.name}`, inline: true },
                    { name: "Status", value: `🟢 Open`, inline: true },
                    { name: "Created By", value: `<@${options.userId}>`, inline: true },
                    { name: "Created At", value: `<t:${creationTimestamp}:F>`, inline: true }
                )
                .setColor("Green")
                .setFooter({ text: `Use /ticket close to close this ticket | ID: ${ticket.id}` })
                .setTimestamp();

            const actionRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
                .addComponents(
                    new discord.ButtonBuilder()
                        .setCustomId("ticket_claim")
                        .setLabel("Claim Ticket")
                        .setStyle(discord.ButtonStyle.Primary)
                        .setEmoji("👋"),
                    new discord.ButtonBuilder()
                        .setCustomId("ticket_close")
                        .setLabel("Close Ticket")
                        .setStyle(discord.ButtonStyle.Danger)
                        .setEmoji("🔒")
                );

            const ticketMessage = category.ticketMessage;
            const shouldPingSupport = ticketMessage?.includeSupportTeam && category.supportRoleId;

            await channel.send({
                content: shouldPingSupport
                    ? `<@${options.userId}> | <@&${category.supportRoleId}>`
                    : `<@${options.userId}>`,
                embeds: [welcomeEmbed],
                components: [actionRow]
            });

            return true;
        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error sending welcome message: ${error}`);
            return false;
        }
    };

    /**
     * Main ticket creation method that orchestrates the entire process
     * @param options - Ticket creation options
     * @returns Creation result
     */
    public createTicket = async (options: ITicketCreationOptions): Promise<ITicketCreationResult> => {
        let createdChannel: discord.TextChannel | null = null;

        try {
            // Step 1: Check for existing tickets
            const existingTicket = await this.checkExistingTicket(options.userId, options.guildId);
            if (existingTicket) {
                return {
                    success: false,
                    error: `You already have an open ticket: ${existingTicket.channel || '#ticket-channel'}`
                };
            }

            // Step 2: Validate prerequisites
            const validation = await this.validateCreationPrerequisites(options.guildId, options.categoryId);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error || "Validation failed"
                };
            }

            const { guildConfig, category } = validation;

            // Step 3: Get Discord guild
            const guild = client.guilds.cache.get(options.guildId);
            if (!guild) {
                return {
                    success: false,
                    error: "Server not found"
                };
            }

            // Step 4: Create Discord channel
            createdChannel = await this.createDiscordChannel(guild, category, options.userId);
            if (!createdChannel) {
                return {
                    success: false,
                    error: "Failed to create ticket channel"
                };
            }

            // Step 5: Create ticket in database
            const ticket = await this.ticketRepo.createTicket(
                options.guildId,
                options.userId,
                createdChannel.id,
                options.categoryId
            );

            // Step 6: Rename channel with ticket number
            const channelName = `ticket-${ticket.ticketNumber.toString().padStart(4, '0')}`;
            await createdChannel.setName(channelName);

            // Step 7: Send welcome message
            const welcomeSuccess = await this.sendWelcomeMessage(
                createdChannel,
                ticket,
                category,
                options
            );

            if (!welcomeSuccess) {
                client.logger.warn(`[TICKET_MANAGER] Welcome message failed for ticket #${ticket.ticketNumber}`);
            }

            const contextInfo = options.fromChatbot ? "(via AI assistant)" : "(via button)";
            client.logger.info(`[TICKET_MANAGER] User ${options.userId} created ticket #${ticket.ticketNumber} in category ${category.name} ${contextInfo}`);

            return {
                success: true,
                ticket,
                channel: createdChannel,
                ticketNumber: ticket.ticketNumber
            };

        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error creating ticket: ${error}`);

            if (createdChannel) {
                try {
                    await createdChannel.delete();
                    client.logger.info(`[TICKET_MANAGER] Cleaned up failed ticket channel`);
                } catch (deleteError) {
                    client.logger.error(`[TICKET_MANAGER] Failed to cleanup channel: ${deleteError}`);
                }
            }

            return {
                success: false,
                error: "An unexpected error occurred while creating the ticket"
            };
        }
    };

    /**
     * Get available ticket categories for a guild
     * @param guildId - Discord guild ID
     * @returns Array of enabled categories
     */
    public getAvailableCategories = async (guildId: string): Promise<Array<{ id: string; name: string; description?: string; emoji?: string }>> => {
        try {
            const categories = await this.ticketRepo.getTicketCategories(guildId);
            return categories
                .filter(category => category.isEnabled)
                .map(category => ({
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    emoji: category.emoji
                }));
        } catch (error) {
            client.logger.error(`[TICKET_MANAGER] Error getting available categories: ${error}`);
            return [];
        }
    };

    /**
     * Create a user-friendly error embed
     * @param message - Error message
     * @returns Discord embed
     */
    public createErrorEmbed = (message: string): discord.EmbedBuilder => {
        return new discord.EmbedBuilder()
            .setTitle("❌ Ticket Creation Failed")
            .setDescription(message)
            .setColor("Red")
            .setTimestamp();
    };

    /**
     * Create a success embed for ticket creation
     * @param ticket - Created ticket
     * @param channel - Created channel
     * @param fromChatbot - Whether created from chatbot
     * @returns Discord embed
     */
    public createSuccessEmbed = (ticket: any, channel: discord.TextChannel, fromChatbot: boolean = false): discord.EmbedBuilder => {
        const title = fromChatbot ? "🎫 Ticket Created Successfully" : "✅ Ticket Created";
        const description = `Your ticket has been created: ${channel}\nTicket Number: #${ticket.ticketNumber}`;

        return new discord.EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor("Green")
            .setTimestamp();
    };
}