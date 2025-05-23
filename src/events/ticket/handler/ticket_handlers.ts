import discord from "discord.js";
import { BotEvent } from "../../../types";
import { ITicketStatus } from "../../database/entities/ticket_system";
import { TicketRepository } from "../../database/repo/ticket_system";
import { EmbedTemplate } from "../../../utils/embed_template";
import { TicketManager } from "../../../utils/ticket";

const event: BotEvent = {
    name: discord.Events.InteractionCreate,
    execute: async (interaction: discord.Interaction, client: discord.Client): Promise<void> => {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        try {
            if (!(client as any).dataSource) {
                client.logger.error("[TICKET_BUTTON] Database connection is not available");
                return;
            }

            const ticketRepo = new TicketRepository((client as any).dataSource);
            const ticketManager = new TicketManager((client as any).dataSource);

            if (interaction.customId === "create_ticket") {
                if (!interaction.isButton()) return;
                await handleCreateTicketButton(interaction, client, ticketManager);
            } else if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category_select") {
                await handleCategorySelect(interaction, client, ticketManager);
            } else if (interaction.customId === "ticket_close") {
                if (!interaction.isButton()) return;
                await handleCloseButton(interaction, client, ticketRepo);
            } else if (interaction.customId === "ticket_reopen") {
                if (!interaction.isButton()) return;
                await handleReopenButton(interaction, client, ticketRepo);
            } else if (interaction.customId === "ticket_archive") {
                if (!interaction.isButton()) return;
                await handleArchiveButton(interaction, client, ticketRepo);
            } else if (interaction.customId === "ticket_delete") {
                if (!interaction.isButton()) return;
                await handleDeleteButton(interaction, client, ticketRepo);
            } else if (interaction.customId === "ticket_claim") {
                if (!interaction.isButton()) return;
                await handleClaimButton(interaction, client, ticketRepo);
            }
        } catch (error) {
            client.logger.error(`[TICKET_BUTTON] Error handling interaction: ${error}`);

            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({
                        embeds: [new EmbedTemplate(client).error("An error occurred while processing your request.")],
                        flags: discord.MessageFlags.Ephemeral,
                    });
                } catch (replyError) {
                    client.logger.error(`[TICKET_BUTTON] Error sending error response: ${replyError}`);
                }
            }
        }
    }
};

/**
 * Handle the create ticket button click using TicketManager
 */
const handleCreateTicketButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketManager: TicketManager
) => {
    try {
        await interaction.deferReply({ flags: discord.MessageFlags.Ephemeral });

        const ticketRepo = new TicketRepository((client as any).dataSource);
        const guildConfig = await ticketRepo.getGuildConfig(interaction.guildId!);
        if (!guildConfig || !guildConfig.isEnabled) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("The ticket system is currently disabled.")]
            });
        }

        const existingTicket = await ticketManager.checkExistingTicket(interaction.user.id, interaction.guildId!);
        if (existingTicket) {
            return interaction.editReply({
                embeds: [
                    new EmbedTemplate(client).warning("You already have an open ticket!")
                        .setDescription(`Please use your existing ticket: ${existingTicket.channel}`)
                ]
            });
        }

        const categories = await ticketManager.getAvailableCategories(interaction.guildId!);
        if (categories.length === 0) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("No ticket categories are available.")]
            });
        }

        if (categories.length === 1) {
            await createTicketWithManager(interaction, client, ticketManager, categories[0].id);
            return;
        }

        const selectMenu = new discord.StringSelectMenuBuilder()
            .setCustomId("ticket_category_select")
            .setPlaceholder("Select a ticket category");

        categories.forEach(category => {
            selectMenu.addOptions({
                label: category.name,
                description: category.description?.substring(0, 100) || `Support for ${category.name}`,
                value: category.id,
                emoji: category.emoji || "🎫"
            });
        });

        const menuConfig = await ticketRepo.getSelectMenuConfig(interaction.guildId!);
        const selectEmbed = new discord.EmbedBuilder()
            .setTitle(menuConfig?.embedTitle || "Create a Ticket")
            .setDescription(menuConfig?.embedDescription || "Please select a category for your ticket")
            .setColor((menuConfig?.embedColor || "Blue") as discord.ColorResolvable)
            .setFooter({ text: "Powered by Salt Bot", iconURL: client.user?.displayAvatarURL() })
            .setTimestamp();

        const actionRow = new discord.ActionRowBuilder<discord.StringSelectMenuBuilder>()
            .addComponents(selectMenu);

        await interaction.editReply({
            embeds: [selectEmbed],
            components: [actionRow]
        });
    } catch (error) {
        client.logger.error(`[TICKET_BUTTON] Error handling create ticket button: ${error}`);

        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while processing your request.")]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while processing your request.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_BUTTON] Failed to send error response: ${responseError}`);
        }
    }
};

