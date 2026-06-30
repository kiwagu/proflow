import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Collapsible,
  CollapsibleContent,
} from '@workspace/ui/components/collapsible';
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Separator } from '@workspace/ui/components/separator';
import { Textarea } from '@workspace/ui/components/textarea';

import type { PlatformRoleCatalogRow } from '@/lib/platform-role-catalog.actions';

import type { RoleDraft, Translator } from './role-catalog.schema';
import { PermissionField, togglePermissionKey } from './permission-field';

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
        <div className="flex flex-wrap gap-1">
          {role.permissionKeys.map((permissionKey) => (
            <Badge key={`${role.id}-${permissionKey}`} variant="outline">
              {permissionKey}
            </Badge>
          ))}
        </div>

        {confirmArchive && !role.archivedAt ? (
          <Field orientation="horizontal">
            <Checkbox
              id={confirmArchive.inputId}
              checked={confirmArchive.checked}
              onCheckedChange={(value) =>
                confirmArchive.onChange(value === true)
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={confirmArchive.inputId}>
                {confirmArchive.label}
              </FieldLabel>
            </FieldContent>
          </Field>
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

                  <PermissionField
                    fieldIdPrefix={`${permissionFieldIdPrefix}-${role.id}`}
                    legend={t('roleCatalog.permission.legend')}
                    description={t('roleCatalog.permission.editDescription')}
                    permissionCatalogKeys={permissionCatalogKeys}
                    selectedPermissionKeys={editingDraft.permissionKeys}
                    onTogglePermission={(permissionKey, checked) => {
                      onEditingDraftChange((current) =>
                        current
                          ? {
                              ...current,
                              permissionKeys: togglePermissionKey(
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
                    <Field orientation="horizontal">
                      <Checkbox
                        id={confirmEdit.inputId}
                        checked={confirmEdit.checked}
                        onCheckedChange={(value) =>
                          confirmEdit.onChange(value === true)
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={confirmEdit.inputId}>
                          {confirmEdit.label}
                        </FieldLabel>
                      </FieldContent>
                    </Field>
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
