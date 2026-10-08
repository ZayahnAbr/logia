// Display names for the sources of synced school items (lms_items.source). Safe for client and server code.
export const PLATFORM_LABEL: Record<string, string> = {
  brightspace: "Brightspace",
  canvas: "Canvas",
  moodle: "Moodle",
  blackboard: "Blackboard",
  google_classroom: "Google Classroom",
};
export const platformLabel = (source: string) => PLATFORM_LABEL[source] ?? "School";
