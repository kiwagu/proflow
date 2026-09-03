/**
 * Who made an edit.
 *
 * Travels with every committed change so that "the assistant wrote this
 * paragraph" stays answerable later. Recorded per commit rather than derived
 * from a session, because a document outlives the session that produced it.
 */
export interface EditAuthor {
  user: string;
  src: 'human' | 'ai';
  model?: string;
}
