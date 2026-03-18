import type {Role} from './ai';

export type ConversationMessage = {
  role: Role;
  content: string;
  author: string;
  authorID: string;
  messageID: string;
  threadID?: string;
  parent?: string;
  startOfThread: boolean;
};

export class ConversationManager {
  messages = new Map<string, ConversationMessage>();
  attachedThreads = new Map<string, string>();

  addMessage(msg: ConversationMessage) {
    this.messages.set(msg.messageID, msg);
  }

  attachThread(threadId: string, rootMessageId: string) {
    this.attachedThreads.set(threadId, rootMessageId);
  }

  isThreadAttached(threadId: string) {
    return this.attachedThreads.has(threadId);
  }

  getThreadRoot(threadId: string) {
    return this.attachedThreads.get(threadId);
  }

  getThreadMessages(threadId: string) {
    const messages: ConversationMessage[] = [];
    for (const msg of this.messages.values()) {
      if (msg.threadID === threadId) {
        messages.push(msg);
      }
    }
    return messages.sort((a, b) =>
      Number(BigInt(a.messageID) - BigInt(b.messageID))
    );
  }

  getConversation(leaf: string) {
    const messages: ConversationMessage[] = [];

    let parentID: string | undefined = leaf;
    while (parentID && this.messages.has(parentID)) {
      const msg: ConversationMessage = this.messages.get(parentID)!;
      messages.push(msg);
      parentID = msg.parent;
    }

    return messages.toReversed();
  }

  // TODO
  deleteMessage(id: string) {
    this.messages.delete(id);
    this.cleanupOrphans();
  }

  // TODO
  cleanupOrphans() {}
}
