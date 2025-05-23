import path from 'path';
import fs from 'fs/promises';
import { Embedding } from './llm';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { IProcessingOptions, IMetadata, IDocument } from '../../types';

/**
 * Retrieval-Augmented Generation document processor
 * Handles text file processing, chunking, and embedding generation
 */
export class RAG {
    private readonly embedding: Embedding;
    private readonly defaultOptions: Required<Omit<IProcessingOptions, 'customSeparators'>> & { customSeparators: string[] } = {
        chunkSize: 500,
        chunkOverlap: 50,
        tags: [],
        skipEmbedding: false,
        deduplicate: false,
        customSeparators: ["\n\n", "\n", ".", "!", "?", ",", " ", ""],
        maxConcurrentEmbeddings: 5
    };

    constructor(embedding: Embedding) {
        this.embedding = embedding;
    }

    /**
     * Validates if the file has a supported extension
     */
    private validateFile = (filePath: string): void => {
        const validExtensions = ['.txt', '.md'];
        const ext = path.extname(filePath).toLowerCase();

        if (!validExtensions.includes(ext)) {
            throw new Error(`Invalid file extension. Supported extensions are: ${validExtensions.join(', ')}`);
        }
    };

    /**
     * Safely reads file content with proper error handling
     */
    private readFile = async (filePath: string): Promise<string> => {
        try {
            await fs.access(filePath);
            return await fs.readFile(filePath, 'utf-8');
        } catch (error: Error | any) {
            if (error.code === 'ENOENT') {
                throw new Error(`File not found: ${filePath}`);
            }
            throw new Error(`Failed to read file: ${error.message}`);
        }
    };

    /**
     * Creates chunks from text using semantic chunking
     */
    private semanticChunking = async (
        content: string,
        options: Required<IProcessingOptions> & { customSeparators: string[] }
    ): Promise<string[]> => {
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: options.chunkSize,
            chunkOverlap: options.chunkOverlap,
            separators: options.customSeparators || this.defaultOptions.customSeparators,
        });

        return await splitter.splitText(content);
    };

    /**
     * Generates a simple hash for deduplication
     */
    private generateContentHash = (content: string): string => {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    };

    /**
     * Creates metadata for a document chunk
     */
    private createMetadata = (
        filePath: string,
        content: string,
        chunkIndex: number,
        totalChunks: number,
        tags: string[],
        generateHash = false
    ): IMetadata => {
        const now = new Date();
        const metadata: IMetadata = {
            source: {
                name: path.basename(filePath),
                path: filePath,
                type: path.extname(filePath).toLowerCase().slice(1) as 'txt' | 'md'
            },
            createdAt: now,
            updatedAt: now,
            tags: [...tags],
            chunkIndex,
            totalChunks,
            wordCount: content.split(/\s+/).filter(Boolean).length,
            charCount: content.length
        };

        if (generateHash) {
            metadata.hash = this.generateContentHash(content);
        }

        return metadata;
    };

    /**
     * Processes chunks in batches to control concurrency
     */
    private processChunksInBatches = async (
        chunks: string[],
        filePath: string,
        options: Required<IProcessingOptions> & { customSeparators: string[] }
    ): Promise<IDocument[]> => {
        const documents: IDocument[] = [];
        const batchSize = options.maxConcurrentEmbeddings;
        const totalChunks = chunks.length;
        const seenHashes = new Set<string>();

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchPromises = batch.map(async (chunk, batchIndex) => {
                const chunkIndex = i + batchIndex;
                const metadata = this.createMetadata(
                    filePath,
                    chunk,
                    chunkIndex,
                    totalChunks,
                    options.tags,
                    options.deduplicate
                );

                if (options.deduplicate && metadata.hash && seenHashes.has(metadata.hash)) {
                    return null;
                }

                if (metadata.hash) {
                    seenHashes.add(metadata.hash);
                }

                const document: IDocument = {
                    content: chunk,
                    metadata
                };

                if (!options.skipEmbedding) {
                    try {
                        const embeddingVector = await this.embedding.create(chunk);
                        document.embedding = embeddingVector;
                    } catch (error: Error | any) {
                        console.error(`Failed to create embedding for chunk ${chunkIndex}: ${error.message}`);
                    }
                }

                return document;
            });

            const batchResults = await Promise.all(batchPromises);
            documents.push(...batchResults.filter((doc): doc is IDocument => doc !== null));
        }

        return documents;
    };

    /**
     * Process a single document file
     */
    public processDocument = async (
        filePath: string,
        options?: IProcessingOptions
    ): Promise<IDocument[]> => {
        this.validateFile(filePath);

        const mergedOptions = {
            ...this.defaultOptions,
            ...options,
            customSeparators: options?.customSeparators || this.defaultOptions.customSeparators
        };

        const content = await this.readFile(filePath);
        const chunks = await this.semanticChunking(content, mergedOptions);

        return this.processChunksInBatches(chunks, filePath, mergedOptions);
    };

    /**
     * Process multiple document files
     */
    public processMultipleDocuments = async (
        filePaths: string[],
        options?: IProcessingOptions
    ): Promise<IDocument[]> => {
        const allDocuments: IDocument[] = [];
        const results = { success: 0, failed: 0, skipped: 0 };

        for (const filePath of filePaths) {
            try {
                const documents = await this.processDocument(filePath, options);
                allDocuments.push(...documents);
                results.success++;
            } catch (error: Error | any) {
                console.error(`Failed to process ${filePath}: ${error.message}`);
                results.failed++;
            }
        }

        console.log(`Processing complete: ${results.success} successful, ${results.failed} failed, ${results.skipped} skipped.`);
        return allDocuments;
    };

    /**
     * Process text content directly without a file
     */
    public processText = async (
        text: string,
        source: { name: string; type: 'txt' | 'md' },
        options?: IProcessingOptions
    ): Promise<IDocument[]> => {
        const mergedOptions = {
            ...this.defaultOptions,
            ...options,
            customSeparators: options?.customSeparators || this.defaultOptions.customSeparators
        };

        const chunks = await this.semanticChunking(text, mergedOptions);
        const virtualFilePath = `memory://${source.name}.${source.type}`;

        return this.processChunksInBatches(chunks, virtualFilePath, mergedOptions);
    };

    /**
     * Get embedding for a single query text
     * Useful for search operations
     */
    public getQueryEmbedding = async (text: string): Promise<number[]> => {
        try {
            const embeddingVector = await this.embedding.create(text);
            return embeddingVector;
        } catch (error: Error | any) {
            throw new Error(`Failed to create query embedding: ${error.message}`);
        }
    };
}