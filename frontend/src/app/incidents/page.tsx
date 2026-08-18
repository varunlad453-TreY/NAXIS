import { redirect } from "next/navigation";

// There is no incident list page — /correlation is the Alerts UI that lists
// them. Only /incidents/[id] exists, so the bare parent path 404'd for anyone
// trimming an incident URL or following an old bookmark.
export default function IncidentsPage() {
  redirect("/correlation");
}
