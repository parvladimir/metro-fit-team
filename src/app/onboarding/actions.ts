'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import type { FitnessGoal } from '@/types/database';

const VALID_GOALS: FitnessGoal[] = [
  'general_fitness', 'lose_weight', 'build_muscle', 'improve_strength', 'improve_endurance', 'stay_fit',
];

export type OnboardingState = { error?: string } | undefined;

export async function completeOnboardingAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const fullName = String(formData.get('fullName') || '').trim();
  const goal = String(formData.get('fitnessGoal') || '') as FitnessGoal;
  const weeklyGoal = Number(formData.get('weeklyGoal') || 3);
  const avatarUrl = String(formData.get('avatarUrl') || '') || null;
  const heightRaw = String(formData.get('height') || '').trim();
  const weightRaw = String(formData.get('weight') || '').trim();
  const ageRaw = String(formData.get('age') || '').trim();

  if (!fullName) return { error: 'Bitte gib deinen Namen ein.' };
  if (!VALID_GOALS.includes(goal)) return { error: 'Bitte wähle ein Ziel aus.' };
  if (weeklyGoal < 1 || weeklyGoal > 7) return { error: 'Das Wochenziel muss zwischen 1 und 7 liegen.' };

  const height = heightRaw ? Number(heightRaw) : null;
  const weight = weightRaw ? Number(weightRaw) : null;
  const age = ageRaw ? Number(ageRaw) : null;
  const birthDate = age && age > 0 && age < 120 ? `${new Date().getFullYear() - age}-01-01` : null;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      avatar_url: avatarUrl,
      fitness_goal: goal,
      weekly_goal: weeklyGoal,
      height_cm: height,
      birth_date: birthDate,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (profileError) return { error: 'Profil konnte nicht gespeichert werden.' };

  if (weight && weight > 0) {
    await supabase.from('body_measurements').upsert(
      { user_id: user.id, measured_at: new Date().toISOString().slice(0, 10), weight_kg: weight },
      { onConflict: 'user_id,measured_at' }
    );
  }

  redirect('/');
}
