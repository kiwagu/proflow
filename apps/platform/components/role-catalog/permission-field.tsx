import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@workspace/ui/components/field';

export function togglePermissionKey(
  permissionKeys: readonly string[],
  permissionKey: string,
  checked: boolean
): string[] {
  if (checked) {
    return [...new Set([...permissionKeys, permissionKey])];
  }
  return permissionKeys.filter((key) => key !== permissionKey);
}

type PermissionFieldProps = Readonly<{
  fieldIdPrefix: string;
  legend: string;
  description: string;
  permissionCatalogKeys: readonly string[];
  selectedPermissionKeys: readonly string[];
  onTogglePermission: (permissionKey: string, checked: boolean) => void;
}>;

export function PermissionField({
  fieldIdPrefix,
  legend,
  description,
  permissionCatalogKeys,
  selectedPermissionKeys,
  onTogglePermission,
}: PermissionFieldProps) {
  const selectedPermissionKeySet = new Set(selectedPermissionKeys);

  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <div
        data-slot="checkbox-group"
        className="border-border bg-muted/30 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3"
      >
        {permissionCatalogKeys.map((permissionKey) => {
          const inputId = `${fieldIdPrefix}-${permissionKey}`;
          return (
            <Field key={permissionKey} orientation="horizontal">
              <Checkbox
                id={inputId}
                checked={selectedPermissionKeySet.has(permissionKey)}
                onCheckedChange={(value) =>
                  onTogglePermission(permissionKey, value === true)
                }
              />
              <FieldContent>
                <FieldLabel htmlFor={inputId}>{permissionKey}</FieldLabel>
              </FieldContent>
            </Field>
          );
        })}
      </div>
    </FieldSet>
  );
}
