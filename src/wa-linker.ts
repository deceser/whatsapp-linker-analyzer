import { Client, LocalAuth, Message, Contact, Chat, GroupChat, PrivateChat } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { transformToLLMSchema, saveLLMJson, LLMWhatsAppData } from './whatsapp-llm-transform';

export interface LinkingResult {
  success: boolean;
  pairingCode?: string;
  error?: string;
  analysisData?: any; // WhatsApp analysis data
  llmDataPath?: string; // saved normalized LLM JSON path
  llmData?: LLMWhatsAppData; // optional in-memory normalized data
}

export interface WhatsAppAnalysis {
  phoneNumber: string;
  timestamp: string;
  profileInfo: {
    name: string;
    about: string;
    profilePicUrl: string;
    isBusiness: boolean;
    isEnterprise: boolean;
  };
  contacts: {
    id: string;
    name: string;
    number: string;
    isGroup: boolean;
    isBlocked: boolean;
    isMyContact: boolean;
    about: string;
    profilePicUrl: string;
  }[];
  chats: {
    id: string;
    name: string;
    isGroup: boolean;
    isMuted: boolean;
    isArchived: boolean;
    unreadCount: number;
    lastMessage: {
      body: string;
      timestamp: number;
      fromMe: boolean;
      type: string;
    } | null;
    participants: string[];
  }[];
  messageHistory: {
    chatId: string;
    chatName: string;
    messageCount: number;
    messages: {
      id: string;
      body: string;
      timestamp: number;
      fromMe: boolean;
      type: string;
      author: string;
      hasMedia: boolean;
      mediaType?: string;
    }[];
  }[];
  groups: {
    id: string;
    name: string;
    description: string;
    participants: string[];
    admins: string[];
    owner: string;
    createdAt: number;
    isReadOnly: boolean;
  }[];
  statistics: {
    totalMessages: number;
    totalChats: number;
    totalGroups: number;
    totalContacts: number;
    messagesByType: Record<string, number>;
    mostActiveChats: Array<{ chatId: string; name: string; messageCount: number }>;
    mostActiveContacts: Array<{ contactId: string; name: string; messageCount: number }>;
  };
}

export class SimpleWhatsAppLinker {
  private client: Client;
  private isReady: boolean = false;
  private pairingCode: string | null = null;

