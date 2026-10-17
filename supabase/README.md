# Supabase

Cloud free-tier project. Migrations live in `migrations/` and seed data in `seed/` (Phase 2).

Apply migrations with the Supabase CLI (via npx, no global install):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
