"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SignUpForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const theme = searchParams.get("theme"); // from the landing carousel

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/spaces`,
          data: theme ? { theme } : undefined, // stash chosen theme on the user
        },
      });
      if (error) throw error;
      // save the landing theme to their profile if we have a session + a choice
      if (theme && data.user) {
        await supabase.from("profiles").update({ theme }).eq("id", data.user.id);
      }
      router.push("/auth/sign-up-success");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = { background: "rgba(255,255,255,0.8)", border: "1px solid rgba(230,190,180,0.7)", height: 46, borderRadius: 12, padding: "0 15px", fontSize: 14, color: "#3a1f22" } as React.CSSProperties;
  const labelStyle = { color: "#6a4548", fontSize: 12, fontWeight: 500, letterSpacing: "0.01em", marginBottom: 7, display: "block" } as React.CSSProperties;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card style={{
        background: "rgba(255, 255, 255, 0.65)",
        backdropFilter: "blur(30px) saturate(1.4)",
        WebkitBackdropFilter: "blur(30px) saturate(1.4)",
        border: "1px solid rgba(255, 255, 255, 0.85)",
        boxShadow: "0 20px 60px rgba(190, 95, 90, 0.18)",
        borderRadius: 24,
      }}>
        <CardContent style={{ padding: "36px 32px" }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "#3a1f22", margin: 0 }}>Create your account</h2>
            <p style={{ fontSize: 13.5, color: "#9a6d70", margin: "5px 0 0" }}>
              Start studying in your own space{theme ? ` · ${theme} theme` : ""}
            </p>
          </div>

          <form onSubmit={handleSignUp}>
            <div className="flex flex-col" style={{ gap: 18 }}>
              <div>
                <Label htmlFor="email" style={labelStyle}>Email</Label>
                <Input id="email" type="email" placeholder="you@university.ac.za" required
                  value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <Label htmlFor="password" style={labelStyle}>Password</Label>
                <Input id="password" type="password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <Label htmlFor="repeat-password" style={labelStyle}>Repeat password</Label>
                <Input id="repeat-password" type="password" required
                  value={repeatPassword} onChange={(e) => setRepeatPassword(e.target.value)} style={inputStyle} />
              </div>
              {error && <p style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}
                style={{ background: "#e8745f", border: "none", color: "#fff", fontWeight: 600, height: 48, borderRadius: 14, fontSize: 15, marginTop: 6, boxShadow: "0 8px 22px rgba(232,116,95,0.32)" }}>
                {isLoading ? "Creating account…" : "Sign up"}
              </Button>
            </div>
            <div style={{ textAlign: "center", marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(200,140,130,0.18)", fontSize: 13, color: "#9a6d70" }}>
              Already have an account?{" "}
              <Link href="/auth/login" className="underline underline-offset-4" style={{ color: "#c85a4a", fontWeight: 600 }}>
                Log in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}