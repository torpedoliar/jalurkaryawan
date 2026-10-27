CREATE TABLE "BusQrCredential" (
  "busId" TEXT PRIMARY KEY REFERENCES "Bus"("id") ON DELETE CASCADE,
  "secretHash" TEXT NOT NULL UNIQUE,
  "ciphertext" TEXT NOT NULL,
  "rotatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "TicketCredential" (
  "bookingId" TEXT PRIMARY KEY REFERENCES "Booking"("id") ON DELETE CASCADE,
  "secretHash" TEXT NOT NULL UNIQUE,
  "ciphertext" TEXT NOT NULL
);
CREATE TABLE "TripOperation" (
  "tripId" TEXT PRIMARY KEY REFERENCES "Trip"("id") ON DELETE CASCADE,
  "driverId" TEXT REFERENCES "User"("id"),
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK ("status" IN ('NOT_STARTED','IN_PROGRESS','COMPLETED')),
  "startedAt" TIMESTAMPTZ(3),
  "endedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "one_active_trip_per_driver" ON "TripOperation" ("driverId") WHERE "status" = 'IN_PROGRESS';
CREATE TABLE "Attendance" (
  "bookingId" TEXT PRIMARY KEY REFERENCES "Booking"("id") ON DELETE CASCADE,
  "tripId" TEXT NOT NULL REFERENCES "Trip"("id") ON DELETE CASCADE,
  "busId" TEXT NOT NULL REFERENCES "Bus"("id"),
  "actorId" TEXT NOT NULL REFERENCES "User"("id"),
  "checkedInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" TEXT NOT NULL CHECK ("method" IN ('DRIVER_SCANNER','DRIVER_CAMERA','EMPLOYEE_BUS_QR','ADMIN_MANUAL'))
);
CREATE INDEX "Attendance_tripId_idx" ON "Attendance" ("tripId");
CREATE TABLE "TripLocation" (
  "tripId" TEXT NOT NULL REFERENCES "Trip"("id") ON DELETE CASCADE,
  "sampleId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL CHECK ("lat" BETWEEN -90 AND 90),
  "lng" DOUBLE PRECISION NOT NULL CHECK ("lng" BETWEEN -180 AND 180),
  "accuracy" DOUBLE PRECISION,
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("tripId", "sampleId")
);
CREATE INDEX "TripLocation_latest_idx" ON "TripLocation" ("tripId", "capturedAt" DESC);
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_coordinate_pair" CHECK (("lat" IS NULL) = ("lng" IS NULL)) NOT VALID;
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_coordinate_range" CHECK (("lat" IS NULL OR "lat" BETWEEN -90 AND 90) AND ("lng" IS NULL OR "lng" BETWEEN -180 AND 180)) NOT VALID;
