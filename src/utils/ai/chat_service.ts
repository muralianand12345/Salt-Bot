import discord from "discord.js";
import { DataSource } from "typeorm";
import { TicketManager } from "../ticket";
import { ChatbotConfig } from "../../events/database/entities/chatbot_config";
import { RagRepository } from "../../events/database/repo/rag_data";

import { RAG } from "./rag";
import { LLM, Embedding } from "./llm";
import ChatHistory from "./chat_history";
import { createDynamicTicketTool } from "./tools";
import client from "../../salt";

/**
 * Service class for handling chatbot interactions with RAG integration and tool support
 * Manages message processing, RAG context retrieval, tool execution, and LLM responses
 */
export class ChatbotService {
    private ragRepo: RagRepository;
    private dataSource: DataSource;
    private ticketManager: TicketManager;

    private static pendingTicketCreations: Map<string, {
        categoryId: string;
        userMessage: string;
        guildId: string;
        channelId: string;
        userId: string;
        toolMessage: string;
    }> = new Map();

    constructor(dataSource: DataSource) {
        this.dataSource = dataSource;
        this.ragRepo = new RagRepository(dataSource);
        this.ticketManager = new TicketManager(dataSource);
    }

    /**
     * Get chatbot configuration by channel ID
     * @param channelId - Discord channel ID
     * @returns Chatbot configuration or null if not found
     */
    public getConfigByChannelId = async (channelId: string): Promise<ChatbotConfig | null> => {
        try {
            const configs = await this.dataSource.getRepository(ChatbotConfig).find();
            return configs.find(config => config.channelId === channelId) || null;
        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error finding config by channel ID: ${error}`);
            return null;
        }
    };

    /**
     * Search for relevant context from RAG data
     * @param query - User's query
     * @param guildId - Discord guild ID
     * @returns Relevant context or null if no RAG data available
     */
    private searchRagContext = async (query: string, guildId: string): Promise<string | null> => {
        try {
            const hasRagData = await this.ragRepo.hasRagData(guildId);
            if (!hasRagData) {
                return null;
            }

            const embedding = new Embedding();
            const rag = new RAG(embedding);
            const queryEmbedding = await rag.getQueryEmbedding(query);

            const similarChunks = await this.ragRepo.searchSimilarChunks(
                guildId,
                queryEmbedding,
                5
            );

            if (similarChunks.length === 0) {
                return null;
            }

            const context = similarChunks
                .map((chunk, index) => `[Context ${index + 1}]\n${chunk.content}`)
                .join('\n\n');

            return context;
        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error searching RAG context: ${error}`);
            return null;
        }
    };

    /**
     * Build the system prompt with optional RAG context
     * @param config - Chatbot configuration
     * @param ragContext - RAG context if available
     * @param includeTools - Whether to include tool instructions
     * @returns System prompt string
     */
    private buildSystemPrompt = (config: ChatbotConfig, ragContext: string | null, includeTools: boolean = false): string => {
        let systemPrompt = `You are ${config.chatbotName}, an AI assistant in a Discord server. `;

        if (config.responseType && config.responseType.trim().length > 0) {
            systemPrompt += `Your personality and response style: ${config.responseType}. `;
        }

        systemPrompt += `
        Guidelines:
        - Be helpful, informative, and engaging
        - Keep responses concise but thorough
        - Use Discord-friendly formatting when appropriate
        - If you don't know something, say so honestly
        - Stay in character as ${config.chatbotName}
        - Answer questions directly without suggesting tickets unless explicitly needed`;

        if (includeTools) {
            systemPrompt += `
            IMPORTANT - Ticket Creation Tool Guidelines:
            ONLY use the create_ticket tool when:
            - User EXPLICITLY asks to "create a ticket", "open a ticket", "talk to support", or "contact staff"
            - User clearly expresses frustration and wants human help after you've provided assistance
            - User has a complex technical issue that requires server admin intervention
            - User is reporting bugs, server problems, or policy violations
            - User specifically requests to escalate their issue

            DO NOT use the create_ticket tool when:
            - User is asking general questions you can answer
            - User is just having a normal conversation
            - User's question can be resolved with information or guidance
            - User hasn't indicated they need human assistance
            - This is the user's first question about a topic

            Be conservative with ticket creation. Always try to help the user first with a direct answer. Only suggest tickets when the user clearly needs human intervention or explicitly requests it.`;
        }

        if (ragContext) {
            systemPrompt += `
            You have access to specific knowledge about this server/topic. Use the following context to answer questions when relevant:

            ${ragContext}

            When using this context:
                - Reference the information naturally in your response
                - If the context is relevant, use it to provide accurate, detailed answers
                - If the context doesn't relate to the question, you can still provide general help
                - Don't mention that you're using "context" or "knowledge base" explicitly`;
        }

        return systemPrompt;
    };
    /**
     * Get available ticket categories for tool usage
     * @param guildId - Discord guild ID
     * @returns Array of category IDs and names
     */
    private getTicketCategories = async (guildId: string): Promise<Array<{ id: string; name: string }>> => {
        try {
            const categories = await this.ticketManager.getAvailableCategories(guildId);
            return categories.map(cat => ({ id: cat.id, name: cat.name }));
        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error getting ticket categories: ${error}`);
            return [];
        }
    };

    /**
     * Process a user message and generate a response with two-stage LLM invocation
     * @param userMessage - The user's message content
     * @param userId - Discord user ID
     * @param config - Chatbot configuration
     * @param channelId - Discord channel ID
     * @returns Generated response, confirmation button, or null if failed
     */
    public processMessage = async (
        userMessage: string,
        userId: string,
        config: ChatbotConfig,
        channelId: string
    ): Promise<{
        response?: string;
        needsConfirmation?: boolean;
        confirmationEmbed?: discord.EmbedBuilder;
        confirmationButtons?: discord.ActionRowBuilder<discord.ButtonBuilder>;
    } | null> => {
        try {
            const llm = new LLM(config.apiKey, config.baseUrl);

            const chatHistory = new ChatHistory(
                this.dataSource,
                userId,
                config.guildId,
                20
            );

            const ragContext = await this.searchRagContext(userMessage, config.guildId);
            const categories = await this.getTicketCategories(config.guildId);

            // Stage 1: Check if tools need to be executed
            if (categories.length > 0) {
                const toolSystemPrompt = this.buildSystemPrompt(config, ragContext, true);
                const history = await chatHistory.getHistory();
                const filteredHistory = history.filter(msg => msg.role !== 'system');

                const toolMessages = [
                    { role: 'system' as const, content: toolSystemPrompt },
                    ...filteredHistory,
                    { role: 'user' as const, content: userMessage }
                ];

                const categoryIds = categories.map(cat => cat.id);
                const tools = createDynamicTicketTool(categories);

                const toolResponse = await llm.invoke(toolMessages, config.modelName, {
                    max_tokens: 2000,
                    temperature: 0.3,
                    tools: tools,
                    tool_choice: "auto"
                });

                const toolCalls = toolResponse.choices[0]?.message?.tool_calls;

                if (toolCalls && toolCalls.length > 0) {
                    const toolCall = toolCalls[0];

                    if (toolCall.function.name === "create_ticket") {
                        const args = JSON.parse(toolCall.function.arguments);
                        const selectedCategory = categories.find(cat => cat.name === args.ticket_category);

                        if (selectedCategory) {
                            const confirmationId = `ticket_confirm_${userId}_${Date.now()}`;

                            this.cleanupOldConfirmations();

                            ChatbotService.pendingTicketCreations.set(confirmationId, {
                                categoryId: selectedCategory.id,
                                userMessage,
                                guildId: config.guildId,
                                channelId,
                                userId,
                                toolMessage: args.message || "A ticket will be created to assist you with your request."
                            });

                            client.logger.debug(`[CHATBOT_SERVICE] Stored pending ticket creation with ID: ${confirmationId}`);

                            const confirmationEmbed = new discord.EmbedBuilder()
                                .setTitle("🎫 Create Ticket Confirmation")
                                .setDescription(
                                    `${args.message || "I'd like to create a ticket to better assist you with your request."}\n\n` +
                                    `**Category:** ${selectedCategory.name}\n` +
                                    `**Your message:** ${userMessage.length > 100 ? userMessage.substring(0, 100) + "..." : userMessage}`
                                )
                                .setColor("Blue")
                                .setFooter({ text: "This will create a private support channel for you" });

                            const confirmationButtons = new discord.ActionRowBuilder<discord.ButtonBuilder>()
                                .addComponents(
                                    new discord.ButtonBuilder()
                                        .setCustomId(`ticket_confirm_yes_${confirmationId}`)
                                        .setLabel("Create Ticket")
                                        .setStyle(discord.ButtonStyle.Success)
                                        .setEmoji("✅"),
                                    new discord.ButtonBuilder()
                                        .setCustomId(`ticket_confirm_no_${confirmationId}`)
                                        .setLabel("Cancel")
                                        .setStyle(discord.ButtonStyle.Secondary)
                                        .setEmoji("❌")
                                );

                            return {
                                needsConfirmation: true,
                                confirmationEmbed,
                                confirmationButtons
                            };
                        }
                    }
                }
            }

            // Stage 2: Normal response generation (no tools needed)
            const normalSystemPrompt = this.buildSystemPrompt(config, ragContext, false);
            const history = await chatHistory.getHistory();
            const filteredHistory = history.filter(msg => msg.role !== 'system');

            const normalMessages = [
                { role: 'system' as const, content: normalSystemPrompt },
                ...filteredHistory,
                { role: 'user' as const, content: userMessage }
            ];

            const response = await llm.invoke(normalMessages, config.modelName, {
                max_tokens: 2000,
                temperature: 0.7
            });

            const assistantMessage = response.choices[0]?.message?.content;

            if (!assistantMessage) {
                client.logger.error('[CHATBOT_SERVICE] No response content from LLM');
                return null;
            }

            await chatHistory.addUserMessage(userMessage);
            await chatHistory.addAssistantMessage(assistantMessage);

            return { response: assistantMessage };

        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error processing message: ${error}`);
            return null;
        }
    };

    /**
     * Handle ticket creation confirmation using TicketManager
     * @param confirmationId - The confirmation ID
     * @param confirmed - Whether the user confirmed
     * @returns Success message or error
     */
    public handleTicketConfirmation = async (
        confirmationId: string,
        confirmed: boolean
    ): Promise<{ success: boolean; message: string; ticketChannel?: string }> => {
        try {
            client.logger.debug(`[CHATBOT_SERVICE] Looking for confirmation ID: ${confirmationId}`);
            client.logger.debug(`[CHATBOT_SERVICE] Available confirmations: ${Array.from(ChatbotService.pendingTicketCreations.keys()).join(', ')}`);

            const pendingCreation = ChatbotService.pendingTicketCreations.get(confirmationId);
            if (!pendingCreation) {
                return { success: false, message: "Ticket creation request has expired or is invalid." };
            }

            ChatbotService.pendingTicketCreations.delete(confirmationId);
            client.logger.debug(`[CHATBOT_SERVICE] Deleted confirmation ID: ${confirmationId}`);

            const chatHistory = new ChatHistory(
                this.dataSource,
                pendingCreation.userId,
                pendingCreation.guildId,
                20
            );

            if (!confirmed) {
                await chatHistory.addUserMessage(pendingCreation.userMessage);
                await chatHistory.addAssistantMessage("I understand you don't need a ticket right now. Feel free to ask me anything else!");

                return { success: true, message: "Ticket creation has been cancelled." };
            }

            const ticketResult = await this.ticketManager.createTicket({
                userId: pendingCreation.userId,
                guildId: pendingCreation.guildId,
                categoryId: pendingCreation.categoryId,
                originalMessage: pendingCreation.userMessage,
                fromChatbot: true,
                additionalContext: "Please provide any additional details, and a staff member will assist you shortly."
            });

            if (ticketResult.success && ticketResult.ticket && ticketResult.channel) {
                await chatHistory.addUserMessage(pendingCreation.userMessage);
                await chatHistory.addAssistantMessage(
                    `I've created ticket #${ticketResult.ticketNumber} for you. You can find it here: ${ticketResult.channel}. A staff member will assist you shortly!`
                );

                client.logger.info(`[CHATBOT_SERVICE] Created ticket #${ticketResult.ticketNumber} via AI assistant for user ${pendingCreation.userId}`);

                return {
                    success: true,
                    message: `Ticket created successfully! Please check ${ticketResult.channel} for further assistance.`,
                    ticketChannel: ticketResult.channel.toString()
                };
            } else {
                await chatHistory.addUserMessage(pendingCreation.userMessage);
                await chatHistory.addAssistantMessage(
                    `I apologize, but there was an issue creating your ticket: ${ticketResult.error || "Unknown error"}. Please try again or contact an administrator.`
                );

                return {
                    success: false,
                    message: ticketResult.error || "An error occurred while creating the ticket."
                };
            }

        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error handling ticket confirmation: ${error}`);
            return { success: false, message: "An error occurred while creating the ticket." };
        }
    };

    /**
     * Clean up old pending confirmations (older than 5 minutes)
     */
    private cleanupOldConfirmations = (): void => {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

        for (const [key, value] of ChatbotService.pendingTicketCreations.entries()) {
            const timestamp = parseInt(key.split('_').pop() || '0');
            if (timestamp < fiveMinutesAgo) {
                ChatbotService.pendingTicketCreations.delete(key);
                client.logger.debug(`[CHATBOT_SERVICE] Cleaned up expired confirmation: ${key}`);
            }
        }
    };

    /**
     * Split long responses into Discord-friendly chunks
     * @param response - The response to split
     * @returns Array of response chunks
     */
    public splitResponse = (response: string): string[] => {
        const maxLength = 2000;
        const chunks: string[] = [];

        if (response.length <= maxLength) {
            return [response];
        }

        const paragraphs = response.split('\n\n');
        let currentChunk = '';

        for (const paragraph of paragraphs) {
            if ((currentChunk + paragraph).length > maxLength) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }

                if (paragraph.length > maxLength) {
                    const sentences = paragraph.split('. ');
                    for (const sentence of sentences) {
                        if ((currentChunk + sentence + '. ').length > maxLength) {
                            if (currentChunk) {
                                chunks.push(currentChunk.trim());
                                currentChunk = '';
                            }
                            if (sentence.length > maxLength) {
                                const words = sentence.split(' ');
                                for (const word of words) {
                                    if ((currentChunk + word + ' ').length > maxLength) {
                                        if (currentChunk) {
                                            chunks.push(currentChunk.trim());
                                            currentChunk = '';
                                        }
                                    }
                                    currentChunk += word + ' ';
                                }
                            } else {
                                currentChunk = sentence + '. ';
                            }
                        } else {
                            currentChunk += sentence + '. ';
                        }
                    }
                } else {
                    currentChunk = paragraph + '\n\n';
                }
            } else {
                currentChunk += paragraph + '\n\n';
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    };

    /**
     * Clear chat history for a user
     * @param userId - Discord user ID
     * @param guildId - Discord guild ID
     * @returns True if successful, false otherwise
     */
    public clearUserHistory = async (userId: string, guildId: string): Promise<boolean> => {
        try {
            const chatHistory = new ChatHistory(this.dataSource, userId, guildId);
            await chatHistory.clearHistory(false);
            return true;
        } catch (error) {
            client.logger.error(`[CHATBOT_SERVICE] Error clearing user history: ${error}`);
            return false;
        }
    };
}