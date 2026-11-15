import { AuthCard } from "@/components/AuthCard";
import { RecoverForm } from "./RecoverForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" subtitle="Use the recovery code you saved when you made your account to choose a new password.">
      <RecoverForm />
    </AuthCard>
  );
}
