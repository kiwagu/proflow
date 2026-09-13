import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';

/**
 * The chat surface's copy, resolved once by the host.
 *
 * The panel takes strings rather than a translator so it renders the same in
 * the app and in a spec, and so the catalog stays the one authority for the
 * text — the same shape the file explorer and the command palette already
 * use.
 */
export interface ChatPanelLabels {
  /** The panel's own heading. */
  title: string;
  /** Accessible name of the panel region and of the control that toggles it. */
  ariaLabel: string;
  /** The composer's placeholder. */
  placeholder: string;
  send: string;
  stop: string;
  /** Header of the collapsed reasoning block. */
  thinking: string;
  /** Shown instead of a transcript before the first message. */
  empty: string;
  /** Author labels on a turn. */
  you: string;
  assistant: string;
  /** While the session is still opening and the composer is disabled. */
  opening: string;
}

export const defaultChatPanelLabels: ChatPanelLabels = {
  title: 'Assistant',
  ariaLabel: 'Assistant',
  placeholder: 'Ask about your documents…',
  send: 'Send',
  stop: 'Stop',
  thinking: 'Thinking…',
  empty: 'No messages yet. Ask about your documents to start.',
  you: 'You',
  assistant: 'Assistant',
  opening: 'Opening the assistant…',
};

export function buildChatPanelLabels(t: WorkbenchTranslator): ChatPanelLabels {
  return {
    title: t('workbench.chat.title'),
    ariaLabel: t('workbench.chat.ariaLabel'),
    placeholder: t('workbench.chat.placeholder'),
    send: t('workbench.chat.send'),
    stop: t('workbench.chat.stop'),
    thinking: t('workbench.chat.thinking'),
    empty: t('workbench.chat.empty'),
    you: t('workbench.chat.you'),
    assistant: t('workbench.chat.assistant'),
    opening: t('workbench.chat.opening'),
  };
}
