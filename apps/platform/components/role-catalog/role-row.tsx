import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import {
  Collapsible,
  CollapsibleContent,
} from '@workspace/ui/components/collapsible';
import { ConfirmCheckboxField } from '@workspace/ui/components/confirm-checkbox-field';
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  CheckboxGroupField,
  toggleGroupKey,
} from '@workspace/ui/components/platform/checkbox-group-field';
import { RoleBadgeList } from '@workspace/ui/components/platform/role-badge-list';
import { Separator } from '@workspace/ui/components/separator';
import { Textarea } from '@workspace/ui/components/textarea';

import type { PlatformRoleCatalogRow } from '@/lib/platform-role-catalog.actions';

import type { RoleDraft, Translator } from './role-catalog.schema';

/**
 * Confirm-gate wiring for a destructive action (system variant). When present,
 * the archive control moves into the card body, a confirm checkbox precedes it,
 * and the action is gated behind that checkbox.
 */
export type RoleRowConfirmGate = Readonly<{
  inputId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>;

type RoleRowProps = Readonly<{
  role: PlatformRoleCatalogRow;
  t: Translator;
  permissionCatalogKeys: readonly string[];
  /** Resolved scope label shown after the role key (variant-specific). */
  scopeLabel: string;
  /** Prefix for edit-field ids, e.g. `edit` (org) or `edit-global` (system). */
  editIdPrefix: string;
  /** Prefix for the permission checkbox group within the edit form. */
  permissionFieldIdPrefix: string;
  busyArchive: boolean;
  busyEdit: boolean;
  isEditing: boolean;
  editingDraft: RoleDraft | null;
  onArchive: () => void;
  onBeginEdit: () => void;
  onEditingDraftChange: (
    update: (current: RoleDraft | null) => RoleDraft | null
  ) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  /** Optional `data-testid` on the card (org variant). */
  rowTestId?: string;
  /** Optional `data-testid` on the save button (org variant). */
  saveTestId?: string;
  /**
   * Optional confirm-gate for archiving (system variant). When omitted, the
   * archive button renders in the header gated only by `busyArchive`. When
   * provided, it renders in the body behind the confirm checkbox.
   */
  confirmArchive?: RoleRowConfirmGate;
  /** Optional confirm-gate for saving an edit (system variant). */
  confirmEdit?: RoleRowConfirmGate;
}>;

export function RoleRow({
  role,
  t,
  permissionCatalogKeys,
  scopeLabel,
  editIdPrefix,
  permissionFieldIdPrefix,
  busyArchive,
  busyEdit,
  isEditing,
  editingDraft,
  onArchive,
  onBeginEdit,
  onEditingDraftChange,
  onSave,
  onCancelEdit,
  rowTestId,
  saveTestId,
  confirmArchive,
  confirmEdit,
}: RoleRowProps) {
  const archiveInHeader = !confirmArchive;

  return (
    <Card size="sm" data-testid={rowTestId}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>{role.label}</CardTitle>
            <CardDescription>
              {role.key} · {scopeLabel}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {role.archivedAt ? (
              <Badge variant="outline">{t('roleCatalog.badge.archived')}</Badge>
            ) : (
              <Badge variant="secondary">{t('roleCatalog.badge.active')}</Badge>
            )}
            {!role.archivedAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onBeginEdit}
              >
                {t('roleCatalog.actions.edit')}
              </Button>
            ) : null}
            {archiveInHeader && !role.archivedAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyArchive}
                onClick={onArchive}
              >
                {t('roleCatalog.actions.archive')}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {role.description ? (
          <p className="text-muted-foreground text-sm">{role.description}</p>
        ) : null}
        <RoleBadgeList
          roles={role.permissionKeys.map((permissionKey) => ({
            key: permissionKey,
            label: permissionKey,
          }))}
          keyPrefix={role.id}
          variant="outline"
        />

        {confirmArchive && !role.archivedAt ? (
          <ConfirmCheckboxField
            inputId={confirmArchive.inputId}
            checked={confirmArchive.checked}
            onCheckedChange={confirmArchive.onChange}
            label={confirmArchive.label}
          />
        ) : null}

        {confirmArchive && !role.archivedAt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!confirmArchive.checked || busyArchive}
            onClick={onArchive}
          >
            {t('roleCatalog.actions.archive')}
          </Button>
        ) : null}

        <Collapsible open={isEditing}>
          <CollapsibleContent className="flex flex-col gap-3">
            <Separator />
            {isEditing && editingDraft ? (
              <div className="flex flex-col gap-3">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${editIdPrefix}-key-${role.id}`}>
                      {t('roleCatalog.create.roleKeyLabel')}
                    </FieldLabel>
                    <Input
                      id={`${editIdPrefix}-key-${role.id}`}
                      value={editingDraft.key}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                key: event.target.value.toLowerCase(),
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`${editIdPrefix}-label-${role.id}`}>
                      {t('roleCatalog.create.roleLabelLabel')}
                    </FieldLabel>
                    <Input
                      id={`${editIdPrefix}-label-${role.id}`}
                      value={editingDraft.label}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                label: event.target.value,
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel
                      htmlFor={`${editIdPrefix}-description-${role.id}`}
                    >
                      {t('roleCatalog.create.descriptionLabel')}
                    </FieldLabel>
                    <Textarea
                      id={`${editIdPrefix}-description-${role.id}`}
                      rows={2}
                      value={editingDraft.description}
                      onChange={(event) =>
                        onEditingDraftChange((current) =>
                          current
                            ? {
                                ...current,
                                description: event.target.value,
                              }
                            : current
                        )
                      }
                    />
                  </Field>

                  <CheckboxGroupField
                    fieldIdPrefix={`${permissionFieldIdPrefix}-${role.id}`}
                    legend={t('roleCatalog.permission.legend')}
                    description={t('roleCatalog.permission.editDescription')}
                    items={permissionCatalogKeys.map((key) => ({
                      key,
                      label: key,
                    }))}
                    selectedKeys={editingDraft.permissionKeys}
                    onToggle={(permissionKey, checked) => {
                      onEditingDraftChange((current) =>
                        current
                          ? {
                              ...current,
                              permissionKeys: toggleGroupKey(
                                current.permissionKeys,
                                permissionKey,
                                checked
                              ),
                            }
                          : current
                      );
                    }}
                  />

                  {confirmEdit ? (
                    <ConfirmCheckboxField
                      inputId={confirmEdit.inputId}
                      checked={confirmEdit.checked}
                      onCheckedChange={confirmEdit.onChange}
                      label={confirmEdit.label}
                    />
                  ) : null}
                </FieldGroup>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-testid={saveTestId}
                    disabled={
                      confirmEdit ? !confirmEdit.checked || busyEdit : busyEdit
                    }
                    onClick={onSave}
                  >
                    {t('roleCatalog.actions.save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onCancelEdit}
                  >
                    {t('roleCatalog.actions.cancel')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
