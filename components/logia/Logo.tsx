import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/spaces"
      style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, letterSpacing: "-.02em", color: "inherit", textDecoration: "none" }}
      className={className}
    >
      <LogoMark size={26} />
      logia
    </Link>
  );
}
