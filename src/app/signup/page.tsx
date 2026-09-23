import type { Metadata } from "next";
import { AuthForm } from "@/app/_components/auth-form";

export const metadata: Metadata = {
  title: "Create account · Chat UI",
  description: "Create your Chat UI workspace.",
};

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
