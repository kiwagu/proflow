export const PLATFORM_NOTIFY_STREAM_NAME = 'PLATFORM_NOTIFY' as const;

export const PLATFORM_NOTIFY_SUBJECT_PREFIX = 'platform.notify.v1' as const;

/** JetStream subject for space invite outbound email jobs. */
export const SPACE_INVITE_EMAIL_JETSTREAM_SUBJECT =
  `${PLATFORM_NOTIFY_SUBJECT_PREFIX}.space_invite_email` as const;