/**
 * Handle the category selection from the dropdown menu
 */
const handleCategorySelect = async (
    interaction: discord.StringSelectMenuInteraction,
    client: discord.Client,
    ticketManager: TicketManager
) => {
    try {
        await interaction.deferUpdate();
        const categoryId = interaction.values[0];
        await createTicketWithManager(interaction, client, ticketManager, categoryId);
    } catch (error) {
        client.logger.error(`[TICKET_BUTTON] Error handling category select: ${error}`);

        try {
            await interaction.followUp({
                embeds: [new EmbedTemplate(client).error("An error occurred while processing your selection.")],
                flags: discord.MessageFlags.Ephemeral
            });
        } catch (followUpError) {
            client.logger.error(`[TICKET_BUTTON] Failed to send followUp error: ${followUpError}`);
        }
    }
};

/**
 * Create a ticket using the TicketManager
 */
const createTicketWithManager = async (
    interaction: discord.ButtonInteraction | discord.StringSelectMenuInteraction,
    client: discord.Client,
    ticketManager: TicketManager,
    categoryId: string
) => {
    try {
        try {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Creating Ticket")
                        .setDescription("Please wait while we create your ticket...")
                        .setColor("Blue")
                ],
                components: []
            });
        } catch (editError) {
            client.logger.warn(`[TICKET_CREATE] Could not update loading message: ${editError}`);
        }

        const result = await ticketManager.createTicket({
            userId: interaction.user.id,
            guildId: interaction.guildId!,
            categoryId: categoryId,
            fromChatbot: false
        });

        if (result.success && result.ticket && result.channel) {
            let notificationSent = false;

            try {
                await interaction.editReply({
                    embeds: [ticketManager.createSuccessEmbed(result.ticket, result.channel)],
                    components: []
                });
                notificationSent = true;
            } catch (editError) {
                client.logger.warn(`[TICKET_CREATE] Could not edit reply: ${editError}`);
            }

            if (!notificationSent) {
                try {
                    await interaction.followUp({
                        embeds: [ticketManager.createSuccessEmbed(result.ticket, result.channel)],
                        flags: discord.MessageFlags.Ephemeral
                    });
                    notificationSent = true;
                } catch (followUpError) {
                    client.logger.warn(`[TICKET_CREATE] Could not send followUp: ${followUpError}`);
                }
            }

            if (!notificationSent) {
                client.logger.warn(`[TICKET_CREATE] Could not notify user about ticket #${result.ticketNumber}, but ticket was created successfully`);
            }
        } else {
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        embeds: [ticketManager.createErrorEmbed(result.error || "Unknown error")]
                    });
                } else if (!interaction.replied) {
                    await interaction.reply({
                        embeds: [ticketManager.createErrorEmbed(result.error || "Unknown error")],
                        flags: discord.MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.followUp({
                        embeds: [ticketManager.createErrorEmbed(result.error || "Unknown error")],
                        flags: discord.MessageFlags.Ephemeral
                    });
                }
            } catch (responseError) {
                client.logger.error(`[TICKET_CREATE] Failed to send error response: ${responseError}`);
            }
        }
    } catch (error) {
        client.logger.error(`[TICKET_CREATE] Error in createTicketWithManager: ${error}`);

        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [ticketManager.createErrorEmbed("An unexpected error occurred while creating your ticket.")]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [ticketManager.createErrorEmbed("An unexpected error occurred while creating your ticket.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            } else {
                await interaction.followUp({
                    embeds: [ticketManager.createErrorEmbed("An unexpected error occurred while creating your ticket.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_CREATE] Failed to send final error response: ${responseError}`);
        }
    }
};

/**
 * Handle the close button click
 */
const handleCloseButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
) => {
    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);
        if (!ticket) {
            return interaction.reply({
                embeds: [new EmbedTemplate(client).error("This is not a valid ticket channel.")],
                flags: discord.MessageFlags.Ephemeral,
            });
        }

        if (ticket.status !== "open") {
            return interaction.reply({
                embeds: [new EmbedTemplate(client).error("This ticket is already closed.")],
                flags: discord.MessageFlags.Ephemeral,
            });
        }

        const modal = new discord.ModalBuilder()
            .setCustomId("ticket_close_modal")
            .setTitle("Close Ticket");

        const reasonInput = new discord.TextInputBuilder()
            .setCustomId("ticket_close_reason")
            .setLabel("Reason for closing the ticket")
            .setPlaceholder("Enter the reason for closing this ticket...")
            .setRequired(false)
            .setStyle(discord.TextInputStyle.Paragraph);

        const actionRow = new discord.ActionRowBuilder<discord.TextInputBuilder>()
            .addComponents(reasonInput);

        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    } catch (error) {
        client.logger.error(`[TICKET_CLOSE] Error showing close modal: ${error}`);

        if (!interaction.replied) {
            try {
                await interaction.reply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while processing your request.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            } catch (replyError) {
                client.logger.error(`[TICKET_CLOSE] Failed to send error response: ${replyError}`);
            }
        }
    }
};

/**
 * Handle the reopen button click
 */
const handleReopenButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
) => {
    try {
        await interaction.deferReply();

        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);
        if (!ticket) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("This is not a valid ticket channel.")]
            });
        }

        if (ticket.status === "open") {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("This ticket is already open.")]
            });
        }

        await ticketRepo.updateTicketStatus(
            ticket.id,
            ITicketStatus.OPEN,
        );

        const channel = interaction.channel as discord.TextChannel;
        const reopenEmbed = new discord.EmbedBuilder()
            .setTitle("Ticket Reopened")
            .setDescription("This ticket has been reopened.")
            .addFields(
                { name: "Reopened By", value: `<@${interaction.user.id}>`, inline: true }
            )
            .setColor("Green")
            .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
            .setTimestamp();

        await channel.send({ embeds: [reopenEmbed] });

        try {
            await channel.permissionOverwrites.create(
                interaction.guild!.roles.everyone,
                { SendMessages: null }
            );
            await channel.permissionOverwrites.create(
                ticket.creatorId,
                {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                }
            );

            if (ticket.category.supportRoleId) {
                await channel.permissionOverwrites.create(
                    ticket.category.supportRoleId,
                    {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    }
                );
            }

            const actionRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
                .addComponents(
                    new discord.ButtonBuilder()
                        .setCustomId("ticket_close")
                        .setLabel("Close Ticket")
                        .setStyle(discord.ButtonStyle.Danger)
                        .setEmoji("🔒")
                );

            await interaction.editReply({
                embeds: [new EmbedTemplate(client).success("Ticket reopened successfully.")],
                components: [actionRow]
            });
        } catch (error) {
            client.logger.error(`[TICKET_REOPEN] Error updating permissions: ${error}`);
            await interaction.editReply({
                embeds: [
                    new EmbedTemplate(client).warning("Ticket marked as reopened, but could not update channel permissions.")
                        .setDescription("Make sure the bot has the necessary permissions to modify channel permissions.")
                ]
            });
        }
    } catch (error) {
        client.logger.error(`[TICKET_REOPEN] Error reopening ticket: ${error}`);

        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while reopening the ticket.")]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while reopening the ticket.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_REOPEN] Failed to send error response: ${responseError}`);
        }
    }
};

