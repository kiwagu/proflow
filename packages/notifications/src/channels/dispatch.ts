import type { NotificationRequest } from '../types.js';

import {
  getNotificationChannelDispatcher,
  type NotificationTransports,
} from './handlers.js';

export async function sendNotification(
  request: NotificationRequest,
  transports: NotificationTransports
): Promise<void> {
  const dispatcher = getNotificationChannelDispatcher(request.channel);
  await dispatcher.dispatch(request, transports);
}
