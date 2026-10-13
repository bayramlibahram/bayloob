import {
  BotIcon,
  CodeIcon,
  GlobeIcon,
  HouseIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  WrenchIcon,
} from "lucide-react";

/** Each section's icon (the side navigation, the command palette). */
export const SECTION_ICON = {
  home: LayoutDashboardIcon,
  inbox: InboxIcon,
  agents: BotIcon,
  tasks: ListChecksIcon,
  overview: HouseIcon,
  browsers: GlobeIcon,
  ides: CodeIcon,
  applications: LayoutGridIcon,
  system: WrenchIcon,
};
