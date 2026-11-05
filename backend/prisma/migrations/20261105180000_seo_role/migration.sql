-- A third role: the SEO specialist (admin/seo-access.ts). Adding an enum
-- value is safe for the previous release as long as no account holds it.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SEO';
