import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 6;

const MESSAGES = {
  emailRequired: "Podaj adres email",
  emailInvalid: "Podaj poprawny adres email",
  passwordRequired: "Podaj hasło",
  passwordTooShort: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`,
  confirmRequired: "Powtórz hasło",
  confirmMismatch: "Hasła nie są takie same",
} as const;

interface Props {
  serverError?: string | null;
}

export default function SignUpForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!email.trim()) {
      next.email = MESSAGES.emailRequired;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = MESSAGES.emailInvalid;
    }

    if (!password) {
      next.password = MESSAGES.passwordRequired;
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = MESSAGES.passwordTooShort;
    }

    if (!confirmPassword) {
      next.confirmPassword = MESSAGES.confirmRequired;
    } else if (password !== confirmPassword) {
      next.confirmPassword = MESSAGES.confirmMismatch;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-muted-foreground mt-1 text-xs">
        Brakuje jeszcze {MIN_PASSWORD_LENGTH - password.length}{" "}
        {MIN_PASSWORD_LENGTH - password.length === 1 ? "znaku" : "znaków"}
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label="Email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="you@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        label="Hasło"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Min. 6 znaków"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Powtórz hasło"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Wpisz hasło ponownie"
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zakładanie konta…" icon={<UserPlus className="size-4" />}>
        Załóż konto
      </SubmitButton>
    </form>
  );
}
