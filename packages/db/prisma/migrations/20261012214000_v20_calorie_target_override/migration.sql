-- V20: optional user-set daily calorie target (kcal), e.g. from the
-- adaptive-TDEE "Use as my calorie target" action on the dashboard.
-- NULL = use the computed (Mifflin-St Jeor + goal) target.
ALTER TABLE "Profile" ADD COLUMN "calorieTargetOverrideKcal" INTEGER;
