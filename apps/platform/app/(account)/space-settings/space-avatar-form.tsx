'use client';

import { EntityAvatarForm } from '@/components/entity-avatar-form';

import {
  updateSpaceAvatarAction,
  type UpdateSpaceAvatarResult,
} from '@/app/(account)/space-settings/space-avatar.actions';

type SpaceAvatarFormProps = {
  spaceId: string;
  currentValue: string | null;
  submitLabel: string;
  successMessage: string;
};

export function SpaceAvatarForm({
  spaceId,
  currentValue,
  submitLabel,
  successMessage,
}: SpaceAvatarFormProps) {
  return (
    <EntityAvatarForm
      currentValue={currentValue}
      entityId={spaceId}
      scopePrefix="spaces"
      nestedPath="avatar"
      submitLabel={submitLabel}
      successMessage={successMessage}
      testId="space-avatar"
      onSubmit={(avatarUrl): Promise<UpdateSpaceAvatarResult> =>
        updateSpaceAvatarAction({
          spaceId,
          avatar_url: avatarUrl,
        })
      }
    />
  );
}
