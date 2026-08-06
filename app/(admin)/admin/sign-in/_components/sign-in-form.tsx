'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input, FieldLabel, FieldError } from '@/components/ui/field'
import { signInAdmin, type SignInState } from '../actions'

export function AdminSignInForm() {
  const [state, action] = useActionState<SignInState, FormData>(signInAdmin, {})

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          spellCheck={false}
        />
      </div>

      <div>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      <FieldError>{state.error}</FieldError>

      <Submit />
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ink" size="lg" disabled={pending}>
      {pending ? 'Checking…' : 'Sign in'}
    </Button>
  )
}
