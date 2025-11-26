ALTER TABLE "public"."private_booking_audit"
ADD CONSTRAINT "private_booking_audit_performed_by_profile_fkey"
FOREIGN KEY ("performed_by")
REFERENCES "public"."profiles"("id");
