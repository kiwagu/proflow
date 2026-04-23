/**
 * Keep in sync with `GoTrueSendEmailHookPayload` in `@workspace/notifications`.
 */
export type GoTrueSendEmailHookPayload = {
  user: {
    id: string;
    email?: string;
    phone?: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};
