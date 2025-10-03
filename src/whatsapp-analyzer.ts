import { Client, LocalAuth, Message, Contact, Chat, GroupChat, PrivateChat } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';

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

export class WhatsAppAnalyzer {
  private client: Client;
  private isReady: boolean = false;
  private analysisData: WhatsAppAnalysis | null = null;

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: "whatsapp-analyzer"
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('QR Code received. Please scan with your WhatsApp app.');
      // In a real app, you'd display this QR code to the user
    });

    this.client.on('ready', () => {
      console.log('WhatsApp client is ready!');
      this.isReady = true;
    });

    this.client.on('authenticated', () => {
      console.log('WhatsApp client authenticated!');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('Authentication failed:', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp client disconnected:', reason);
      this.isReady = false;
    });

    // Listen for new messages in real-time
    this.client.on('message', async (message) => {
      console.log('New message received:', message.body);
      // You can process new messages here
      await this.processNewMessage(message);
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing WhatsApp client...');
      await this.client.initialize();
      
      // Wait for the client to be ready
      await this.waitForReady();
    } catch (error) {
      console.error('Failed to initialize WhatsApp client:', error);
      throw error;
    }
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WhatsApp client initialization timeout'));
      }, 60000); // 60 second timeout

      const checkReady = () => {
        if (this.isReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 1000);
        }
      };

      checkReady();
    });
  }

  async analyzeWhatsAppData(phoneNumber: string): Promise<WhatsAppAnalysis> {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    console.log('Starting comprehensive WhatsApp data analysis...');
    
    const analysis: WhatsAppAnalysis = {
      phoneNumber,
      timestamp: new Date().toISOString(),
      profileInfo: await this.getProfileInfo(),
      contacts: await this.getContacts(),
      chats: await this.getChats(),
      messageHistory: await this.getMessageHistory(),
      groups: await this.getGroups(),
      statistics: {
        totalMessages: 0,
        totalChats: 0,
        totalGroups: 0,
        totalContacts: 0,
        messagesByType: {},
        mostActiveChats: [],
        mostActiveContacts: []
      }
    };

    // Calculate statistics
    analysis.statistics = this.calculateStatistics(analysis);
    
    this.analysisData = analysis;
    return analysis;
  }

  private async getProfileInfo() {
    console.log('Getting profile information...');
    try {
      const info = this.client.info;
      return {
        name: info.pushname || '',
        about: info.wid?.user || '',
        profilePicUrl: await this.client.getProfilePicUrl(info.wid._serialized) || '',
        isBusiness: false, // Not available in current API
        isEnterprise: false // Not available in current API
      };
    } catch (error) {
      console.error('Error getting profile info:', error);
      return {
        name: '',
        about: '',
        profilePicUrl: '',
        isBusiness: false,
        isEnterprise: false
      };
    }
  }

  private async getContacts() {
    console.log('Getting contacts...');
    try {
      const contacts = await this.client.getContacts();
      return await Promise.all(contacts.map(async contact => ({
        id: contact.id._serialized,
        name: contact.name || contact.pushname || '',
        number: contact.number || '',
        isGroup: contact.isGroup,
        isBlocked: contact.isBlocked,
        isMyContact: contact.isMyContact,
        about: '', // Not available in current API
        profilePicUrl: await contact.getProfilePicUrl() || ''
      })));
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  }

  private async getChats() {
    console.log('Getting chats...');
    try {
      const chats = await this.client.getChats();
      const chatData = await Promise.all(chats.map(async (chat) => {
        const lastMessage = chat.lastMessage;
        return {
          id: chat.id._serialized,
          name: chat.name || '',
          isGroup: chat.isGroup,
          isMuted: chat.isMuted,
          isArchived: chat.archived,
          unreadCount: chat.unreadCount,
          lastMessage: lastMessage ? {
            body: lastMessage.body || '',
            timestamp: lastMessage.timestamp,
            fromMe: lastMessage.fromMe,
            type: lastMessage.type
          } : null,
          participants: chat.isGroup ? (chat as GroupChat).participants.map(p => p.id._serialized) : []
        };
      }));
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

      for (const chat of chats.slice(0, 10)) { // Limit to first 10 chats for performance
        try {
          console.log(`Getting messages for chat: ${chat.name || chat.id._serialized}`);
          const messages = await chat.fetchMessages({ limit: 100 }); // Get last 100 messages per chat
          
          const messageData = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body || '',
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            type: msg.type,
            author: msg.author || '',
            hasMedia: msg.hasMedia,
            mediaType: msg.type
          }));

          messageHistory.push({
            chatId: chat.id._serialized,
            chatName: chat.name || '',
            messageCount: messages.length,
            messages: messageData
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
      const groups = chats.filter(chat => chat.isGroup) as GroupChat[];
      
      return groups.map(group => ({
        id: group.id._serialized,
        name: group.name || '',
        description: group.description || '',
        participants: group.participants.map(p => p.id._serialized),
        admins: group.participants.filter(p => p.isAdmin).map(p => p.id._serialized),
        owner: group.owner ? group.owner._serialized : '',
        createdAt: group.createdAt ? group.createdAt.getTime() : 0,
        isReadOnly: group.isReadOnly
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
      mostActiveContacts: [] as Array<{ contactId: string; name: string; messageCount: number }>
    };

    // Count messages by type and total
    analysis.messageHistory.forEach(chat => {
      stats.totalMessages += chat.messageCount;
      chat.messages.forEach(msg => {
        stats.messagesByType[msg.type] = (stats.messagesByType[msg.type] || 0) + 1;
      });
    });

    // Find most active chats
    stats.mostActiveChats = analysis.messageHistory
      .map(chat => ({
        chatId: chat.chatId,
        name: chat.chatName,
        messageCount: chat.messageCount
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);

    // Find most active contacts (simplified - would need more complex analysis)
    const contactMessageCounts: Record<string, number> = {};
    analysis.messageHistory.forEach(chat => {
      if (!chat.chatName.includes('group')) { // Skip groups for contact analysis
        contactMessageCounts[chat.chatId] = chat.messageCount;
      }
    });

    stats.mostActiveContacts = Object.entries(contactMessageCounts)
      .map(([contactId, messageCount]) => {
        const contact = analysis.contacts.find(c => c.id === contactId);
        return {
          contactId,
          name: contact?.name || 'Unknown',
          messageCount
        };
      })
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);

    return stats;
  }

  private async processNewMessage(message: Message) {
    console.log(`Processing new message from ${message.from}: ${message.body}`);
    // You can add real-time message processing logic here
    // For example, save to database, trigger notifications, etc.
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
${analysis.contacts.slice(0, 20).map((contact, index) => 
  `${index + 1}. ${contact.name} (${contact.number}) - ${contact.isBlocked ? 'Blocked' : 'Active'}`
).join('\n')}
${analysis.contacts.length > 20 ? `... and ${analysis.contacts.length - 20} more contacts` : ''}

GROUPS (${analysis.groups.length})
--------
${analysis.groups.map((group, index) => 
  `${index + 1}. ${group.name} - ${group.participants.length} participants`
).join('\n')}

MESSAGE HISTORY SAMPLE
---------------------
${analysis.messageHistory.slice(0, 5).map(chat => 
  `Chat: ${chat.chatName} (${chat.messageCount} messages)
${chat.messages.slice(0, 3).map(msg => 
  `  [${new Date(msg.timestamp * 1000).toLocaleString()}] ${msg.fromMe ? 'You' : msg.author}: ${msg.body.substring(0, 100)}${msg.body.length > 100 ? '...' : ''}`
).join('\n')}
`).join('\n')}

Raw JSON data is available in the corresponding .json file.
    `.trim();
  }

  async startRealTimeListening() {
    console.log('Starting real-time message listening...');
    // The event handlers are already set up in the constructor
    // This method can be used to add additional real-time processing
  }

  async disconnect() {
    console.log('Disconnecting WhatsApp client...');
    await this.client.destroy();
  }
}