/**
 * Handle the archive button click
 */
const handleArchiveButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
) => {
    try {
        await interaction.deferReply();

        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);
        if (!ticket) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("This is not a valid ticket channel.")]
            });
        }

        if (ticket.status === "archived") {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("This ticket is already archived.")]
            });
        }

        await ticketRepo.updateTicketStatus(
            ticket.id,
            ITicketStatus.ARCHIVED,
            interaction.user.id,
            "Ticket archived"
        );

        const archiveEmbed = new discord.EmbedBuilder()
            .setTitle("Ticket Archived")
            .setDescription("This ticket has been archived and will be stored for reference.")
            .addFields(
                { name: "Archived By", value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
            .setTimestamp();

        const channel = interaction.channel as discord.TextChannel;
        await channel.send({ embeds: [archiveEmbed] });
        await interaction.editReply({
            embeds: [new EmbedTemplate(client).success("Ticket archived successfully.")]
        });
    } catch (error) {
        client.logger.error(`[TICKET_ARCHIVE] Error archiving ticket: ${error}`);

        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while archiving the ticket.")]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while archiving the ticket.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_ARCHIVE] Failed to send error response: ${responseError}`);
        }
    }
};

/**
 * Handle the delete button click
 */
const handleDeleteButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
) => {
    try {
        await interaction.deferReply();
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);
        if (!ticket) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("This is not a valid ticket channel.")]
            });
        }

        if (!interaction.memberPermissions?.has(discord.PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply({
                embeds: [new EmbedTemplate(client).error("You need Manage Channels permission to delete tickets.")]
            });
        }

        const confirmRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
            .addComponents(
                new discord.ButtonBuilder()
                    .setCustomId("confirm_delete")
                    .setLabel("Yes, Delete")
                    .setStyle(discord.ButtonStyle.Danger),
                new discord.ButtonBuilder()
                    .setCustomId("cancel_delete")
                    .setLabel("Cancel")
                    .setStyle(discord.ButtonStyle.Secondary)
            );
        const confirmMessage = await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Delete Ticket")
                    .setDescription("Are you sure you want to delete this ticket? This action cannot be undone.")
                    .setColor("Red")
            ],
            components: [confirmRow]
        });

        const collector = (confirmMessage as discord.Message).createMessageComponentCollector({
            filter: (i): i is discord.ButtonInteraction =>
                i.isButton() &&
                ['confirm_delete', 'cancel_delete'].includes(i.customId) &&
                i.user.id === interaction.user.id,
            time: 30000
        });

        collector.on("collect", async (i: discord.ButtonInteraction) => {
            try {
                await i.deferUpdate();

                if (i.customId === "cancel_delete") {
                    await i.editReply({
                        embeds: [new EmbedTemplate(client).info("Ticket deletion canceled.")],
                        components: []
                    });
                    collector.stop();
                    return;
                }

                if (i.customId === "confirm_delete") {
                    const channel = interaction.channel as discord.TextChannel;
                    const deleteEmbed = new discord.EmbedBuilder()
                        .setTitle("Ticket Deleted")
                        .setDescription(`Ticket #${ticket.ticketNumber} has been deleted by ${interaction.user.tag}.`)
                        .setColor("Red")
                        .setTimestamp();

                    await ticketRepo.updateTicketStatus(
                        ticket.id,
                        ITicketStatus.CLOSED,
                        interaction.user.id,
                        "Ticket deleted by staff"
                    );

                    client.logger.info(`[TICKET_DELETE] Ticket #${ticket.ticketNumber} marked as closed in database`);

                    try {
                        const creator = await client.users.fetch(ticket.creatorId);
                        await creator.send({ embeds: [deleteEmbed] }).catch((dmError) => {
                            client.logger.debug(`[TICKET_DELETE] Could not DM ticket creator: ${dmError}`);
                        });
                    } catch (userError) {
                        client.logger.warn(`[TICKET_DELETE] Could not fetch or message ticket creator: ${userError}`);
                    }

                    try {
                        await i.editReply({
                            embeds: [new EmbedTemplate(client).success("Deleting ticket...")],
                            components: []
                        });
                    } catch (editError) {
                        client.logger.warn(`[TICKET_DELETE] Could not update confirmation message: ${editError}`);
                    }

                    setTimeout(async () => {
                        try {
                            await channel.delete();
                            client.logger.info(`[TICKET_DELETE] Ticket #${ticket.ticketNumber} channel deleted by ${interaction.user.tag}`);
                        } catch (deleteError) {
                            client.logger.error(`[TICKET_DELETE] Error deleting channel: ${deleteError}`);
                            try {
                                await interaction.user.send({
                                    embeds: [
                                        new EmbedTemplate(client).error("Failed to delete the ticket channel.")
                                            .setDescription("The ticket was marked as closed in the database, but the channel could not be deleted. Manual cleanup may be required.")
                                    ]
                                });
                            } catch (dmError) {
                                client.logger.error(`[TICKET_DELETE] Failed to notify user about channel deletion failure: ${dmError}`);
                            }
                        }
                    }, 3000);

                    collector.stop();
                }
            } catch (buttonError) {
                client.logger.error(`[TICKET_DELETE] Error handling button interaction: ${buttonError}`);

                try {
                    await i.editReply({
                        embeds: [new EmbedTemplate(client).error("An error occurred while processing your request.")],
                        components: []
                    });
                } catch (editError) {
                    client.logger.error(`[TICKET_DELETE] Failed to edit reply with error: ${editError}`);
                }
            }
        });

        collector.on("end", async (collected, reason) => {
            if (reason === "time" && collected.size === 0) {
                try {
                    await interaction.editReply({
                        embeds: [new EmbedTemplate(client).info("Ticket deletion timed out.")],
                        components: []
                    });
                } catch (timeoutError) {
                    client.logger.warn(`[TICKET_DELETE] Failed to edit reply after timeout: ${timeoutError}`);
                }
            }
        });
    } catch (error) {
        client.logger.error(`[TICKET_DELETE] Error in delete ticket handler: ${error}`);

        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while processing your delete request.")]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [new EmbedTemplate(client).error("An error occurred while processing your delete request.")],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_DELETE] Failed to send error response: ${responseError}`);
        }
    }
};

