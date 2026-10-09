import { FileChartColumnIcon } from "lucide-react";
import { memo } from "react";

import { useWorkReport, useWorkReportNudge } from "~/workReport/useWorkReport";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

/** Shows when a work report is due or running; a click starts or reopens it. */
export const SidebarWorkReportRow = memo(function SidebarWorkReportRow() {
  const nudge = useWorkReportNudge();
  const { run, available } = useWorkReport();
  if (nudge === null || !available) return null;
  const label = nudge.running
    ? "Work report in progress"
    : `Work report: ${nudge.pending} settled ${nudge.pending === 1 ? "thread" : "threads"}`;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={run} size="sm">
          <FileChartColumnIcon />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
