import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface PasswordStrengthProps {
  password: string;
}

type Strength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
};

const calculateStrength = (password: string): Strength => {
  if (!password) return { score: 0, label: "", color: "bg-muted" };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  const map: Record<number, Strength> = {
    0: { score: 0, label: "Too weak", color: "bg-destructive" },
    1: { score: 1, label: "Weak", color: "bg-destructive" },
    2: { score: 2, label: "Fair", color: "bg-yellow-500" },
    3: { score: 3, label: "Good", color: "bg-blue-500" },
    4: { score: 4, label: "Strong", color: "bg-success" },
  };
  return map[score];
};

const PasswordStrength = ({ password }: PasswordStrengthProps) => {
  const strength = useMemo(() => calculateStrength(password), [password]);

  if (!password) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= strength.score ? strength.color : "bg-muted"
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{strength.label}</span>
        <span className="text-muted-foreground">
          Use 12+ chars, mixed case, number & symbol
        </span>
      </div>
    </div>
  );
};

export default PasswordStrength;