/**
 * Handle the claim button click
 */
const handleClaimButton = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
): Promise<void> => {
    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);

        if (!ticket) {
            interaction.reply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Not a Ticket Channel")
                        .setDescription("This is not a valid ticket channel.")
                        .setColor("Red")
                ],
                flags: discord.MessageFlags.Ephemeral
            });
            return;
        }

        if (ticket.claimedById) {
            if (ticket.claimedById === interaction.user.id) {
                await interaction.deferReply();

                await ticketRepo.unclaimTicket(ticket.id);
                const channel = interaction.channel as discord.TextChannel;
                const unclaimEmbed = new discord.EmbedBuilder()
                    .setTitle("Ticket Unclaimed")
                    .setDescription(`This ticket is no longer being handled by <@${interaction.user.id}>.`)
                    .setColor("Orange")
                    .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
                    .setTimestamp();

                await channel.send({ embeds: [unclaimEmbed] });
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

                if (interaction.message) {
                    await interaction.message.edit({
                        components: [actionRow]
                    }).catch(err => {
                        client.logger.warn(`[TICKET_CLAIM] Could not update message: ${err}`);
                    });
                }

                await interaction.editReply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Ticket Unclaimed")
                            .setDescription("You have successfully unclaimed this ticket.")
                            .setColor("Green")
                    ]
                });

                client.logger.info(`[TICKET_CLAIM] ${interaction.user.tag} unclaimed ticket #${ticket.ticketNumber}`);
            } else {
                const claimer = await client.users.fetch(ticket.claimedById).catch(() => null);
                const claimerName = claimer ? claimer.tag : "Unknown";

                interaction.reply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Ticket Already Claimed")
                            .setDescription(`This ticket is already being handled by ${claimer ? `<@${claimer.id}>` : "someone else"}.`)
                            .addFields({
                                name: "Claimed By",
                                value: claimerName,
                                inline: true
                            })
                            .setColor("Red")
                    ],
                    flags: discord.MessageFlags.Ephemeral
                });
                return;
            }
            return;
        }

        const member = interaction.member as discord.GuildMember;
        const supportRoleId = ticket.category.supportRoleId;

        const hasPermission =
            member.permissions.has(discord.PermissionFlagsBits.ManageChannels) ||
            (supportRoleId && member.roles.cache.has(supportRoleId));

        if (!hasPermission) {
            interaction.reply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Permission Denied")
                        .setDescription("You don't have permission to claim tickets. Only support team members can claim tickets.")
                        .setColor("Red")
                ],
                flags: discord.MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply();

        await ticketRepo.claimTicket(ticket.id, interaction.user.id);
        const channel = interaction.channel as discord.TextChannel;
        const claimEmbed = new discord.EmbedBuilder()
            .setTitle("Ticket Claimed")
            .setDescription(`This ticket is now being handled by <@${interaction.user.id}>.`)
            .addFields(
                { name: "Claimed By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Claimed At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setColor("Blue")
            .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
            .setTimestamp();

        await channel.send({ embeds: [claimEmbed] });
        const actionRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
            .addComponents(
                new discord.ButtonBuilder()
                    .setCustomId("ticket_claim")
                    .setLabel("Unclaim Ticket")
                    .setStyle(discord.ButtonStyle.Secondary)
                    .setEmoji("🔄"),
                new discord.ButtonBuilder()
                    .setCustomId("ticket_close")
                    .setLabel("Close Ticket")
                    .setStyle(discord.ButtonStyle.Danger)
                    .setEmoji("🔒")
            );

        if (interaction.message) {
            await interaction.message.edit({
                components: [actionRow]
            }).catch(err => {
                client.logger.warn(`[TICKET_CLAIM] Could not update message: ${err}`);
            });
        }

        await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Ticket Claimed")
                    .setDescription("You have successfully claimed this ticket. You are now responsible for handling this support request.")
                    .setColor("Green")
            ]
        });

        client.logger.info(`[TICKET_CLAIM] ${interaction.user.tag} claimed ticket #${ticket.ticketNumber}`);
    } catch (error) {
        client.logger.error(`[TICKET_CLAIM] Error claiming ticket: ${error}`);
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Error")
                            .setDescription("An error occurred while claiming the ticket.")
                            .setColor("Red")
                    ]
                });
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Error")
                            .setDescription("An error occurred while claiming the ticket.")
                            .setColor("Red")
                    ],
                    flags: discord.MessageFlags.Ephemeral
                });
            }
        } catch (responseError) {
            client.logger.error(`[TICKET_CLAIM] Failed to send error response: ${responseError}`);
        }
    }
};

export default event;