UPDATE "UserDirectoryEntry"
SET "roles" = CASE
  WHEN "roles" @> '["admin"]'::jsonb OR "roles" @> '["platform_admin"]'::jsonb
    THEN '["admin"]'::jsonb
  ELSE '["user"]'::jsonb
END;

UPDATE "UserDirectoryEntry"
SET "managedRoles" = CASE
  WHEN "managedRoles" @> '["admin"]'::jsonb OR "managedRoles" @> '["platform_admin"]'::jsonb
    THEN '["admin"]'::jsonb
  ELSE '["user"]'::jsonb
END
WHERE "managedRoles" IS NOT NULL;
