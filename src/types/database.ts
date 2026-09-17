// Hand-written types mirroring supabase/migrations/*.sql.
// Regenerate with `supabase gen types typescript` once a live project exists
// and reconcile — this file is the source of truth for local development.

export type FitnessGoal =
  | 'general_fitness'
  | 'lose_weight'
  | 'build_muscle'
  | 'improve_strength'
  | 'improve_endurance'
  | 'stay_fit';

export type TeamRole = 'member' | 'team_admin';

export type MuscleGroup =
  | 'chest' | 'back' | 'legs' | 'shoulders' | 'biceps' | 'triceps' | 'abs' | 'full_body' | 'cardio';

export type ExerciseType = 'strength' | 'cardio' | 'mobility' | 'other';

export type ActivityType =
  | 'krafttraining' | 'laufen' | 'gehen' | 'radfahren' | 'schwimmen'
  | 'cardio' | 'fussball' | 'fitnesskurs' | 'sonstiges';

export type WorkoutStatus = 'geplant' | 'laeuft' | 'abgeschlossen' | 'uebersprungen';

export type DataSource = 'manual' | 'apple_health' | 'health_connect';

export type PrivacyVisibility = 'private' | 'team' | 'selected';

export type ScoreEventType =
  | 'workout_completed' | 'workout_duration_bonus' | 'weekly_goal_reached'
  | 'consistency_bonus' | 'daily_step_goal' | 'challenge_completed' | 'team_challenge_participation';

export type ChallengeType = 'individual' | 'team';
export type ChallengeMetric = 'workouts_count' | 'minutes' | 'steps' | 'distance_km' | 'strength_sessions' | 'custom';

export type NotificationCategory =
  | 'trainingserinnerung' | 'wochenziel' | 'messungserinnerung'
  | 'herausforderung' | 'team_aktivitaet' | 'wochenzusammenfassung';

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  fitness_goal: FitnessGoal | null;
  weekly_goal: number;
  height_cm: number | null;
  birth_date: string | null;
  locale: 'de' | 'en' | 'ru';
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  token_hash: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
}

export interface Exercise {
  id: string;
  team_id: string | null;
  name: string;
  muscle_group: MuscleGroup;
  equipment: string | null;
  exercise_type: ExerciseType;
  instructions: string | null;
  default_sets: number | null;
  default_reps: number | null;
  media_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutPlan {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkoutPlanDay {
  id: string;
  plan_id: string;
  weekday: number; // 1 Montag .. 7 Sonntag
  title: string;
  is_rest_day: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkoutPlanExercise {
  id: string;
  plan_day_id: string;
  exercise_id: string;
  position: number;
  target_sets: number | null;
  target_reps: number | null;
  created_at: string;
  updated_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  team_id: string | null;
  plan_day_id: string | null;
  activity_type: ActivityType;
  status: WorkoutStatus;
  title: string | null;
  scheduled_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  distance_km: number | null;
  notes: string | null;
  source: DataSource;
  created_at: string;
  updated_at: string;
}

export interface WorkoutExercise {
  id: string;
  workout_id: string;
  exercise_id: string;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutSet {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  user_id: string;
  team_id: string | null;
  activity_type: ActivityType;
  occurred_at: string;
  duration_seconds: number | null;
  distance_km: number | null;
  steps: number | null;
  calories_estimate: number | null;
  source: DataSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BodyMeasurement {
  id: string;
  user_id: string;
  measured_at: string;
  weight_kg: number | null;
  biceps_cm: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  hip_cm: number | null;
  thigh_cm: number | null;
  body_fat_pct: number | null;
  neck_cm: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NutritionEntry {
  id: string;
  user_id: string;
  entry_date: string;
  calories_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  water_ml: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserMetricPreferences {
  user_id: string;
  enabled_metrics: string[];
  calorie_goal_kcal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  water_goal_ml: number | null;
  steps_goal: number | null;
  created_at: string;
  updated_at: string;
}

export interface PrivacySettings {
  user_id: string;
  body_measurements_visibility: PrivacyVisibility;
  nutrition_visibility: PrivacyVisibility;
  activity_feed_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamRankingRules {
  team_id: string;
  points_workout_completed: number;
  points_duration_bonus: number;
  duration_bonus_threshold_minutes: number;
  points_weekly_goal_reached: number;
  points_consistency_bonus: number;
  consistency_bonus_min_days: number;
  points_daily_step_goal: number;
  points_challenge_completed: number;
  points_team_challenge_participation: number;
  daily_cap_points: number;
  updated_at: string;
  updated_by: string | null;
}

export interface FitnessScoreEvent {
  id: string;
  user_id: string;
  team_id: string;
  event_type: ScoreEventType;
  points: number;
  event_date: string;
  source_entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Challenge {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  challenge_type: ChallengeType;
  metric: ChallengeMetric;
  target_value: number;
  starts_at: string;
  ends_at: string;
  points_reward: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;
  progress_value: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  team_id: string;
  user_id: string;
  reply_to_id: string | null;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface ActivityFeedItem {
  id: string;
  team_id: string;
  user_id: string | null;
  event_type: string;
  message_key: string;
  params: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  category: NotificationCategory;
  title_key: string;
  body_key: string | null;
  params: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  trainingserinnerung: boolean;
  wochenziel: boolean;
  messungserinnerung: boolean;
  herausforderung: boolean;
  team_aktivitaet: boolean;
  wochenzusammenfassung: boolean;
  chat_nachrichten: boolean;
}

export interface Achievement {
  id: string;
  code: string;
  title_key: string;
  description_key: string;
  icon: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
}

export interface AuditEvent {
  id: string;
  team_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
