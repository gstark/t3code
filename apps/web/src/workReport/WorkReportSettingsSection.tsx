import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_WORK_REPORT_NUDGE_AFTER_HOURS, ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { useProjects } from "~/state/entities";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

const NOT_SET = "";

/** Where work reports are written and how long after one the sidebar suggests the next. */
export function WorkReportSettingsSection() {
  const settings = usePrimarySettings((value) => value.workReport);
  const updateSettings = useUpdatePrimarySettings();
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const selected = projects.find((project) => project.id === settings.projectId) ?? null;

  return (
    <SettingsSection id="work-report" title="Work report">
      <SettingsRow
        serverScoped
        settingKeys={["workReport"]}
        title="Reports folder"
        description={
          selected
            ? selected.workspaceRoot
            : "The first work report asks for a folder. You can also pick a project here."
        }
        control={
          <Select
            value={settings.projectId ?? NOT_SET}
            onValueChange={(value) =>
              updateSettings({
                workReport: {
                  projectId: value === NOT_SET ? null : ProjectId.make(String(value)),
                  activeRun: null,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Reports folder">
              <SelectValue>{selected?.title ?? "Not set"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value={NOT_SET}>
                Not set
              </SelectItem>
              {projects.map((project) => (
                <SelectItem hideIndicator key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["workReport"]}
        title="Hours between reports"
        description="The sidebar suggests a work report this long after the last one, when threads have settled since."
        control={
          <HoursInput
            value={settings.nudgeAfterHours}
            onCommit={(hours) => updateSettings({ workReport: { nudgeAfterHours: hours } })}
          />
        }
      />
    </SettingsSection>
  );
}

function HoursInput({ value, onCommit }: { value: number; onCommit: (hours: number) => void }) {
  // A local draft lets the field be emptied mid-edit; blur restores the saved value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      size="sm"
      type="number"
      min={1}
      className="w-full sm:w-24"
      placeholder={String(DEFAULT_WORK_REPORT_NUDGE_AFTER_HOURS)}
      value={draft ?? String(value)}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (Number.isInteger(parsed) && parsed >= 1) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
      aria-label="Hours between work reports"
    />
  );
}