  constructor() {
    // Initialize WhatsApp client with LocalAuth for session persistence
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'simple-whatsapp-linker',
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Listen for QR code (fallback method)
    this.client.on('qr', (qr) => {
      console.log('QR Code received. Please scan with your WhatsApp app.');
      console.log('QR Code:', qr);
    });

    // Listen for pairing code event
    this.client.on('code', (code) => {
      console.log('📱 Pairing code received:', code);
      this.pairingCode = code;
    });

    // Listen for when client is ready
    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
    });

    // Listen for authentication success
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated successfully!');
    });

    // Listen for authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
    });

    // Listen for disconnection
    this.client.on('disconnected', (reason) => {
      console.log('📴 WhatsApp client disconnected:', reason);
      this.isReady = false;
    });
  }

  /**
   * INTERNAL: Wait until wwebjs exposes the Puppeteer Page instance.
   */
  private async waitForPuppeteerPage(timeoutMs: number = 15000): Promise<any> {
    const start = Date.now();
    // wwebjs sets `client.pupPage` after initialize() navigates
    while (!(this.client as any).pupPage) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for Puppeteer page (client.pupPage).');
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return (this.client as any).pupPage;
  }

  /**
   * INTERNAL: Expose window.onCodeReceivedEvent if the library didn't.
   * This mirrors the injection used when `pairWithPhoneNumber` is set.
   */
  private async ensureOnCodeHook(): Promise<void> {
    try {
      console.log('🔧 Ensuring onCodeReceivedEvent hook is available...');
      const page = await this.waitForPuppeteerPage();

      // Wait a bit for the page to be fully loaded
      await this.delay(1000);

      const exists = await page.evaluate(() => typeof (globalThis as any).onCodeReceivedEvent === 'function');
      if (!exists) {
        const client = this.client; // capture
        await page.exposeFunction('onCodeReceivedEvent', async (code: string) => {
          try {
            client.emit('code', code);
          } catch (e) {
            // no-op
          }
          return code;
        });
        console.log('🪝 Injected window.onCodeReceivedEvent (workaround).');
      } else {
        console.log('✅ onCodeReceivedEvent already present.');
      }
    } catch (error) {
      console.error(
        '⚠️ Failed to ensure onCodeReceivedEvent hook:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Don't throw here, as the library might still work without our custom hook
    }
  }

  /**
   * INTERNAL: Add a delay for better stability
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * INTERNAL: Check for existing sessions and clean up if needed
   */
  private async checkAndCleanupExistingSessions(): Promise<void> {
    try {
      console.log('🔍 Checking for existing WhatsApp Web sessions...');

      // Check if there's already a pupPage instance
      if ((this.client as any).pupPage) {
        console.log('⚠️ Found existing page instance, cleaning up...');
        try {
          await (this.client as any).pupPage.close();
        } catch (e) {
          console.log('Page cleanup completed (may have been already closed)');
        }
        (this.client as any).pupPage = null;
      }

      // Check if client is already initialized
      if ((this.client as any).pupBrowser) {
        console.log('⚠️ Found existing browser instance, attempting cleanup...');
        try {
          await this.client.destroy();
          console.log('✅ Existing browser instance cleaned up');
        } catch (e) {
          console.log('Browser cleanup completed (may have been already destroyed)');
        }
      }

      console.log('✅ Session cleanup completed');
    } catch (error) {
      console.log(
        '⚠️ Session cleanup encountered issues (this is usually fine):',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Request a pairing code for the given phone number
   * @param phoneNumber - The phone number in international format (e.g., +1234567890)
   * @param showNotification - Whether to show notification on phone (default: true)
   * @param intervalMs - Interval for code regeneration (default: 180000ms)
   */
  async requestPairingCode(
    phoneNumber: string,
    showNotification: boolean = true,
    intervalMs: number = 180000,
  ): Promise<string> {
    try {
      console.log(`📞 Requesting pairing code for: ${phoneNumber}`);

      // Format phone number to digits-only E.164-ish (no '+')
      const formattedNumber = this.formatPhoneNumber(phoneNumber);

      // Check for existing sessions and clean up if needed
      await this.checkAndCleanupExistingSessions();

      // Initialize the client first (navigates to WhatsApp Web)
      console.log('🚀 Initializing WhatsApp client...');
      await this.client.initialize();

      // Wait for the page to stabilize after initialization
      console.log('⏳ Waiting for page to stabilize...');
      await this.delay(3000);

      // Ensure the page has onCodeReceivedEvent defined before requesting a code.
      await this.ensureOnCodeHook();

      // Additional delay before requesting pairing code
      await this.delay(2000);

      // Request the pairing code (pass your flags through)
      console.log('📱 Requesting pairing code from WhatsApp...');
      const code = await this.client.requestPairingCode(formattedNumber, showNotification, intervalMs);

      console.log(`✅ Pairing code requested successfully: ${code}`);
      return code;
    } catch (error) {
      console.error('❌ Failed to request pairing code:', error);

      // If it's an execution context error, try to recover
      if (error instanceof Error && error.message.includes('Execution context was destroyed')) {
        console.log('🔄 Execution context destroyed, attempting recovery...');
        await this.delay(5000);
        throw new Error('Execution context was destroyed. Please try again in a few moments.');
      }

      throw error;
    }
  }

  /**
   * Wait for the client to be ready (user has entered the pairing code)
   * @param timeoutMs - Timeout in milliseconds (default: 300000ms = 5 minutes)
   */
  async waitForReady(timeoutMs: number = 300000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WhatsApp client initialization timeout. Please try again.'));
      }, timeoutMs);

      const checkReady = () => {
        if (this.isReady) {
          clearTimeout(timeout);
          console.log('🎉 WhatsApp client is ready and authenticated!');
          resolve();
        } else {
          setTimeout(checkReady, 1000);
        }
      };

      checkReady();
    });
  }

  /**
   * Get the current pairing code if available
   */
  getPairingCode(): string | null {
    return this.pairingCode;
  }

  /**
   * Check if the client is ready
   */
  isClientReady(): boolean {
    return this.isReady;
  }

  /**
   * Get client info when ready
   */
  async getClientInfo() {
    if (!this.isReady) {
      throw new Error('Client is not ready yet');
    }

    const info = this.client.info;
    return {
      pushname: info.pushname,
      wid: info.wid,
      platform: info.platform,
    };
  }

  /**
   * Disconnect the client
   */
  async disconnect(): Promise<void> {
    console.log('📴 Disconnecting WhatsApp client...');
    await this.client.destroy();
    this.isReady = false;
  }

  /**
   * Format phone number to international symbol-free format
   * @param phoneNumber - Raw phone number
   * @returns Formatted phone number in international format without symbols (e.g., 12025550108 for US, 551155501234 for Brazil)
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let cleanNumber = phoneNumber.replace(/\D/g, '');

    // Handle empty string - return as is
    if (cleanNumber.length === 0) {
      return cleanNumber;
    }

    // If it doesn't start with a country code, determine the appropriate one
    if (cleanNumber.length === 10) {
      // 10 digits - assume US/Canada and add country code 1
      cleanNumber = '1' + cleanNumber;
    } else if (cleanNumber.length === 11 && cleanNumber.startsWith('1')) {
      // already has US/Canada country code
    } else if (cleanNumber.length < 10) {
      // Too short - default to US (+1)
      cleanNumber = '1' + cleanNumber;
    }
    // For other lengths, assume it already has the correct country code

    console.log(`📱 Formatted phone number: ${cleanNumber}`);
    return cleanNumber;
  }

  /**
   * Analyze WhatsApp data using the current client
   * @param phoneNumber - Phone number to analyze
   * @returns Promise with analysis result
   */
  async analyzeWhatsAppData(phoneNumber: string): Promise<WhatsAppAnalysis> {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    console.log('🔍 Starting comprehensive WhatsApp data analysis...');

    console.log('📊 Step 1: Getting profile info...');
    const profileInfo = await this.getProfileInfo();
    console.log('✅ Profile info completed');

    console.log('📊 Step 2: Getting contacts...');
    const contacts = await this.getContacts();
    console.log('✅ Contacts completed');

    console.log('📊 Step 3: Getting chats...');
    const chats = await this.getChats();
    console.log('✅ Chats completed');

    console.log('📊 Step 4: Getting message history...');
    const messageHistory = await this.getMessageHistory();
    console.log('✅ Message history completed');

    console.log('📊 Step 5: Getting groups...');
    const groups = await this.getGroups();
    console.log('✅ Groups completed');

    const analysis: WhatsAppAnalysis = {
      phoneNumber,
      timestamp: new Date().toISOString(),
      profileInfo,
      contacts,
      chats,
      messageHistory,
      groups,
      statistics: {
        totalMessages: 0,
        totalChats: 0,
        totalGroups: 0,
        totalContacts: 0,
        messagesByType: {},
        mostActiveChats: [],
        mostActiveContacts: [],
      },
    };

    console.log('📊 Step 6: Calculating statistics...');
    analysis.statistics = this.calculateStatistics(analysis);
    console.log('✅ Statistics completed');

    return analysis;
  }

  private async getProfileInfo() {
    console.log('Getting profile information...');
    try {
      const info = this.client.info;
      return {
        name: info.pushname || '',
        about: info.wid?.user || '',
        profilePicUrl: (await this.client.getProfilePicUrl(info.wid._serialized)) || '',
        isBusiness: false, // Not available in current API
        isEnterprise: false, // Not available in current API
      };
    } catch (error) {
      console.error('Error getting profile info:', error);
      return {
        name: '',
        about: '',
        profilePicUrl: '',
        isBusiness: false,
        isEnterprise: false,
      };
    }
  }

  private async getContacts() {
    console.log('Getting contacts...');
    try {
      const contacts = await this.client.getContacts();
      console.log(`Found ${contacts.length} contacts, processing...`);

      // Process contacts in batches to avoid overwhelming the API
      const batchSize = 10;
      const results = [];

      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize);
        console.log(
          `Processing contacts batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(contacts.length / batchSize)}`,
        );

        const batchResults = await Promise.all(
          batch.map(async (contact) => {
            try {
              // Skip profile pic for now to speed up the process
              return {
                id: contact.id._serialized,
                name: contact.name || contact.pushname || '',
                number: contact.number || '',
                isGroup: contact.isGroup,
                isBlocked: contact.isBlocked,
                isMyContact: contact.isMyContact,
                about: '', // Not available in current API
                profilePicUrl: '', // Skip for now to avoid hanging
              };
            } catch (error) {
              console.error(`Error processing contact ${contact.id._serialized}:`, error);
              return {
                id: contact.id._serialized,
                name: contact.name || contact.pushname || '',
                number: contact.number || '',
                isGroup: contact.isGroup,
                isBlocked: contact.isBlocked,
                isMyContact: contact.isMyContact,
                about: '',
                profilePicUrl: '',
              };
            }
          }),
        );

        results.push(...batchResults);
      }

      console.log(`Successfully processed ${results.length} contacts`);
      return results;
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  }

  private async getChats() {
    console.log('Getting chats...');
    try {
      const chats = await this.client.getChats();
      const chatData = await Promise.all(
        chats.map(async (chat) => {
          const lastMessage = chat.lastMessage;
          return {
            id: chat.id._serialized,
            name: chat.name || '',
            isGroup: chat.isGroup,
            isMuted: chat.isMuted,
            isArchived: chat.archived,
            unreadCount: chat.unreadCount,
            lastMessage: lastMessage
              ? {
                  body: lastMessage.body || '',
                  timestamp: lastMessage.timestamp,
                  fromMe: lastMessage.fromMe,
                  type: lastMessage.type,
                }
              : null,
            participants: chat.isGroup ? (chat as GroupChat).participants.map((p) => p.id._serialized) : [],
          };
        }),
      );
      return chatData;
    } catch (error) {
      console.error('Error getting chats:', error);
      return [];
    }
  }

  private async getMessageHistory() {
    console.log('Getting message history...');
    try {
      const chats = await this.client.getChats();
      const messageHistory = [];

      for (const chat of chats.slice(0, 10)) {
        // Limit to first 10 chats for performance
        try {
          console.log(`Getting messages for chat: ${chat.name || chat.id._serialized}`);
          const messages = await chat.fetchMessages({ limit: 100 }); // Get last 100 messages per chat

          const messageData = messages.map((msg) => ({
            id: msg.id._serialized,
            body: msg.body || '',
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            type: msg.type,
            author: msg.author || '',
            hasMedia: msg.hasMedia,
            mediaType: msg.type,
          }));

          messageHistory.push({
            chatId: chat.id._serialized,
            chatName: chat.name || '',
            messageCount: messages.length,
            messages: messageData,
          });
        } catch (error) {
          console.error(`Error getting messages for chat ${chat.id._serialized}:`, error);
        }
      }

      return messageHistory;
    } catch (error) {
      console.error('Error getting message history:', error);
      return [];
    }
  }

  private async getGroups() {
    console.log('Getting groups...');
    try {
      const chats = await this.client.getChats();
      const groups = chats.filter((chat) => chat.isGroup) as GroupChat[];

      return groups.map((group) => ({
        id: group.id._serialized,
        name: group.name || '',
        description: group.description || '',
        participants: group.participants.map((p) => p.id._serialized),
        admins: group.participants.filter((p) => p.isAdmin).map((p) => p.id._serialized),
        owner: group.owner ? group.owner._serialized : '',
        createdAt: group.createdAt ? group.createdAt.getTime() : 0,
        isReadOnly: group.isReadOnly,
      }));
    } catch (error) {
      console.error('Error getting groups:', error);
      return [];
    }
  }

  private calculateStatistics(analysis: WhatsAppAnalysis) {
    console.log('Calculating statistics...');

    const stats = {
      totalMessages: 0,
      totalChats: analysis.chats.length,
      totalGroups: analysis.groups.length,
      totalContacts: analysis.contacts.length,
      messagesByType: {} as Record<string, number>,
      mostActiveChats: [] as Array<{ chatId: string; name: string; messageCount: number }>,
      mostActiveContacts: [] as Array<{ contactId: string; name: string; messageCount: number }>,
    };

    // Count messages by type and total
    analysis.messageHistory.forEach((chat) => {
      stats.totalMessages += chat.messageCount;
      chat.messages.forEach((msg) => {
        stats.messagesByType[msg.type] = (stats.messagesByType[msg.type] || 0) + 1;
      });
    });

    // Find most active chats
    stats.mostActiveChats = analysis.messageHistory
      .map((chat) => ({
        chatId: chat.chatId,
        name: chat.chatName,
        messageCount: chat.messageCount,
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);

    // Find most active contacts (simplified - would need more complex analysis)
    const contactMessageCounts: Record<string, number> = {};
    analysis.messageHistory.forEach((chat) => {
      if (!chat.chatName.includes('group')) {
        // Skip groups for contact analysis
        contactMessageCounts[chat.chatId] = chat.messageCount;
      }
    });

    stats.mostActiveContacts = Object.entries(contactMessageCounts)
      .map(([contactId, messageCount]) => {
        const contact = analysis.contacts.find((c) => c.id === contactId);
        return {
          contactId,
          name: contact?.name || 'Unknown',
          messageCount,
        };
      })
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);

    return stats;
  }

  async saveAnalysisToFile(analysis: WhatsAppAnalysis): Promise<void> {
    try {
      const filename = `whatsapp-analysis-${analysis.phoneNumber}-${Date.now()}.json`;
      const filepath = path.join(__dirname, '..', 'data', filename);

      // Create data directory if it doesn't exist
      const dataDir = path.dirname(filepath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Save as JSON
      fs.writeFileSync(filepath, JSON.stringify(analysis, null, 2));
      console.log(`Analysis saved to: ${filepath}`);

      // Also save a human-readable version
      const textFilename = `whatsapp-analysis-${analysis.phoneNumber}-${Date.now()}.txt`;
      const textFilepath = path.join(__dirname, '..', 'data', textFilename);

      const textData = this.formatAnalysisAsText(analysis);
      fs.writeFileSync(textFilepath, textData);
      console.log(`Human-readable analysis saved to: ${textFilepath}`);
    } catch (error) {
      console.error('Error saving analysis to file:', error);
    }
  }

  private formatAnalysisAsText(analysis: WhatsAppAnalysis): string {
    return `
WhatsApp Comprehensive Analysis Report
=====================================
Phone Number: ${analysis.phoneNumber}
Analysis Date: ${analysis.timestamp}

PROFILE INFORMATION
-------------------
Name: ${analysis.profileInfo.name}
About: ${analysis.profileInfo.about}
Business Account: ${analysis.profileInfo.isBusiness ? 'Yes' : 'No'}
Enterprise Account: ${analysis.profileInfo.isEnterprise ? 'Yes' : 'No'}

STATISTICS
----------
Total Messages: ${analysis.statistics.totalMessages}
Total Chats: ${analysis.statistics.totalChats}
Total Groups: ${analysis.statistics.totalGroups}
Total Contacts: ${analysis.statistics.totalContacts}

Messages by Type:
${Object.entries(analysis.statistics.messagesByType)
  .map(([type, count]) => `  ${type}: ${count}`)
  .join('\n')}

Most Active Chats:
${analysis.statistics.mostActiveChats
  .map((chat, index) => `${index + 1}. ${chat.name} - ${chat.messageCount} messages`)
  .join('\n')}

Most Active Contacts:
${analysis.statistics.mostActiveContacts
  .map((contact, index) => `${index + 1}. ${contact.name} - ${contact.messageCount} messages`)
  .join('\n')}

CONTACTS (${analysis.contacts.length})
---------
${analysis.contacts
  .slice(0, 20)
  .map(
    (contact, index) =>
      `${index + 1}. ${contact.name} (${contact.number}) - ${contact.isBlocked ? 'Blocked' : 'Active'}`,
  )
  .join('\n')}
${analysis.contacts.length > 20 ? `... and ${analysis.contacts.length - 20} more contacts` : ''}

GROUPS (${analysis.groups.length})
--------
${analysis.groups
  .map((group, index) => `${index + 1}. ${group.name} - ${group.participants.length} participants`)
  .join('\n')}

MESSAGE HISTORY SAMPLE
---------------------
${analysis.messageHistory
  .slice(0, 5)
  .map(
    (chat) =>
      `Chat: ${chat.chatName} (${chat.messageCount} messages)
${chat.messages
  .slice(0, 3)
  .map(
    (msg) =>
      `  [${new Date(msg.timestamp * 1000).toLocaleString()}] ${msg.fromMe ? 'You' : msg.author}: ${msg.body.substring(
        0,
        100,
      )}${msg.body.length > 100 ? '...' : ''}`,
  )
  .join('\n')}
`,
  )
  .join('\n')}

Raw JSON data is available in the corresponding .json file.
    `.trim();
  }
}

/**
 * Run WhatsApp data analysis using a linker instance
 * @param phoneNumber - Phone number to analyze
 * @param linker - The SimpleWhatsAppLinker instance to use
 * @returns Promise with analysis result
 */
export async function runWhatsAppAnalysis(
  phoneNumber: string,
  linker: SimpleWhatsAppLinker,
): Promise<{ analysisData?: any; error?: string }> {
  console.log('🔍 Starting WhatsApp data analysis...');

  try {
    // Analyze WhatsApp data using the linker's internal methods
    const analysisData = await linker.analyzeWhatsAppData(phoneNumber);

    // Save analysis to file
    await linker.saveAnalysisToFile(analysisData);

    // Transform to LLM-friendly schema and save JSON
    const llmData = transformToLLMSchema(analysisData);
    const llmPath = await saveLLMJson(phoneNumber, llmData);

    console.log('✅ WhatsApp analysis completed and saved!');

    return {
      analysisData: { ...analysisData, __llm: { path: llmPath } },
    };
  } catch (analysisError) {
    console.error('⚠️ Analysis failed:', analysisError);

    return {
      error: `Analysis failed: ${analysisError instanceof Error ? analysisError.message : 'Unknown analysis error'}`,
    };
  }
}

/**
 * Simple function to link WhatsApp with a phone number
 * @param phoneNumber - Phone number to link
 * @returns Promise with linking result
 */
export async function linkWhatsApp(phoneNumber: string): Promise<LinkingResult> {
  const linker = new SimpleWhatsAppLinker();

  try {
    console.log(`🚀 Starting WhatsApp linking for: ${phoneNumber}`);

    // Request pairing code
    const pairingCode = await linker.requestPairingCode(phoneNumber);

    console.log(`📱 Pairing code: ${pairingCode}`);
    console.log('⏳ Please enter this code on your phone to complete the linking process...');

    // Wait for user to enter the code and client to be ready
    await linker.waitForReady();

    // Get client info to confirm linking
    const clientInfo = await linker.getClientInfo();
    console.log('✅ WhatsApp linked successfully!');
    console.log('📊 Client info:', clientInfo);

    // Run WhatsApp analysis using the linker instance
    const analysisResult = await runWhatsAppAnalysis(phoneNumber, linker);
    let llmData: LLMWhatsAppData | undefined;
    let llmDataPath: string | undefined;
    try {
      if (analysisResult.analysisData) {
        const llm = transformToLLMSchema(analysisResult.analysisData);
        llmDataPath = await saveLLMJson(phoneNumber, llm);
        llmData = llm;
      }
    } catch (e) {
      console.error('LLM transform save failed (non-fatal):', e);
    }

    return {
      success: true,
      pairingCode: pairingCode,
      analysisData: analysisResult.analysisData,
      llmDataPath,
      llmData,
      error: analysisResult.error,
    };
  } catch (error) {
    console.error('❌ Failed to link WhatsApp:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  } finally {
    // Keep the client connected for further use
    // await linker.disconnect();
  }
}
