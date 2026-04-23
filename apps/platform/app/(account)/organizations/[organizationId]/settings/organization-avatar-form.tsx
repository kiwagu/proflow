'use client';

import { EntityAvatarForm } from '@/components/entity-avatar-form';

import {
  updateOrganizationAvatarAction,
  type UpdateOrganizationAvatarResult,
} from './organization-avatar.actions';

type OrganizationAvatarFormProps = {
  organizationId: string;
  currentValue: string | null;
  submitLabel: string;
  successMessage: string;
};

export function OrganizationAvatarForm({
  organizationId,
  currentValue,
  submitLabel,
  successMessage,
}: OrganizationAvatarFormProps) {
  return (
    <EntityAvatarForm
      currentValue={currentValue}
      entityId={organizationId}
      scopePrefix="organizations"
      submitLabel={submitLabel}
      successMessage={successMessage}
      testId="organization-avatar"
      onSubmit={(avatarUrl): Promise<UpdateOrganizationAvatarResult> =>
        updateOrganizationAvatarAction({
          organizationId,
          avatar_url: avatarUrl,
        })
      }
    />
  );
}
