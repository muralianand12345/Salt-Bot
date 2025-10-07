import discord from 'discord.js';

import { BotEvent } from '../../../types';
import { ChatbotService } from '../../../core/ai';
import { EmbedTemplate } from '../../../core/embed/template';

const event: BotEvent = {
	name: discord.Events.InteractionCreate,
	execute: async (interaction: discord.Interaction, client: discord.Client): Promise<void> => {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('ticket_confirm_')) return;

		try {
			if (!(client as any).dataSource) {
				await interaction.reply({
					embeds: [new EmbedTemplate(client).error('Database connection is not available.')],
					flags: discord.MessageFlags.Ephemeral,
				});
				return;
			}
			const chatbotService = new ChatbotService((client as any).dataSource);
			const customIdParts = interaction.customId.split('_');
			const action = customIdParts[2]; // "yes" or "no"
			const confirmationId = customIdParts.slice(3).join('_');
			const confirmed = action === 'yes';
			const result = await chatbotService.handleTicketConfirmation(confirmationId, confirmed, interaction.user.id);

			if (!result.success && result.message === 'You can only confirm your own ticket creation requests.') {
				await interaction.reply({
					embeds: [new EmbedTemplate(client).error(result.message)],
					flags: discord.MessageFlags.Ephemeral,
				});
				return;
			}

			await interaction.deferUpdate();
			if (confirmed) {
				if (result.success) {
					const successEmbed = new discord.EmbedBuilder().setTitle('✅ Ticket Created Successfully').setDescription(result.message).setColor('Green').setTimestamp();

					await interaction.update({
						embeds: [successEmbed],
						components: [],
					});

					if (result.ticketChannel) {
						await interaction.followUp({
							content: `Your ticket has been created! ${result.ticketChannel}`,
							flags: discord.MessageFlags.Ephemeral,
						});
					}
				} else {
					const errorEmbed = new discord.EmbedBuilder().setTitle('❌ Ticket Creation Failed').setDescription(result.message).setColor('Red').setTimestamp();

					await interaction.update({
						embeds: [errorEmbed],
						components: [],
					});
				}
			} else {
				const cancelEmbed = new discord.EmbedBuilder().setTitle('❌ Ticket Creation Cancelled').setDescription('The ticket creation has been cancelled. Feel free to ask me anything else!').setColor('Orange').setTimestamp();

				await interaction.update({
					embeds: [cancelEmbed],
					components: [],
				});
			}

			client.logger.info(`[TICKET_CONFIRMATION] User ${interaction.user.tag} ${confirmed ? 'confirmed' : 'cancelled'} ticket creation`);
		} catch (error) {
			client.logger.error(`[TICKET_CONFIRMATION] Error handling ticket confirmation: ${error}`);

			try {
				const errorEmbed = new discord.EmbedBuilder().setTitle('❌ Error').setDescription('An error occurred while processing your confirmation. Please try again.').setColor('Red').setTimestamp();

				if (interaction.deferred) {
					await interaction.editReply({
						embeds: [errorEmbed],
						components: [],
					});
				} else {
					await interaction.reply({
						embeds: [errorEmbed],
						flags: discord.MessageFlags.Ephemeral,
					});
				}
			} catch (replyError) {
				client.logger.error(`[TICKET_CONFIRMATION] Failed to send error response: ${replyError}`);
			}
		}
	},
};

export default event;
