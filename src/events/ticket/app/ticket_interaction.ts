import discord from "discord.js";
import { BotEvent } from "../../../types";
import { createTicket } from "../../../utils/ticket";
import { TicketRepository } from "../../../events/database/repo/ticket_system";
import { ITicketStatus } from "../../../events/database/entities/ticket_system";

const event: BotEvent = {
    name: discord.Events.InteractionCreate,
    execute: async (interaction: discord.Interaction, client: discord.Client): Promise<void> => {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
            return;
        }

        try {
            if (!(client as any).dataSource) {
                client.logger.error("[TICKET_INTERACTION] Database connection is not available");
                return;
            }

            const ticketRepo = new TicketRepository((client as any).dataSource);

            if (interaction.isButton()) {
                switch (interaction.customId) {
                    case "create_ticket":
                        const categories = await ticketRepo.getTicketCategories(interaction.guildId!);
                        const enabledCategories = categories.filter(category => category.isEnabled);

                        if (enabledCategories.length === 0) {
                            await interaction.reply({
                                embeds: [
                                    new discord.EmbedBuilder()
                                        .setTitle("No Categories Available")
                                        .setDescription("There are no ticket categories available.")
                                        .setColor("Red")
                                ],
                                flags: discord.MessageFlags.Ephemeral
                            });
                            return;
                        }

                        if (enabledCategories.length === 1) {
                            await createTicket(interaction, enabledCategories[0].id);
                            return;
                        }

                        const selectMenu = new discord.StringSelectMenuBuilder()
                            .setCustomId("ticket_category_select")
                            .setPlaceholder("Select a ticket category");
                        enabledCategories.forEach(category => {
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

                        await interaction.reply({
                            embeds: [selectEmbed],
                            components: [actionRow],
                            flags: discord.MessageFlags.Ephemeral
                        });
                        break;

                    case "ticket_close":
                        const closeTicket = await ticketRepo.getTicketByChannelId(interaction.channelId);

                        if (!closeTicket) {
                            await interaction.reply({
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

                        if (closeTicket.status !== "open") {
                            await interaction.reply({
                                embeds: [
                                    new discord.EmbedBuilder()
                                        .setTitle("Ticket Already Closed")
                                        .setDescription("This ticket is already closed.")
                                        .setColor("Red")
                                ],
                                flags: discord.MessageFlags.Ephemeral
                            });
                            return;
                        }

                        const closeModal = new discord.ModalBuilder()
                            .setCustomId("ticket_close_modal")
                            .setTitle("Close Ticket");

                        const reasonInput = new discord.TextInputBuilder()
                            .setCustomId("ticket_close_reason")
                            .setLabel("Reason for closing the ticket")
                            .setPlaceholder("Enter the reason for closing this ticket...")
                            .setRequired(false)
                            .setStyle(discord.TextInputStyle.Paragraph);

                        const actionRow2 = new discord.ActionRowBuilder<discord.TextInputBuilder>()
                            .addComponents(reasonInput);

                        closeModal.addComponents(actionRow2);

                        await interaction.showModal(closeModal);
                        break;

                    case "ticket_reopen":
                        await handleReopenTicket(interaction, client, ticketRepo);
                        break;

                    case "ticket_archive":
                        await handleArchiveTicket(interaction, client, ticketRepo);
                        break;

                    case "ticket_delete":
                        await handleDeleteTicket(interaction, client, ticketRepo);
                        break;

                    case "ticket_claim":
                        await handleClaimTicket(interaction, client, ticketRepo);
                        break;
                }
            } else if (interaction.isStringSelectMenu()) {
                if (interaction.customId === "ticket_category_select") {
                    const categoryId = interaction.values[0];
                    await createTicket(interaction, categoryId);
                }
            }
        } catch (error) {
            client.logger.error(`[TICKET_INTERACTION] Error handling interaction: ${error}`);
            try {
                if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        embeds: [
                            new discord.EmbedBuilder()
                                .setTitle("Error")
                                .setDescription("An error occurred while processing your request.")
                                .setColor("Red")
                        ],
                        flags: discord.MessageFlags.Ephemeral
                    });
                }
            } catch (replyError) {
                client.logger.error(`[TICKET_INTERACTION] Error sending error message: ${replyError}`);
            }
        }
    }
};

const handleReopenTicket = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
): Promise<void> => {
    await interaction.deferReply();

    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId!);

        if (!ticket) {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Not a Ticket Channel")
                        .setDescription("This is not a valid ticket channel.")
                        .setColor("Red")
                ]
            });
            return;
        }

        if (ticket.status === "open") {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Ticket Already Open")
                        .setDescription("This ticket is already open.")
                        .setColor("Red")
                ]
            });
            return;
        }

        await ticketRepo.updateTicketStatus(
            ticket.id,
            ITicketStatus.OPEN
        );

        const channel = interaction.channel as discord.TextChannel;
        const reopenEmbed = new discord.EmbedBuilder()
            .setTitle("Ticket Reopened")
            .setDescription("This ticket has been reopened.")
            .addFields(
                { name: "Reopened By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Reopened At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setColor("Green")
            .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
            .setTimestamp();

        await channel.send({ embeds: [reopenEmbed] });

        try {
            await channel.permissionOverwrites.edit(
                interaction.guild!.roles.everyone,
                { SendMessages: null }
            );

            await channel.permissionOverwrites.edit(
                ticket.creatorId,
                {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                }
            );

            if (ticket.category.supportRoleId) {
                await channel.permissionOverwrites.edit(
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
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Ticket Reopened")
                        .setDescription("The ticket has been reopened successfully.")
                        .setColor("Green")
                ],
                components: [actionRow]
            });
        } catch (error) {
            client.logger.error(`[TICKET_REOPEN] Error updating permissions: ${error}`);
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Partial Success")
                        .setDescription("The ticket was marked as reopened, but channel permissions could not be updated.")
                        .setColor("Yellow")
                ]
            });
        }
    } catch (error) {
        client.logger.error(`[TICKET_REOPEN] Error reopening ticket: ${error}`);
        await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Error")
                    .setDescription("An error occurred while reopening the ticket.")
                    .setColor("Red")
            ]
        });
    }
};

