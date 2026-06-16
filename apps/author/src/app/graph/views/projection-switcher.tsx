'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Label } from '@workspace/ui/components/label';
import { useRouter } from 'next/navigation';
import { useId } from 'react';

/** One saved projection the user may read (RLS-narrowed list from the server). */
export type ProjectionOption = {
  id: string;
  name: string;
};

export type ProjectionSwitcherProps = {
  projections: ProjectionOption[];
  currentProjectionId: string;
  label: string;
  placeholder: string;
};

/**
 * ProjectionSwitcher — the visible Invariant #1 control (§3.3). Switching the
 * selection navigates to the same `/graph/[projectionId]` route with a different
 * projection id; the server component re-resolves that projection over the SAME
 * graph and renders its view. This toggles KB-grid ⇄ course-path over one node
 * set — different apps, one graph. It only READS projections; it never edits a
 * spec (that is authoring, out of this slice).
 */
export function ProjectionSwitcher({
  projections,
  currentProjectionId,
  label,
  placeholder,
}: ProjectionSwitcherProps) {
  const router = useRouter();
  const selectId = useId();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={selectId}>{label}</Label>
      <Select
        value={currentProjectionId}
        onValueChange={(next) => router.push(`/graph/${next}`)}
      >
        <SelectTrigger id={selectId} className="w-64">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {projections.map((projection) => (
            <SelectItem key={projection.id} value={projection.id}>
              {projection.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
