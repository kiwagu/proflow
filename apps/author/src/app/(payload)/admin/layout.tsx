import type { ReactNode } from 'react';

import { AdminClientMount } from './admin.client';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminClientMount>{children}</AdminClientMount>;
}