const handleArchiveTicket = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
): Promise<void> => {
    await interaction.deferReply();

    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);

        if (!ticket) {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Not a Ticket Channel")
                        .setDescription("This is not a valid ticket channel.")
                        .setColor("Red")
                ]
            });
            return;
        }

        if (ticket.status === "archived") {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Ticket Already Archived")
                        .setDescription("This ticket is already archived.")
                        .setColor("Red")
                ]
            });
            return;
        }

        await ticketRepo.updateTicketStatus(
            ticket.id,
            ITicketStatus.ARCHIVED,
            interaction.user.id,
            "Ticket archived via button"
        );

        const channel = interaction.channel as discord.TextChannel;
        const archiveEmbed = new discord.EmbedBuilder()
            .setTitle("Ticket Archived")
            .setDescription("This ticket has been archived and will be stored for reference.")
            .addFields(
                { name: "Archived By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Archived At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setColor("Blue")
            .setFooter({ text: `Ticket #${ticket.ticketNumber}` })
            .setTimestamp();

        await channel.send({ embeds: [archiveEmbed] });
        await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Ticket Archived")
                    .setDescription("The ticket has been archived successfully.")
                    .setColor("Blue")
            ]
        });
    } catch (error) {
        client.logger.error(`[TICKET_ARCHIVE] Error archiving ticket: ${error}`);
        await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Error")
                    .setDescription("An error occurred while archiving the ticket.")
                    .setColor("Red")
            ]
        });
    }
};

