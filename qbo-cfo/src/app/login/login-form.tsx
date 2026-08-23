'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';
import { signIn, type AuthState } from './actions';

export function LoginForm({ isFirstRun }: { isFirstRun: boolean }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signIn, { error: null });

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <ErrorNotice title="Sign-in failed" message={state.error} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="owner@example.com" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isFirstRun ? 'new-password' : 'current-password'}
          required
          minLength={8}
          placeholder="••••••••"
        />
        {isFirstRun ? (
          <p className="text-xs text-ink-subtle">
            No account exists yet. The credentials you enter will create the owner account.
          </p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : isFirstRun ? 'Create owner account' : 'Sign in'}
      </Button>
    </form>
  );
}
