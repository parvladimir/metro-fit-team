'use client';

import { useEffect } from 'react';
import { clearDraftsForUser, clearDraftsForWorkout, sweepDrafts } from '@/lib/workout-drafts';

/**
 * Keeps the on-device set drafts honest. Mounted once in the signed-in shell: removes
 * drafts that belong to another account, that expired, or that belong to a workout that
 * is not the user's running one any more (finished, skipped or discarded).
 */
export function DraftSweeper({ userId, activeWorkoutId }: { userId: string; activeWorkoutId: string | null }) {
  useEffect(() => {
    sweepDrafts({ userId, activeWorkoutId, now: Date.now() });
  }, [userId, activeWorkoutId]);
  return null;
}

/** Drops all drafts of a workout as soon as this is shown (the finished-workout summary). */
export function DraftCleaner({ userId, workoutId }: { userId: string; workoutId: string }) {
  useEffect(() => {
    clearDraftsForWorkout(userId, workoutId);
  }, [userId, workoutId]);
  return null;
}

/** A form that clears the workout's drafts when it is submitted (skipping a workout). */
export function ClearDraftsForm({
  userId,
  workoutId,
  action,
  className,
  children,
}: {
  userId: string;
  workoutId: string;
  action: () => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action} onSubmit={() => clearDraftsForWorkout(userId, workoutId)} className={className}>
      {children}
    </form>
  );
}

/** The sign-out form: nothing typed by this account stays on the device. */
export function SignOutForm({ userId, action, className, children }: { userId: string; action: () => void | Promise<void>; className?: string; children: React.ReactNode }) {
  return (
    <form action={action} onSubmit={() => clearDraftsForUser(userId)} className={className}>
      {children}
    </form>
  );
}