const handleDeleteTicket = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
): Promise<void> => {
    await interaction.deferReply();

    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);

        if (!ticket) {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Not a Ticket Channel")
                        .setDescription("This is not a valid ticket channel.")
                        .setColor("Red")
                ]
            });
            return;
        }

        if (!interaction.memberPermissions?.has(discord.PermissionFlagsBits.ManageChannels)) {
            await interaction.editReply({
                embeds: [
                    new discord.EmbedBuilder()
                        .setTitle("Permission Denied")
                        .setDescription("You need the 'Manage Channels' permission to delete tickets.")
                        .setColor("Red")
                ]
            });
            return;
        }

        const confirmEmbed = new discord.EmbedBuilder()
            .setTitle("Confirm Ticket Deletion")
            .setDescription("Are you sure you want to delete this ticket? This action cannot be undone.")
            .setColor("Red");

        const confirmRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
            .addComponents(
                new discord.ButtonBuilder()
                    .setCustomId("confirm_delete")
                    .setLabel("Delete Ticket")
                    .setStyle(discord.ButtonStyle.Danger),
                new discord.ButtonBuilder()
                    .setCustomId("cancel_delete")
                    .setLabel("Cancel")
                    .setStyle(discord.ButtonStyle.Secondary)
            );

        const confirmMessage = await interaction.editReply({
            embeds: [confirmEmbed],
            components: [confirmRow]
        });

        const collector = (confirmMessage as discord.Message).createMessageComponentCollector({
            filter: (i): i is discord.ButtonInteraction =>
                i.isButton() && i.user.id === interaction.user.id,
            time: 30000,
            max: 1
        });

        collector.on('collect', async i => {
            if (i.customId === "confirm_delete") {
                await i.deferUpdate();

                const channel = interaction.channel as discord.TextChannel;
                const deleteEmbed = new discord.EmbedBuilder()
                    .setTitle("Ticket Deleted")
                    .setDescription(`Ticket #${ticket.ticketNumber} has been deleted.`)
                    .setColor("Red")
                    .setTimestamp();

                await ticketRepo.updateTicketStatus(
                    ticket.id,
                    ITicketStatus.CLOSED,
                    interaction.user.id,
                    "Ticket deleted by staff"
                );

                try {
                    const creator = await client.users.fetch(ticket.creatorId);
                    await creator.send({ embeds: [deleteEmbed] }).catch(() => {

                    });
                } catch (error) {
                    client.logger.warn(`[TICKET_DELETE] Could not send DM to ticket creator: ${error}`);
                }

                await i.editReply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Deleting Ticket")
                            .setDescription("The ticket is being deleted...")
                            .setColor("Red")
                    ],
                    components: []
                });

                setTimeout(async () => {
                    try {
                        await channel.delete();
                        client.logger.info(`[TICKET_DELETE] Ticket #${ticket.ticketNumber} deleted by ${interaction.user.tag}`);
                    } catch (error) {
                        client.logger.error(`[TICKET_DELETE] Error deleting channel: ${error}`);
                    }
                }, 3000);
            } else {
                await i.update({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Deletion Cancelled")
                            .setDescription("The ticket deletion was cancelled.")
                            .setColor("Green")
                    ],
                    components: []
                });
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({
                    embeds: [
                        new discord.EmbedBuilder()
                            .setTitle("Deletion Cancelled")
                            .setDescription("The ticket deletion timed out.")
                            .setColor("Green")
                    ],
                    components: []
                });
            }
        });
    } catch (error) {
        client.logger.error(`[TICKET_DELETE] Error handling delete button: ${error}`);
        await interaction.editReply({
            embeds: [
                new discord.EmbedBuilder()
                    .setTitle("Error")
                    .setDescription("An error occurred while processing the delete request.")
                    .setColor("Red")
            ]
        });
    }
};

const handleClaimTicket = async (
    interaction: discord.ButtonInteraction,
    client: discord.Client,
    ticketRepo: TicketRepository
): Promise<void> => {
    try {
        const ticket = await ticketRepo.getTicketByChannelId(interaction.channelId);

        if (!ticket) {
            await interaction.reply({
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