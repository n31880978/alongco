import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 'a••••••a@gmail.com' — what the booking details screen shows for the signed-in address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || local.length === 0) return email
  if (local.length <= 2) return `${local[0]}•@${domain}`
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`
}
