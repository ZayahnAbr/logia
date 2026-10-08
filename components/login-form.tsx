"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";



export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // Update this route to redirect to an authenticated route. The user already has an active session.
      router.push("/spaces");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card
        style={{
          background: "rgba(255, 255, 255, 0.65)",
          backdropFilter: "blur(30px) saturate(1.4)",
          WebkitBackdropFilter: "blur(30px) saturate(1.4)",
          border: "1px solid rgba(255, 255, 255, 0.85)",
          boxShadow: "0 20px 60px rgba(190, 95, 90, 0.18)",
          borderRadius: 24,
        }}
      >
        <CardContent style={{ padding: "36px 32px" }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "#3a1f22", margin: 0 }}>
              Welcome back
            </h2>
            <p style={{ fontSize: 13.5, color: "#9a6d70", margin: "5px 0 0" }}>
              Sign in to continue
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div className="flex flex-col" style={{ gap: 18 }}>
              <div>
                <Label htmlFor="email" style={{ display: "block", color: "#6a4548", fontSize: 12, fontWeight: 500, letterSpacing: "0.01em", marginBottom: 7 }}>
                  Email
                </Label>
                <Input
                  id="email" type="email" placeholder="you@university.ac.za" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(230,190,180,0.7)", height: 46, borderRadius: 12, padding: "0 15px", fontSize: 14, color: "#3a1f22" }}
                />
              </div>

              <div>
                <div className="flex items-center" style={{ marginBottom: 7 }}>
                  <Label htmlFor="password" style={{ color: "#6a4548", fontSize: 12, fontWeight: 500, letterSpacing: "0.01em" }}>
                    Password
                  </Label>
                  <Link href="/auth/forgot-password" className="ml-auto hover:underline underline-offset-4" style={{ color: "#c07a6e", fontSize: 12 }}>
                    Forgot?
                  </Link>
                </div>
                <Input
                  id="password" type="password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(230,190,180,0.7)", height: 46, borderRadius: 12, padding: "0 15px", fontSize: 14, color: "#3a1f22" }}
                />
              </div>

              {error && <p style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>{error}</p>}

              <Button type="submit" className="w-full" disabled={isLoading}
                style={{ background: "#e8745f", border: "none", color: "#fff", fontWeight: 600, height: 48, borderRadius: 14, fontSize: 15, marginTop: 6, boxShadow: "0 8px 22px rgba(232,116,95,0.32)", transition: "filter .15s" }}>
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </div>

            <div style={{ textAlign: "center", marginTop: 26, paddingTop: 22, borderTop: "1px solid rgba(200,140,130,0.18)", fontSize: 13, color: "#9a6d70" }}>
              New here?{" "}
              <Link href="/auth/sign-up" className="underline underline-offset-4" style={{ color: "#c85a4a", fontWeight: 600 }}>
                Create an account
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
