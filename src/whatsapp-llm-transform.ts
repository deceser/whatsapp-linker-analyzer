import * as fs from 'fs';
import * as path from 'path';
import { WhatsAppAnalysis } from './wa-linker';

export interface LLMWhatsAppData {
  meta: { phoneNumber: string; generatedAt: string };
  user: { name: string };
  contacts: Array<{ id: string; name: string; phone?: string; isProfessional: boolean; strength: number }>;
  groups: Array<{ id: string; name: string; participants: string[]; memberCount: number }>;
  conversations: Array<{
    id: string;
    name: string;
    isGroup: boolean;
    participants: string[];
    messageCount: number;
    lastMessageAt?: number;
  }>;
  network: {
    nodes: Array<{ id: string; label: string; type: 'me' | 'person' | 'group' }>;
    edges: Array<{ from: string; to: string; weight: number; kind: 'direct' | 'membership' | 'group_activity' }>;
  };
  insights: {
    topContacts: Array<{ id: string; name: string; messages: number }>;
    topGroups: Array<{ id: string; name: string; messages: number }>;
    messageTypeDistribution: Record<string, number>;
  };
}

const PROF_KEYWORDS = [
  'llc',
  'inc',
  'co.',
  'company',
  'corp',
  'ceo',
  'cto',
  'cfo',
  'hr',
  'recruit',
  'sales',
  'manager',
  'team',
  'project',
  'pm',
  'dev',
  'engineer',
  'design',
  'invoice',
  'contract',
  'legal',
  'account',
  'marketing',
  'ops',
];

function isProfessionalName(name: string): boolean {
  const n = (name || '').toLowerCase();
  return PROF_KEYWORDS.some((k) => n.includes(k));
}

export function transformToLLMSchema(analysis: WhatsAppAnalysis): LLMWhatsAppData {
  const contactsById = new Map(analysis.contacts.map((c) => [c.id, c]));
  const chatsById = new Map(analysis.chats.map((c) => [c.id, c]));
  const contactMsgCount: Record<string, number> = {};
  const chatMsgCount: Record<string, number> = {};
  const lastMsgAt: Record<string, number> = {};

  for (const chat of analysis.messageHistory) {
    const chatMeta = chatsById.get(chat.chatId);
    chatMsgCount[chat.chatId] = (chatMsgCount[chat.chatId] || 0) + chat.messageCount;
    const last = chat.messages[0]?.timestamp || chat.messages[chat.messages.length - 1]?.timestamp;
    if (last) lastMsgAt[chat.chatId] = Math.max(lastMsgAt[chat.chatId] || 0, last);

    if (chatMeta && !chatMeta.isGroup) {
      contactMsgCount[chat.chatId] = (contactMsgCount[chat.chatId] || 0) + chat.messageCount;
    } else {
      for (const m of chat.messages) {
        const author = m.fromMe ? 'me' : m.author;
        if (author && author !== 'me') contactMsgCount[author] = (contactMsgCount[author] || 0) + 1;
      }
    }
  }

  const contacts = analysis.contacts.map((c) => ({
    id: c.id,
    name: c.name || c.number || c.id,
    phone: c.number || undefined,
    isProfessional: isProfessionalName(c.name || '') || isProfessionalName(c.number || ''),
    strength: contactMsgCount[c.id] || 0,
  }));

  const groups = analysis.chats
    .filter((c) => c.isGroup)
    .map((g) => ({
      id: g.id,
      name: g.name,
      participants: g.participants,
      memberCount: g.participants.length,
    }));

  const conversations = analysis.chats.map((c) => ({
    id: c.id,
    name: c.name,
    isGroup: c.isGroup,
    participants: c.participants,
    messageCount: chatMsgCount[c.id] || 0,
    lastMessageAt: lastMsgAt[c.id],
  }));

  const nodes: Array<{ id: string; label: string; type: 'me' | 'person' | 'group' }> = [
    { id: 'me', label: analysis.profileInfo.name || 'Me', type: 'me' },
    ...contacts.map((c) => ({ id: c.id, label: c.name, type: 'person' as const })),
    ...groups.map((g) => ({ id: g.id, label: g.name, type: 'group' as const })),
  ];

  const edges: Array<{ from: string; to: string; weight: number; kind: 'direct' | 'membership' | 'group_activity' }> =
    [];
  for (const c of contacts) edges.push({ from: 'me', to: c.id, weight: c.strength, kind: 'direct' });
  for (const g of groups) {
    edges.push({ from: 'me', to: g.id, weight: chatMsgCount[g.id] || 0, kind: 'group_activity' });
    for (const pid of g.participants) edges.push({ from: g.id, to: pid, weight: 1, kind: 'membership' });
  }

  const topContacts = [...contacts]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10)
    .map((c) => ({ id: c.id, name: c.name, messages: c.strength }));

  const topGroups = [...groups]
    .sort((a, b) => (chatMsgCount[b.id] || 0) - (chatMsgCount[a.id] || 0))
    .slice(0, 10)
    .map((g) => ({ id: g.id, name: g.name, messages: chatMsgCount[g.id] || 0 }));

  return {
    meta: { phoneNumber: analysis.phoneNumber, generatedAt: new Date().toISOString() },
    user: { name: analysis.profileInfo.name },
    contacts,
    groups,
    conversations,
    network: { nodes, edges },
    insights: { topContacts, topGroups, messageTypeDistribution: analysis.statistics.messagesByType },
  };
}

export async function saveLLMJson(phoneNumber: string, data: LLMWhatsAppData): Promise<string> {
  const filename = `whatsapp-llm-${phoneNumber}-${Date.now()}.json`;
  const filepath = path.join(__dirname, '..', 'data', filename);
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filepath;
}
