import { redirect } from "next/navigation";

// The dashboard lives at /spaces; this old route just forwards there.
export default function DashboardPage() {
  redirect("/spaces");
}
