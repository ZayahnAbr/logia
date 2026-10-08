import { redirect } from "next/navigation";

// This route used to render a broken theme-carousel experiment with no actual
// sign-in form. The real sign-in page lives at /auth/signin — every redirect("/auth/login")
// across the app points here, so we forward rather than touching every call site.
export default function LoginPage() {
  redirect("/auth/signin");
}
