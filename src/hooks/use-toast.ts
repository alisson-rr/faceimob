import type { ReactNode } from "react";
import { toast as sonner } from "sonner";

type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
};

function toast({ title, description, variant }: ToastOptions) {
  const message = title || description || "";
  const options = title && description ? { description } : undefined;
  return variant === "destructive"
    ? sonner.error(message, options)
    : sonner(message, options);
}

function useToast() {
  return { toast };
}

export { useToast, toast };
