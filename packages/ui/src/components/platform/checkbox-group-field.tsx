import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@workspace/ui/components/field';
import { Checkbox } from '@workspace/ui/components/checkbox';

/**
 * Toggle a key in a selected-keys list, returning a new de-duplicated array. Generic
 * helper behind {@link CheckboxGroupField} (a checked toggle adds, unchecked removes).
 */
export function toggleGroupKey(
  selectedKeys: readonly string[],
  key: string,
  checked: boolean
): string[] {
  if (checked) {
    return [...new Set([...selectedKeys, key])];
  }
  return selectedKeys.filter((existing) => existing !== key);
}

export type CheckboxGroupItem = {
  key: string;
  label: string;
};

type CheckboxGroupFieldProps = Readonly<{
  /** Stable prefix for each checkbox's `id` (combined with the item key). */
  fieldIdPrefix: string;
  legend: string;
  description: string;
  items: readonly CheckboxGroupItem[];
  selectedKeys: readonly string[];
  onToggle: (key: string, checked: boolean) => void;
}>;

/**
 * CheckboxGroupField — a scrollable, bordered group of labeled checkboxes inside a
 * `FieldSet`, with a legend + description. Generic and i18n-free: the caller passes
 * resolved `legend`/`description` strings and `items` ({ key, label }) and owns the
 * selection state via `selectedKeys` + `onToggle`. The platform role-catalog uses it
 * for permission selection; nothing here knows about permissions.
 */
export function CheckboxGroupField({
  fieldIdPrefix,
  legend,
  description,
  items,
  selectedKeys,
  onToggle,
}: CheckboxGroupFieldProps) {
  const selectedKeySet = new Set(selectedKeys);

  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <div
        data-slot="checkbox-group"
        className="border-border bg-muted/30 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3"
      >
        {items.map((item) => {
          const inputId = `${fieldIdPrefix}-${item.key}`;
          return (
            <Field key={item.key} orientation="horizontal">
              <Checkbox
                id={inputId}
                checked={selectedKeySet.has(item.key)}
                onCheckedChange={(value) => onToggle(item.key, value === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor={inputId}>{item.label}</FieldLabel>
              </FieldContent>
            </Field>
          );
        })}
      </div>
    </FieldSet>
  );
}
