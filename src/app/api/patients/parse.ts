import type { PatientInput } from "@/application/directory-use-cases";

export function parsePatient(body: Record<string, unknown>): PatientInput {
  const mode = body.patientReminder;
  const lead = body.leadHours;
  const hasLead = lead !== undefined && lead !== "" && lead !== "default";
  const hasMode = mode === "evening" || mode === "lead" || mode === "both";
  return {
    name: String(body.name ?? ""),
    phone: String(body.phone ?? ""),
    condition: String(body.condition ?? ""),
    reminder:
      hasMode || hasLead
        ? {
            patientReminder: hasMode ? (mode as "evening" | "lead" | "both") : undefined,
            leadHours: hasLead ? (Number(lead) as 0 | 1 | 2) : undefined,
          }
        : undefined,
  };
}
