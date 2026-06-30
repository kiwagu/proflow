'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SettingsMutationFormShell } from '@workspace/ui/components/platform/settings-mutation-form';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { EntityAvatarUpload } from '@/components/entity-avatar-upload';

type AvatarMutationResult = { ok: true } | { ok: false; message: string };

type EntityAvatarFormProps = {
  currentValue: string | null;
  entityId: string;
  scopePrefix: string;
  nestedPath?: string;
  submitLabel: string;
  successMessage: string;
  testId: string;
  onSubmit: (avatarUrl: string) => Promise<AvatarMutationResult>;
};

export function EntityAvatarForm({
  currentValue,
  entityId,
  scopePrefix,
  nestedPath,
  submitLabel,
  successMessage,
  testId,
  onSubmit,
}: EntityAvatarFormProps) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(currentValue ?? '');

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setAvatarUrl(currentValue ?? '');
  }

  return (
    <SettingsMutationFormShell
      onSubmit={() => onSubmit(avatarUrl)}
      onRefresh={router.refresh}
      submitLabel={submitLabel}
      successMessage={successMessage}
      testId={testId}
    >
      {({ isPending, clearStatus }) => (
        <EntityAvatarUpload
          value={avatarUrl || undefined}
          onChange={(value) => {
            setAvatarUrl(value);
            clearStatus();
          }}
          entityId={entityId}
          scopePrefix={scopePrefix}
          nestedPath={nestedPath}
          disabled={isPending}
        />
      )}
    </SettingsMutationFormShell>
  );
}
